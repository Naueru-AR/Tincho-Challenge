// GET /api/leaderboard
// Devuelve a cada participante con su rango de SoloQ y su winrate.
import { loadConfig, getAccount, getSoloQ, rankScore, json, isDemo } from "../../lib/riot.js";
import { demoLeaderboard } from "../../lib/demo.js";
import { trackLp } from "../../lib/lp.js";

export async function onRequestGet(context) {
  const cfg = await loadConfig(context);
  const demo = isDemo(context);

  let rows;
  if (demo) {
    rows = demoLeaderboard(cfg);
  } else {
    // En paralelo: cada jugador cuesta 2 llamadas a Riot la primera vez
    // y casi siempre 1 o 0 después, gracias a la caché.
    rows = await Promise.all(
      cfg.players.map(async (p) => {
        try {
          const acc = await getAccount(p.riotId, cfg, context.env);
          if (!acc) return { error: "No encontramos ese Riot ID. Revisá el nombre y el #tag." };
          const e = await getSoloQ(acc.puuid, cfg, context.env);
          // Anotamos los LP de la última partida en segundo plano (no demora la respuesta).
          if (e) {
            const score = rankScore(e);
            context.waitUntil(
              trackLp(acc.puuid, e, score, cfg, context.env).catch((err) => console.log("trackLp:", err.message))
            );
          }
          return {
            puuid: acc.puuid,
            tier: e?.tier ?? null,
            rank: e?.rank ?? null,
            lp: e?.leaguePoints ?? 0,
            wins: e?.wins ?? 0,
            losses: e?.losses ?? 0,
          };
        } catch (err) {
          return { error: err.status === 429 ? "Riot está limitando las consultas. Probá en un minuto." : err.message };
        }
      })
    );
  }

  const players = cfg.players
    .map((p, i) => {
      const r = rows[i];
      const base = p.baseline || { wins: 0, losses: 0 };
      // Si cargaste un "baseline" al inicio del torneo, contamos solo lo jugado desde entonces.
      const wins = Math.max(0, (r.wins ?? 0) - base.wins);
      const losses = Math.max(0, (r.losses ?? 0) - base.losses);
      const [name, tag] = p.riotId.split("#");
      return {
        alias: p.alias || name,
        riotId: p.riotId,
        opggUrl: `https://op.gg/lol/summoners/${cfg.opggRegion}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`,
        puuid: r.puuid ?? null,
        tier: r.tier ?? null,
        rank: r.rank ?? null,
        lp: r.lp ?? 0,
        wins,
        losses,
        score: r.tier ? rankScore({ tier: r.tier, rank: r.rank, leaguePoints: r.lp }) : -1,
        error: r.error ?? null,
      };
    })
    .sort((a, b) => b.score - a.score || b.wins - a.wins);

  return json(
    {
      title: cfg.title,
      edition: cfg.edition || null,
      start: cfg.start,
      end: cfg.end,
      demo,
      updatedAt: new Date().toISOString(),
      players,
    },
    demo ? 0 : 120
  );
}
