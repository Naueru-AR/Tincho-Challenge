// Datos extra de cada partida para el historial, que cuestan consultas a Riot y por eso los
// calcula el cron en segundo plano (ver watchPlayer en lib/duo.js):
//   - lane: cómo le fue en la fase de líneas contra el rival de su mismo carril, al minuto 15.
//     Es el promedio de su parte del oro, la experiencia y el CS de los dos (50 = parejo).
//     Sale del timeline de la partida (1 consulta).
//   - avg: el rango promedio de los 10 jugadores de la partida (SoloQ, al momento de
//     calcularlo). Es 1 consulta por jugador, salvo los que ya se conocen.
// El resultado se guarda dentro del estado del jugador (watch:<puuid>), sin escrituras extra.
import { TIERS, getMatch, getSoloQ, rankScore, riotFetch } from "./riot.js";

const LANE_MINUTE = 15;
const RANK_TTL = 6 * 60 * 60 * 1000; // el rango de los demás jugadores se reusa 6 horas
const ranks = new Map(); // puuid → { entry, until } (memoria, mientras el servidor siga despierto)

// Rango promedio a partir de un puntaje (ver rankScore): Master o más no tiene divisiones.
function fromScore(score) {
  const t = Math.min(Math.floor(score / 400), 7);
  if (t >= 7) return { tier: "MASTER", rank: null };
  return { tier: TIERS[t], rank: ["IV", "III", "II", "I"][Math.floor((score % 400) / 100)] };
}

// Calcula los datos extra de una partida para `puuid`. `known` es un Map puuid → rango (entry
// o null) con los que ya se conocen (los participantes del torneo). `budget.left` limita las
// consultas a Riot: si no alcanzan para terminar esta partida, devuelve null y no gasta nada.
export async function matchDetails(matchId, puuid, cfg, env, known, budget) {
  const m = await getMatch(matchId, cfg, env);
  if (!m) return { lane: null, avg: null };
  const now = Date.now();
  const rankOf = (id) => (known.has(id) ? known.get(id) : ranks.get(id)?.until > now ? ranks.get(id).entry : undefined);
  const missing = m.info.participants.filter((p) => rankOf(p.puuid) === undefined);
  if (missing.length + 1 > budget.left) return null;

  for (const p of missing) {
    budget.left--;
    const entry = await getSoloQ(p.puuid, cfg, env);
    ranks.set(p.puuid, { entry, until: now + RANK_TTL });
  }
  if (ranks.size > 3000) ranks.clear();
  const scores = m.info.participants.map((p) => rankOf(p.puuid)).filter(Boolean).map(rankScore);
  const avg = scores.length ? fromScore(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  budget.left--;
  return { lane: await laneShare(m, puuid, cfg, env), avg };
}

// Su parte del oro, la experiencia y el CS contra el rival de su carril, al minuto 15 (o al
// último minuto, si la partida duró menos). null si no se puede saber quién era el rival.
async function laneShare(m, puuid, cfg, env) {
  const me = m.info.participants.find((p) => p.puuid === puuid);
  const opp = me?.teamPosition && m.info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);
  if (!opp) return null;
  const tl = await riotFetch(`https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/${m.metadata.matchId}/timeline`, env);
  const frames = tl?.info?.frames;
  if (!frames?.length) return null;
  const frame = frames[Math.min(LANE_MINUTE, frames.length - 1)].participantFrames;
  const ids = tl.metadata.participants; // puuids, en el orden de participantId 1..10
  const stats = (id) => {
    const f = frame[String(ids.indexOf(id) + 1)];
    return f && [f.totalGold, f.xp, f.minionsKilled + f.jungleMinionsKilled];
  };
  const a = stats(me.puuid), b = stats(opp.puuid);
  if (!a || !b) return null;
  const shares = a.map((v, i) => (v + b[i] ? v / (v + b[i]) : 0.5));
  return Math.round((shares.reduce((x, y) => x + y, 0) / shares.length) * 100);
}
