// GET /api/leaderboard
// Devuelve a cada participante con su rango de SoloQ y su winrate.
import { loadConfig, getAccount, getSoloQ, getProfileIcon, rankScore, cachedResponse, recall, remember, withBudget, json, isDemo } from "../../lib/riot.js";
import { demoLeaderboard, demoPlayers } from "../../lib/demo.js";
import { trackLp } from "../../lib/lp.js";
import { watchPlayer } from "../../lib/duo.js";

// Cloudflare gratis permite 50 consultas por pedido, contando las de caché. Este endpoint
// usa hasta 5 de caché y archivos, así que a Riot se le pueden hacer como mucho estas:
const RIOT_BUDGET = 42;
const LAST_GOOD = "leaderboard-last-good";

// Le pide a Riot el rango de cada jugador. Va por prioridad: primero lo imprescindible
// (cuenta y rango), después los íconos y al final, en segundo plano, lo del panel.
async function loadRows(cfg, context, env) {
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
        // `retry` marca los errores pasajeros (Riot saturado, tope de consultas): esa fila se
        // completa con el último dato bueno y la respuesta no se guarda en caché.
        return { retry: true, error: err.status === 429 ? "Riot está limitando las consultas. Probá en un minuto." : err.message };
      }
    })
  );

  // El ícono es un adorno (en caché 24 horas): si no se puede pedir ahora, queda el anterior.
  await Promise.all(
    rows.map(async (r) => {
      if (r.puuid) r.profileIconId = await getProfileIcon(r.puuid, cfg, env).catch(() => null);
    })
  );

  // En segundo plano (no demora la respuesta) y de a un jugador por vez: anotamos los LP de
  // la última partida y revisamos si jugó algo nuevo, para el panel del organizador. Si se
  // acaban las consultas de esta pasada, lo que falte se hace en la siguiente.
  const roster = new Map(cfg.players.map((p) => [p.riotId.toLowerCase(), p.alias || p.riotId.split("#")[0]]));
  const budget = { left: 12 };
  context.waitUntil(
    (async () => {
      const log = (what) => (err) => { if (err.status !== "budget") console.log(what, err.message); };
      for (const r of rows) {
        if (env.riotBudget.left <= 0) break; // sin consultas: el resto queda para la próxima pasada
        if (!r.puuid) continue;
        if (r.entry) await trackLp(r.puuid, r.entry, rankScore(r.entry), cfg, env).catch(log("trackLp:"));
        await watchPlayer(r.puuid, r.entry, cfg, env, roster, budget).catch(log("watchPlayer:"));
      }
    })()
  );
  return rows;
}

function body(cfg, rows, demo) {
  // Corte entre brackets: desde este rango (inclusive) es High Elo; por debajo, Low Elo.
  const cut = cfg.highEloFrom || { tier: "DIAMOND", rank: "III" };
  const highEloScore = rankScore({ tier: cut.tier, rank: cut.rank || "IV", leaguePoints: 0 });

  const players = cfg.players.map((p, i) => {
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
  });

  return {
    title: cfg.title,
    edition: cfg.edition || null,
    start: cfg.start,
    end: cfg.end,
    highEloFrom: cut,
    // Momento en que empiezan los últimos días del torneo, con el cupo de partidas liberado.
    freeFrom: new Date(new Date(cfg.end).getTime() - (cfg.freeLastDays ?? 3) * 24 * 60 * 60 * 1000).toISOString(),
    demo,
    updatedAt: new Date().toISOString(),
    players,
  };
}

const sorted = (players) => [...players].sort((a, b) => b.score - a.score || b.wins - a.wins);

export async function onRequestGet(context) {
  const cfg = await loadConfig(context);
  if (isDemo(context)) {
    const sample = { ...cfg, players: demoPlayers(cfg) };
    const data = body(sample, demoLeaderboard(sample), true);
    return json({ ...data, players: sorted(data.players) }, 0);
  }

  // La respuesta entera queda en caché 2 minutos: aunque mucha gente mire la tabla a la
  // vez, a Riot se le consulta como mucho una vez cada 2 minutos.
  return cachedResponse(context, async () => {
    const rows = await loadRows(cfg, context, withBudget(context.env, RIOT_BUDGET));
    const data = body(cfg, rows, false);
    const failed = rows.map((r) => Boolean(r.retry));
    const complete = !failed.some(Boolean);

    // Para que la tabla no muestre huecos: si a un jugador no se lo pudo consultar ahora
    // (o le falta el ícono), se usa su dato de la última vez que salió todo bien.
    if (!complete || data.players.some((p) => p.puuid && p.profileIconId === null)) {
      const old = new Map(((await recall(context, LAST_GOOD))?.players || []).map((p) => [p.riotId, p]));
      data.players = data.players.map((p, i) => {
        const prev = old.get(p.riotId);
        if (!prev) return p;
        if (failed[i]) return prev;
        return p.profileIconId === null ? { ...p, profileIconId: prev.profileIconId } : p;
      });
    }
    data.players = sorted(data.players);
    if (complete) remember(context, LAST_GOOD, data, 60 * 60 * 24);
    return { response: json(data, 120), cacheable: complete };
  });
}
