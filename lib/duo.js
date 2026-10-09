// Panel del organizador: detección de posibles dúos y días con el límite superado.
//
// Riot no dice si una partida se jugó en dúo, pero cada partida trae a los 10 jugadores
// y su equipo, así que buscamos compañeros que se repiten demasiado. Es una ALERTA, no
// una prueba.
//
// Está pensado para gastar lo mínimo, aunque haya 20 jugadores:
//   - Cada vez que se recalcula la tabla (el cron lo hace cada 5 minutos) se mira, por
//     jugador, si jugó algo nuevo. Si no jugó, no se le consulta nada a Riot.
//   - Si jugó, se trae solo la partida nueva y se analiza una ventana con sus últimas
//     12 partidas. No se revisa el historial completo.
//   - Las sospechas ALTAS y los días pasados del límite quedan guardados en un histórico
//     con fecha, así no se pierden cuando salen de la ventana.
// El panel solo lee lo guardado: abre al instante y no le consulta nada a Riot.
//
// En KV (binding `LP`):
//   watch:<puuid> → { games, seen, window, days, suspects, history, checkedAt, more }

import { getMatch, isRemake, riotFetch, tzOffset } from "./riot.js";

export const WINDOW = 12; // cuántas partidas recientes se analizan
const MAX_NEW = 4; // partidas nuevas que se procesan por jugador en cada pasada
const MAX_HISTORY = 100;

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

export const emptyState = () => ({ games: null, seen: [], window: [], days: {}, suspects: [], history: [], checkedAt: null, more: false });

// Suma partidas nuevas al estado de un jugador: actualiza la ventana, el conteo por día,
// las sospechas actuales y, si corresponde, el histórico.
export function applyRecords(state, fresh, cfg, roster = new Map(), now = Date.now()) {
  const limit = cfg.dailyLimit ?? 12;
  const offset = tzOffset(cfg);
  const dayOf = (t) => new Date(t + offset).toISOString().slice(0, 10);
  const stamp = new Date(now).toISOString();

  for (const r of fresh) {
    state.seen.push(r.id);
    const d = (state.days[dayOf(r.t)] ||= { played: 0, remakes: 0 });
    if (r.remake) d.remakes++; else d.played++;
  }
  state.seen = state.seen.slice(-40);
  state.window = [...state.window, ...fresh].sort((a, b) => a.t - b.t).slice(-WINDOW);
  state.suspects = analyze(state.window, cfg, roster).suspects;

  // Histórico: las sospechas altas. Si la misma persona vuelve a aparecer, se actualiza
  // con el peor caso visto en lugar de duplicarse.
  for (const s of state.suspects) {
    if (s.level !== "alto") continue;
    const streak = s.streak?.count || 0;
    const from = s.streak?.from || s.day?.date || dayOf(now);
    const to = s.streak?.to || s.day?.date || dayOf(now);
    const old = state.history.find((h) => h.kind === "duo" && h.id === s.id);
    if (!old) {
      state.history.push({ kind: "duo", id: s.id, name: s.name, opggUrl: s.opggUrl, participant: s.participant, at: stamp, lastAt: stamp, streak, from, to, together: s.together, against: s.against, chance: s.chance });
    } else {
      old.lastAt = stamp;
      old.name = s.name;
      if (to > old.to) old.to = to;
      if (streak > old.streak || s.together > old.together) Object.assign(old, { streak: Math.max(streak, old.streak), together: s.together, against: s.against, chance: s.chance });
    }
  }
  // Histórico: los días en que jugó más partidas que el límite.
  for (const [date, d] of Object.entries(state.days)) {
    if (d.played <= limit) continue;
    const old = state.history.find((h) => h.kind === "limit" && h.date === date);
    if (!old) state.history.push({ kind: "limit", date, played: d.played, over: d.played - limit, at: stamp });
    else Object.assign(old, { played: d.played, over: d.played - limit });
  }
  state.history = state.history.slice(-MAX_HISTORY);
  state.checkedAt = stamp;
  return state;
}

// Revisa a un jugador. `entry` es su rango actual (trae victorias y derrotas totales): si
// el total no cambió desde la última vez, no jugó nada y no se consulta a Riot.
// `budget.left` reparte las consultas de una pasada entre todos los jugadores, para no
// superar el tope de Cloudflare; al que no le toca, se lo revisa en la pasada siguiente.
export async function watchPlayer(puuid, entry, cfg, env, roster, budget = { left: 12 }) {
  if (!env.LP) return;
  const key = `watch:${puuid}`;
  const state = (await env.LP.get(key, "json")) || emptyState();
  const total = entry ? entry.wins + entry.losses : 0;
  if (state.games === total && !state.more) return;
  if (budget.left < 2) return;

  // Las últimas partidas de SoloQ desde que empezó el torneo (las más nuevas primero).
  const start = Math.floor(new Date(cfg.start).getTime() / 1000);
  let ids = [];
  if (start * 1000 <= Date.now()) {
    budget.left--;
    ids = (await riotFetch(`https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${start}&count=${WINDOW}`, env)) || [];
  }
  const unseen = ids.filter((id) => !state.seen.includes(id)).reverse(); // primero las más viejas
  const batch = unseen.slice(0, Math.min(MAX_NEW, budget.left));
  budget.left -= batch.length;
  const loaded = await Promise.all(batch.map((id) => getMatch(id, cfg, env)));
  applyRecords(state, loaded.filter(Boolean).map((m) => toRecord(m, puuid)), cfg, roster);

  // A veces el rango ya cuenta la partida pero Riot todavía no la publicó en el historial:
  // se reintenta una vez en la pasada siguiente.
  const waiting = total !== state.games && unseen.length === 0 && !state.retried;
  state.retried = waiting;
  state.more = unseen.length > batch.length || waiting;
  state.games = total;
  await env.LP.put(key, JSON.stringify(state));
}

// Lo que ve el panel de un jugador. De cada sospecha no viaja el identificador interno.
export function adminView(state) {
  const clean = ({ id, ...rest }) => rest;
  return {
    checkedAt: state.checkedAt,
    current: state.suspects.map(clean),
    history: state.history.map(clean).sort((a, b) => (a.at < b.at ? 1 : -1)),
  };
}

export async function loadState(puuid, env) {
  return (env.LP && (await env.LP.get(`watch:${puuid}`, "json"))) || emptyState();
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
  for (const [id, s] of people) {
    const [topDay, topCount] = [...s.perDay].sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const run = s.best?.count || 0;
    const byStreak = run >= rules.streak;
    const byDay = topCount >= rules.perDay;
    const byNever = s.against === 0 && s.together >= rules.never;
    if (!byStreak && !byDay && !byNever) continue;
    const participant = roster.get(s.name.toLowerCase()) || null; // es otro jugador del torneo
    const [name, tag = ""] = s.name.split("#");
    suspects.push({
      id,
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
