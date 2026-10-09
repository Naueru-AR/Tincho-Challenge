// GET /api/player/:puuid
// Partidas de SoloQ que el jugador jugó HOY (hay un límite de partidas por día).
// El historial se reinicia cada medianoche: no se muestran partidas de días anteriores.
import { loadConfig, getMatchIds, getMatch, isRemake, tzOffset, cachedResponse, withBudget, json, isDemo } from "../../../lib/riot.js";
import { demoMatches } from "../../../lib/demo.js";
import { getLpChanges } from "../../../lib/lp.js";

const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_DAY = 30; // cada partida nueva es una llamada a Riot; Cloudflare gratis permite 50 por pedido

// Medianoche de hoy en la zona horaria del torneo.
function startOfToday(cfg) {
  const offset = tzOffset(cfg);
  return Math.floor((Date.now() + offset) / DAY) * DAY - offset;
}

// Las remakes se informan aparte y no cuentan para el límite diario.
function respond(matches, limit, maxAge) {
  const played = matches.filter((m) => !m.remake).length;
  return json({ matches, today: { limit, played } }, maxAge);
}

export async function onRequestGet(context) {
  const puuid = context.params.puuid;
  const cfg = await loadConfig(context);
  const limit = cfg.dailyLimit ?? 12;
  if (isDemo(context) || puuid.startsWith("demo-")) return respond(demoMatches(puuid), limit, 0);

  // Las partidas de hoy solo cuentan si el torneo ya empezó.
  const dayStart = Math.max(startOfToday(cfg), new Date(cfg.start).getTime());
  // La respuesta queda en caché 2 minutos; las partidas ya vistas salen de KV, no de Riot.
  return cachedResponse(context, () => today(puuid, cfg, limit, dayStart, withBudget(context.env, 42)));
}

async function today(puuid, cfg, limit, dayStart, env) {
  try {
    const [ids, lpChanges] = await Promise.all([
      getMatchIds(puuid, cfg, env, MAX_PER_DAY, dayStart),
      getLpChanges(puuid, env),
    ]);
    const loaded = await Promise.all(ids.map((id) => getMatch(id, cfg, env)));
    const matches = loaded.filter(Boolean).map((m) => {
      const me = m.info.participants.find((p) => p.puuid === puuid);
      return {
        id: m.metadata.matchId,
        lpChange: lpChanges[m.metadata.matchId] ?? null, // null = no lo tenemos registrado
        remake: isRemake(m), // no cuenta como victoria ni derrota
        win: me.win,
        champion: me.championName,
        position: me.teamPosition,
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists,
        cs: me.totalMinionsKilled + me.neutralMinionsKilled,
        duration: m.info.gameDuration,
        endedAt: m.info.gameEndTimestamp,
      };
    });
    return { response: respond(matches, limit, 120), cacheable: true };
  } catch (err) {
    const msg = err.status === 429 || err.status === "budget" ? "Riot está limitando las consultas. Probá en un minuto." : err.message;
    const response = new Response(JSON.stringify({ error: msg }), { status: 502, headers: { "Content-Type": "application/json" } });
    return { response, cacheable: false };
  }
}
