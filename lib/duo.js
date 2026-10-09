// Panel del organizador: detección de posibles dúos y días con el límite superado.
//
// Riot no dice si una partida se jugó en dúo, pero cada partida trae a los 10 jugadores
// y su equipo. Guardamos, por cada partida del torneo, con quién jugó cada participante
// y buscamos compañeros que se repiten demasiado. Es una ALERTA, no una prueba.
//
// En KV (binding `LP`):
//   mates:<puuid> → [{ id, t, remake, win, mates: [[puuid, "Nombre#TAG"]], foes: [...] }]
// Sin KV funciona igual, pero hay que volver a pedirle todo a Riot cada vez.

import { getMatch, isRemake, riotGet, tzOffset } from "./riot.js";

const PAGE = 100;

// IDs de todas las partidas de SoloQ del jugador durante el torneo (las más nuevas primero).
async function tournamentMatchIds(puuid, cfg, env) {
  const start = Math.floor(new Date(cfg.start).getTime() / 1000);
  const end = Math.floor(new Date(cfg.end).getTime() / 1000);
  if (start * 1000 > Date.now()) return []; // el torneo todavía no empezó
  const ids = [];
  for (let page = 0; page < 3; page++) {
    const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${start}&endTime=${end}&start=${page * PAGE}&count=${PAGE}`;
    const chunk = (await riotGet(url, env, 120)) || [];
    ids.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return ids;
}

function toRecord(match, puuid) {
  const me = match.info.participants.find((p) => p.puuid === puuid);
  const tag = (p) => [p.puuid, `${p.riotIdGameName}#${p.riotIdTagline}`];
  const others = match.info.participants.filter((p) => p.puuid !== puuid);
  return {
    id: match.metadata.matchId,
    t: match.info.gameStartTimestamp ?? match.info.gameCreation,
    remake: isRemake(match),
    win: me.win,
    mates: others.filter((p) => p.teamId === me.teamId).map(tag),
    foes: others.filter((p) => p.teamId !== me.teamId).map(tag),
  };
}

export async function loadRecords(puuid, env) {
  if (!env.LP) return [];
  return (await env.LP.get(`mates:${puuid}`, "json")) || [];
}

// Trae de Riot las partidas del torneo que todavía no tenemos guardadas. Como cada partida es
// una llamada y Cloudflare gratis permite 50 por pedido, se hace de a `budget` por vez:
// `pending` dice cuántas faltan y el panel vuelve a llamar hasta que quede en 0.
export async function syncRecords(puuid, cfg, env, budget = 30) {
  const [ids, stored] = await Promise.all([tournamentMatchIds(puuid, cfg, env), loadRecords(puuid, env)]);
  const have = new Set(stored.map((r) => r.id));
  const missing = ids.filter((id) => !have.has(id));
  const batch = missing.slice(-budget); // primero las más viejas
  const loaded = await Promise.all(batch.map((id) => getMatch(id, cfg, env)));
  const fresh = loaded.filter(Boolean).map((m) => toRecord(m, puuid));
  const records = [...stored, ...fresh].sort((a, b) => a.t - b.t);
  if (fresh.length && env.LP) await env.LP.put(`mates:${puuid}`, JSON.stringify(records));
  return { records, pending: missing.length - fresh.length };
}

// Probabilidad de que, cruzándose por casualidad `n` veces, a dos jugadores les toque el
// mismo equipo `same` veces o más. Por azar es 4 de 9 cada vez (de los otros 9 lugares de
// la partida, 4 son de tu equipo); un dúo cae siempre del mismo lado.
function chanceSameTeam(same, n) {
  const p = 4 / 9;
  const comb = (a, b) => { let c = 1; for (let k = 1; k <= b; k++) c = (c * (a - b + k)) / k; return c; };
  let total = 0;
  for (let k = same; k <= n; k++) total += comb(n, k) * p ** k * (1 - p) ** (n - k);
  return total;
}

// Analiza las partidas guardadas de un jugador.
// `roster` es un Map de "nombre#tag" en minúsculas → alias, para marcar a otros participantes.
export function analyze(records, cfg, roster = new Map()) {
  // Que te toque alguien una vez pasa; dos seguidas ya es sospechoso y tres, muy improbable.
  const rules = {
    streak: cfg.duo?.streak ?? 2, // partidas seguidas en el mismo equipo que generan sospecha
    highStreak: cfg.duo?.highStreak ?? 3, // desde cuántas seguidas la sospecha es alta
    perDay: cfg.duo?.perDay ?? 4, // juntos en un mismo día, aunque no sean seguidas
    never: cfg.duo?.neverAgainst ?? 5, // juntos en total sin haberse enfrentado nunca
  };
  const limit = cfg.dailyLimit ?? 12;
  const offset = tzOffset(cfg);
  const dayOf = (t) => new Date(t + offset).toISOString().slice(0, 10);

  const days = new Map(); // día → { played, remakes }
  const people = new Map(); // puuid → cuántas veces jugó con y contra el participante
  const person = ([id, name]) => {
    let s = people.get(id);
    if (!s) people.set(id, (s = { together: 0, against: 0, run: 0, runFrom: 0, best: null, perDay: new Map() }));
    s.name = name;
    return s;
  };

  for (const r of [...records].sort((a, b) => a.t - b.t)) {
    const day = dayOf(r.t);
    const d = days.get(day) || { played: 0, remakes: 0 };
    days.set(day, d);
    if (r.remake) { d.remakes++; continue; } // las remakes no cuentan ni cortan una racha
    d.played++;

    const here = new Set();
    for (const mate of r.mates) {
      const s = person(mate);
      here.add(mate[0]);
      s.together++;
      if (s.run === 0) s.runFrom = r.t;
      s.run++;
      if (!s.best || s.run > s.best.count) s.best = { count: s.run, from: s.runFrom, to: r.t };
      s.perDay.set(day, (s.perDay.get(day) || 0) + 1);
    }
    for (const foe of r.foes) person(foe).against++;
    for (const [id, s] of people) if (!here.has(id)) s.run = 0;
  }

  const suspects = [];
  for (const s of people.values()) {
    const [topDay, topCount] = [...s.perDay].sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const run = s.best?.count || 0;
    const byStreak = run >= rules.streak;
    const byDay = topCount >= rules.perDay;
    const byNever = s.against === 0 && s.together >= rules.never;
    if (!byStreak && !byDay && !byNever) continue;
    const participant = roster.get(s.name.toLowerCase()) || null; // es otro jugador del torneo
    const [name, tag = ""] = s.name.split("#");
    suspects.push({
      name: s.name,
      opggUrl: `https://op.gg/lol/summoners/${cfg.opggRegion}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`,
      participant,
      // Entre participantes alcanza con la racha mínima: son pocos y cruzarse seguido no es casual.
      level: run >= rules.highStreak || byNever || (participant && byStreak) ? "alto" : "medio",
      together: s.together,
      against: s.against,
      chance: chanceSameTeam(s.together, s.together + s.against),
      streak: byStreak ? { count: run, from: dayOf(s.best.from), to: dayOf(s.best.to) } : null,
      day: byDay ? { count: topCount, date: topDay } : null,
    });
  }
  suspects.sort((a, b) => (a.level === b.level ? 0 : a.level === "alto" ? -1 : 1) || (b.streak?.count || 0) - (a.streak?.count || 0) || a.chance - b.chance);

  const dayList = [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, d]) => ({ date, ...d, over: Math.max(0, d.played - limit) }));
  return {
    rules,
    limit,
    games: dayList.reduce((n, d) => n + d.played, 0),
    remakes: dayList.reduce((n, d) => n + d.remakes, 0),
    suspects,
    days: dayList,
  };
}
