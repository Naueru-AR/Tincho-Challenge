// GET /api/player/:puuid
// Historial de partidas SoloQ del jugador desde que empezó el torneo.
import { loadConfig, getMatchIds, getMatch, isRemake, json, isDemo } from "../../../lib/riot.js";
import { demoMatches } from "../../../lib/demo.js";
import { getLpChanges } from "../../../lib/lp.js";

export async function onRequestGet(context) {
  const puuid = context.params.puuid;
  if (isDemo(context) || puuid.startsWith("demo-")) {
    return json({ matches: demoMatches(puuid) }, 0);
  }

  const cfg = await loadConfig(context);
  // Máximo 10 partidas por pedido: así cada visita cuesta como mucho 11 llamadas a Riot
  // y se mantiene dentro del límite gratuito de Cloudflare (50 subrequests por pedido).
  try {
    const ids = await getMatchIds(puuid, cfg, context.env, 10);
    const [matches, lpChanges] = await Promise.all([
      Promise.all(ids.map((id) => getMatch(id, cfg, context.env))),
      getLpChanges(puuid, context.env),
    ]);
    const out = matches
      .filter(Boolean)
      .map((m) => {
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
    return json({ matches: out }, 120);
  } catch (err) {
    const msg = err.status === 429 ? "Riot está limitando las consultas. Probá en un minuto." : err.message;
    return new Response(JSON.stringify({ error: msg }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
