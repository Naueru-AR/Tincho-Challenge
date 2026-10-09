// GET /api/leaderboard
// Devuelve a cada participante con su rango de SoloQ y su winrate.
import { loadConfig, getAccount, getSoloQ, getProfileIcon, rankScore, cachedResponse, json, isDemo } from "../../lib/riot.js";
import { demoLeaderboard } from "../../lib/demo.js";
import { trackLp } from "../../lib/lp.js";
import { watchPlayer } from "../../lib/duo.js";

// Le pide a Riot el rango de cada jugador. Cloudflare gratis permite 50 consultas por
// pedido, así que primero va lo imprescindible (cuenta y rango) y después los íconos.
async function loadRows(cfg, context) {
  const { env } = context;
  const rows = await Promise.all(
    cfg.players.map(async (p) => {
      try {
        const acc = await getAccount(p.riotId, cfg, env); // en caché 7 días
        if (!acc) return { error: "No encontramos ese Riot ID. Revisá el nombre y el #tag." };
        const e = await getSoloQ(acc.puuid, cfg, env);
        return {
          puuid: acc.puuid,
          entry: e,
          tier: e?.tier ?? null,
          rank: e?.rank ?? null,
          lp: e?.leaguePoints ?? 0,
          wins: e?.wins ?? 0,
          losses: e?.losses ?? 0,
        };
      } catch (err) {
        // `retry` marca los errores pasajeros: una respuesta con alguno no se guarda en caché.
        return { retry: true, error: err.status === 429 ? "Riot está limitando las consultas. Probá en un minuto." : err.message };
      }
    })
  );

  // El ícono es un adorno (en caché 24 horas): si falla, la fila se muestra con la inicial.
  await Promise.all(
    rows.map(async (r) => {
      if (r.puuid) r.profileIconId = await getProfileIcon(r.puuid, cfg, env).catch(() => null);
    })
  );

  // En segundo plano (no demora la respuesta): anotamos los LP de la última partida y
  // revisamos si alguien jugó algo nuevo, para el panel del organizador.
  const roster = new Map(cfg.players.map((p) => [p.riotId.toLowerCase(), p.alias || p.riotId.split("#")[0]]));
  const budget = { left: 12 };
  for (const r of rows) {
    if (!r.puuid) continue;
    if (r.entry) {
      context.waitUntil(
        trackLp(r.puuid, r.entry, rankScore(r.entry), cfg, env).catch((err) => console.log("trackLp:", err.message))
      );
    }
    context.waitUntil(
      watchPlayer(r.puuid, r.entry, cfg, env, roster, budget).catch((err) => console.log("watchPlayer:", err.message))
    );
  }
  return rows;
}

function body(cfg, rows, demo) {
  // Corte entre brackets: desde este rango (inclusive) es High Elo; por debajo, Low Elo.
  const cut = cfg.highEloFrom || { tier: "DIAMOND", rank: "III" };
  const highEloScore = rankScore({ tier: cut.tier, rank: cut.rank || "IV", leaguePoints: 0 });

  const players = cfg.players
    .map((p, i) => {
      const r = rows[i];
      const base = p.baseline || { wins: 0, losses: 0 };
      // Si cargaste un "baseline" al inicio del torneo, contamos solo lo jugado desde entonces.
      const wins = Math.max(0, (r.wins ?? 0) - base.wins);
      const losses = Math.max(0, (r.losses ?? 0) - base.losses);
      const [name, tag] = p.riotId.split("#");
      const score = r.tier ? rankScore({ tier: r.tier, rank: r.rank, leaguePoints: r.lp }) : -1;
      return {
        alias: p.alias || name,
        riotId: p.riotId,
        opggUrl: `https://op.gg/lol/summoners/${cfg.opggRegion}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`,
        puuid: r.puuid ?? null,
        profileIconId: r.profileIconId ?? null,
        tier: r.tier ?? null,
        rank: r.rank ?? null,
        lp: r.lp ?? 0,
        wins,
        losses,
        score,
        // Se puede fijar a mano con "bracket": "high" | "low" en participants.json.
        bracket: p.bracket || (score < 0 ? null : score >= highEloScore ? "high" : "low"),
        error: r.error ?? null,
      };
    })
    .sort((a, b) => b.score - a.score || b.wins - a.wins);

  return {
    title: cfg.title,
    edition: cfg.edition || null,
    start: cfg.start,
    end: cfg.end,
    highEloFrom: cut,
    demo,
    updatedAt: new Date().toISOString(),
    players,
  };
}

export async function onRequestGet(context) {
  const cfg = await loadConfig(context);
  if (isDemo(context)) return json(body(cfg, demoLeaderboard(cfg), true), 0);

  // La respuesta entera queda en caché 2 minutos: aunque mucha gente mire la tabla a la
  // vez, a Riot se le consulta como mucho una vez cada 2 minutos.
  return cachedResponse(context, async () => {
    const rows = await loadRows(cfg, context);
    return { response: json(body(cfg, rows, false), 120), cacheable: !rows.some((r) => r.retry) };
  });
}
