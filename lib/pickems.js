// Pickems: antes del torneo, cada participante predice cómo va a terminar. Hay 2000 puntos
// repartidos entre las preguntas.
//
// Solo votan los participantes de participants.json, con su Riot ID y un PIN de 4 dígitos
// que eligen la primera vez. Se puede votar y cambiar los picks hasta el cierre
// (`pickems.closes` en participants.json, o el inicio del torneo si no está); desde ahí
// quedan bloqueados y se ven los de todos. Al terminar, se recuentan todas
// las partidas del torneo de cada jugador y se calculan los puntos (ver "recuento final").
//
// En KV (binding `LP`):
//   pick:<riot id en minúsculas> → { riotId, salt, hash, picks, at }
//   pickfail:<riot id en minúsculas> → intentos de PIN fallidos (vence a los 15 minutos)
//   pickems:final → la tabla al terminar el torneo, guardada una sola vez
//   pickems:calc → el recuento final de partidas, con su avance
//   pickems:manual → los resultados que carga el organizador desde el panel (ver MANUAL)

import { getMatch, isRemake, riotFetch } from "./riot.js";

// `kind`: "player" (un participante; con `none` también se puede elegir "Nadie"), "top3"
// (tres en orden), "champ" (un campeón del LoL), "option" (una de `options`) o "quit" (Sí/No
// más un nombre opcional que suma `bonus`). `target` es el participante por el que pregunta.
// Las de `manual` no se pueden calcular solas: el resultado lo carga el organizador en el
// panel. Las posiciones son de la tabla general (sin categorías).
// Van ordenadas por el tamaño de su tarjeta en la página (las de campeón, con la grilla de
// fotos, al final), no por puntos.
export const QUESTIONS = [
  { id: "bestWr", kind: "player", points: 180, text: "Mejor winrate del torneo", note: "Entre los que jueguen al menos {minGames} partidas." },
  { id: "worstWr", kind: "player", points: 160, text: "Peor winrate del torneo", note: "Entre los que jueguen al menos {minGames} partidas." },
  { id: "winner", kind: "player", points: 150, text: "Ganador del torneo", note: "El primero de la tabla general." },
  { id: "last", kind: "player", points: 140, text: "Último del torneo", note: "El último de la tabla general." },
  { id: "mostGames", kind: "player", points: 120, text: "¿Quién juega más partidas?" },
  { id: "leastGames", kind: "player", points: 110, text: "¿Quién juega menos partidas?" },
  { id: "bestKda", kind: "player", points: 100, text: "Mejor KDA del torneo", note: "(Asesinatos + asistencias) / muertes, entre los que jueguen al menos {minGames} partidas." },
  { id: "mostDeaths", kind: "player", points: 100, text: "¿Quién muere más en todo el torneo?" },
  { id: "longestGame", kind: "player", points: 90, text: "¿Quién juega la partida más larga?" },
  { id: "shortestGame", kind: "player", points: 90, text: "¿Quién juega la partida más corta?", note: "Sin contar las remakes." },
  { id: "mostKills", kind: "player", points: 80, text: "¿Quién hace más kills en una partida?" },
  { id: "mostAssists", kind: "player", points: 50, text: "¿Quién hace más asistencias en una partida?" },
  { id: "penta", kind: "option", options: ["Sí", "No"], points: 50, text: "¿Alguien se hace un pentakill?" },
  { id: "masters", kind: "option", options: ["1", "2", "3", "4", "5+"], points: 40, text: "¿Cuántos jugadores terminan en Master o más?", note: "Si no termina ninguno, nadie suma." },
  { id: "firstBan", kind: "player", none: true, manual: true, points: 100, text: "¿Quién será el primer baneado?", note: "Si nadie es baneado, acierta \"Nadie\". Lo carga el organizador." },
  { id: "liandDiamond", kind: "option", options: ["Sí", "No"], target: "tdg ASOLutosex#TDG", points: 50, text: "¿Liand (tdg ASOLutosex) termina en Diamante o más?" },
  { id: "aheru60", kind: "option", options: ["Sí", "No"], target: "TDG WeepingAngel#TDG", games: 60, points: 50, text: "¿Aheru (TDG WeepingAngel) juega más de 60 partidas?", note: "Sin contar las remakes." },
  { id: "quit", kind: "quit", options: ["Sí", "No"], manual: true, points: 50, bonus: 50, text: "¿Alguien abandona el SoloQ?", note: "Opcional: si además acertás quién, +50 puntos. Lo carga el organizador." },
  { id: "overachiever", kind: "player", manual: true, points: 100, text: "¿Quién supera las expectativas?", note: "Se define con una votación al terminar el torneo. Lo carga el organizador." },
  { id: "top3", kind: "top3", points: 210, text: "Top 3 del torneo, en orden", note: "Tabla general, sin importar la categoría. 20 puntos por cada jugador que termina en el Top 3 y 50 más si además acertás su puesto." },
  { id: "champWr", kind: "champ", points: 200, text: "Campeón con más winrate", note: "Entre los que se jueguen al menos {minChampGames} partidas, sumando a todos." },
  { id: "champPlayers", kind: "champ", points: 130, text: "Campeón jugado por más jugadores distintos", note: "No importa cuántas partidas lo juegue cada uno." },
];

// Hasta cuándo se puede votar.
export const closesAt = (cfg) => cfg.pickems?.closes || cfg.start;

// Puntaje máximo: todas las preguntas más los bonus.
export const MAX = QUESTIONS.reduce((n, q) => n + q.points + (q.bonus || 0), 0);
export const NONE = "none"; // el valor de "Nadie"

export const rules = (cfg) => ({
  minGames: cfg.pickems?.minGames ?? 20,
  minChampGames: cfg.pickems?.minChampGames ?? 10,
});

// Los participantes escriben su Riot ID de distintas formas ("TDG Kairo #TDG", "tdg kairo#tdg"):
// se compara sin mayúsculas ni espacios de más.
export const norm = (riotId) => String(riotId || "").toLowerCase().replace(/\s*#\s*/, "#").replace(/\s+/g, " ").trim();
export const findPlayer = (cfg, riotId) => cfg.players.find((p) => norm(p.riotId) === norm(riotId)) || null;
export const aliasOf = (p) => p.alias || p.riotId.split("#")[0];

/* ---------- PIN ---------- */
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(12)));
export async function hashPin(pin, salt) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`)));
}

/* ---------- validación de picks ---------- */
// Se guarda solo lo que tiene forma válida; lo que falta o no corresponde queda vacío
// (no suma puntos). Los jugadores se guardan por Riot ID, tal como está en participants.json.
export function cleanPicks(raw, cfg) {
  const out = {};
  const player = (v) => findPlayer(cfg, v)?.riotId || null;
  for (const q of QUESTIONS) {
    const v = raw?.[q.id];
    if (q.kind === "player") out[q.id] = q.none && v === NONE ? NONE : player(v);
    if (q.kind === "quit") {
      const answer = q.options.includes(v?.answer) ? v.answer : null;
      out[q.id] = answer && { answer, name: answer === "Sí" ? player(v.name) : null };
    }
    if (q.kind === "top3") {
      const list = Array.isArray(v) ? v.slice(0, 3).map(player) : [];
      // Un mismo jugador no puede ocupar dos puestos.
      out[q.id] = [0, 1, 2].map((i) => (list[i] && list.indexOf(list[i]) === i ? list[i] : null));
    }
    if (q.kind === "champ") out[q.id] = typeof v === "string" && /^[A-Za-z]{2,30}$/.test(v) ? v : null;
    if (q.kind === "option") out[q.id] = q.options.includes(v) ? v : null;
  }
  return out;
}

// Preguntas sin responder (o con el Top 3 incompleto). Todas son obligatorias.
export const missing = (picks) =>
  QUESTIONS.filter((q) => (q.kind === "top3" ? !picks[q.id]?.every(Boolean) : q.kind === "quit" ? !picks[q.id]?.answer : !picks[q.id]));

/* ---------- resultados que carga el organizador ---------- */
// Lo que manda el panel se guarda solo si tiene forma válida.
export function cleanManual(raw, cfg) {
  const player = (v) => findPlayer(cfg, v)?.riotId || null;
  const quit = ["Sí", "No"].includes(raw?.quit) ? raw.quit : null;
  return {
    firstBan: raw?.firstBan === NONE ? NONE : player(raw?.firstBan),
    overachiever: player(raw?.overachiever),
    quit,
    quitNames: quit === "Sí" && Array.isArray(raw.quitNames) ? [...new Set(raw.quitNames.map(player).filter(Boolean))] : [],
  };
}
export const MANUAL = "pickems:manual";

/* ---------- tabla final ---------- */
// La primera vez que la tabla sale completa después del final, se guarda tal cual. Así los
// puntos no cambian aunque alguien siga jugando cuando ya terminó el torneo.
export async function saveFinal(env, data) {
  if (!env.LP || (await env.LP.get("pickems:final"))) return;
  const players = data.players.map(({ riotId, alias, puuid, tier, rank, lp, score, bracket }) => ({ riotId, alias, puuid, tier, rank, lp, score, bracket }));
  await env.LP.put("pickems:final", JSON.stringify({ at: data.updatedAt, players }));
}

/* ---------- recuento final ----------
   Las estadísticas NO se van sumando durante el torneo: recién cuando termina (más un margen
   para que Riot publique las últimas partidas) se trae el historial completo de SoloQ de cada
   jugador entre el inicio y el final y se cuenta todo desde cero. Así no quedan "puntos
   fantasmas" por una pasada que falló o una partida que se procesó a medias.
   Son muchas partidas, así que se hace de a tandas en cada pasada del cron y el avance queda
   en KV (`pickems:calc`). Hasta que no termina con todos, la página no muestra puntos. */
const CALC = "pickems:calc";
const PER_PASS = 120; // partidas que se procesan como mucho por pasada (lecturas de KV)

export const calcReadyAt = (cfg) => new Date(cfg.end).getTime() + (cfg.pickems?.waitMinutes ?? 60) * 60000;

const emptyStats = () => ({ games: 0, w: 0, l: 0, k: 0, d: 0, a: 0, maxK: 0, maxA: 0, pentas: 0, long: null, short: null, champs: {} });

// Suma una partida a las estadísticas de un jugador. Las remakes no cuentan.
export function addMatch(st, match, puuid) {
  const me = match?.info.participants.find((p) => p.puuid === puuid);
  if (!me || isRemake(match)) return st;
  st.games++;
  if (me.win) st.w++; else st.l++;
  st.k += me.kills; st.d += me.deaths; st.a += me.assists;
  st.maxK = Math.max(st.maxK, me.kills);
  st.maxA = Math.max(st.maxA, me.assists);
  st.pentas += me.pentaKills || 0;
  const dur = match.info.gameDuration;
  st.long = Math.max(st.long ?? 0, dur);
  st.short = Math.min(st.short ?? Infinity, dur);
  const c = (st.champs[me.championName] ||= [0, 0]);
  c[0]++;
  if (me.win) c[1]++;
  return st;
}

// Todas las partidas de SoloQ del jugador que empezaron durante el torneo (de a 100 por consulta).
async function tournamentIds(puuid, cfg, env) {
  const from = Math.floor(new Date(cfg.start).getTime() / 1000);
  const to = Math.floor(new Date(cfg.end).getTime() / 1000);
  const ids = [];
  for (let start = 0; ; start += 100) {
    const page = (await riotFetch(`https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${from}&endTime=${to}&start=${start}&count=100`, env)) || [];
    ids.push(...page);
    if (page.length < 100) return ids;
  }
}

// Un paso del recuento. `rows` son las filas de la tabla (traen el PUUID de cada jugador).
// Lo llama la tabla en segundo plano, después del final; no hace nada si ya terminó.
export async function calcStep(cfg, env, rows, now = Date.now()) {
  if (!env.LP || now < calcReadyAt(cfg)) return;
  const calc = (await env.LP.get(CALC, "json")) || { done: false, players: {} };
  if (calc.done) return;
  let left = PER_PASS;
  try {
    for (const [i, p] of cfg.players.entries()) {
      const r = rows[i];
      const c = (calc.players[p.riotId] ||= { ids: null, next: 0, stats: emptyStats() });
      if (c.ids && c.next >= c.ids.length) continue;
      if (!r?.puuid) {
        if (r && !r.retry) c.ids = []; // la cuenta no existe: no jugó nada
        continue;
      }
      if (!c.ids) c.ids = await tournamentIds(r.puuid, cfg, env);
      while (c.next < c.ids.length && left > 0) {
        addMatch(c.stats, await getMatch(c.ids[c.next], cfg, env), r.puuid);
        c.next++;
        left--;
      }
      if (left <= 0) break;
    }
  } catch (err) {
    if (err.status !== "budget") console.log("calcStep:", err.message); // se sigue en la próxima pasada
  }
  calc.done = cfg.players.every((p) => calc.players[p.riotId]?.ids && calc.players[p.riotId].next >= calc.players[p.riotId].ids.length);
  if (calc.done) calc.at = new Date(now).toISOString();
  await env.LP.put(CALC, JSON.stringify(calc));
}

// Estadísticas finales de cada jugador (por Riot ID), o null si el recuento no terminó.
export async function finalStats(env) {
  const calc = await env.LP.get(CALC, "json");
  if (!calc?.done) return null;
  return Object.fromEntries(Object.entries(calc.players).map(([id, c]) => [id, c.stats]));
}

/* ---------- resultados ---------- */
const APEX = ["MASTER", "GRANDMASTER", "CHALLENGER"];
const best = (items, value, dir = 1) => {
  if (!items.length) return [];
  const top = Math.max(...items.map((x) => dir * value(x)));
  return items.filter((x) => dir * value(x) === top);
};

// Calcula la respuesta correcta de cada pregunta. Cada respuesta es una lista: si hay empate,
// vale cualquiera de los empatados. Una lista vacía significa que la pregunta quedó sin
// resolver (nadie suma). `final` es la tabla guardada al terminar, `stats` el recuento de
// cada participante (por Riot ID) y `manual` lo que cargó el organizador (ver MANUAL).
export function answers(cfg, final, stats, manual = {}) {
  const { minGames, minChampGames } = rules(cfg);
  // Tabla general, ya ordenada. Los que no tienen rango (nunca jugaron SoloQ) no entran.
  const table = final.players.filter((p) => p.tier);

  const people = cfg.players.map((p) => {
    const st = stats[p.riotId] || emptyStats();
    const decided = st.w + st.l;
    return {
      riotId: p.riotId, games: st.games, decided, champs: st.champs,
      wr: decided ? st.w / decided : 0,
      kda: (st.k + st.a) / Math.max(1, st.d), // sin muertes, se divide por 1
      deaths: st.d, maxK: st.maxK, maxA: st.maxA, pentas: st.pentas, long: st.long, short: st.short,
    };
  });

  // Winrate y KDA: entre los que jugaron el mínimo. Si nadie llegó, entre todos los que jugaron.
  let eligible = people.filter((p) => p.decided >= minGames);
  if (!eligible.length) eligible = people.filter((p) => p.decided > 0);

  const champs = new Map(); // campeón → { players, games, wins }
  for (const p of people) {
    for (const [name, [g, w]] of Object.entries(p.champs)) {
      const c = champs.get(name.toLowerCase()) || { name, players: 0, games: 0, wins: 0 };
      c.players++; c.games += g; c.wins += w;
      champs.set(name.toLowerCase(), c);
    }
  }
  const champList = [...champs.values()];
  const champWr = champList.filter((c) => c.games >= minChampGames);

  const ids = (list) => list.map((p) => p.riotId);
  const masters = final.players.filter((p) => APEX.includes(p.tier)).length;
  const played = people.some((p) => p.games > 0);
  const q = Object.fromEntries(QUESTIONS.map((x) => [x.id, x]));
  const target = (id) => findPlayer(cfg, q[id].target)?.riotId;
  const liand = final.players.find((p) => p.riotId === target("liandDiamond"));
  const aheru = stats[target("aheru60")];
  return {
    liandDiamond: liand ? [["DIAMOND", ...APEX].includes(liand.tier) ? "Sí" : "No"] : [],
    aheru60: aheru ? [aheru.games > q.aheru60.games ? "Sí" : "No"] : [],
    firstBan: manual.firstBan ? [manual.firstBan] : [],
    overachiever: manual.overachiever ? [manual.overachiever] : [],
    // { answer: "Sí" | "No", names: quiénes abandonaron }, o null si todavía no se cargó.
    quit: manual.quit ? { answer: manual.quit, names: manual.quit === "Sí" ? manual.quitNames || [] : [] } : null,
    top3: ids(table.slice(0, 3)),
    winner: ids(table.slice(0, 1)),
    last: ids(table.slice(-1)),
    mostGames: played ? ids(best(people, (p) => p.games)) : [],
    leastGames: played ? ids(best(people, (p) => p.games, -1)) : [],
    bestWr: ids(best(eligible, (p) => p.wr)),
    worstWr: ids(best(eligible, (p) => p.wr, -1)),
    bestKda: ids(best(eligible, (p) => p.kda)),
    mostDeaths: played ? ids(best(people, (p) => p.deaths)) : [],
    longestGame: ids(best(people.filter((p) => p.long), (p) => p.long)),
    shortestGame: ids(best(people.filter((p) => p.short), (p) => p.short, -1)),
    mostKills: played ? ids(best(people, (p) => p.maxK)) : [],
    mostAssists: played ? ids(best(people, (p) => p.maxA)) : [],
    penta: [people.some((p) => p.pentas > 0) ? "Sí" : "No"],
    masters: masters ? [masters >= 5 ? "5+" : String(masters)] : [], // con 0 Master no acierta nadie
    champPlayers: best(champList, (c) => c.players).map((c) => c.name),
    champWr: best(champWr, (c) => c.wins / c.games).map((c) => c.name),
  };
}

// Puntos de un participante, pregunta por pregunta.
export function score(picks, correct) {
  const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
  const byQuestion = {};
  for (const q of QUESTIONS) {
    const pick = picks?.[q.id];
    const right = q.kind === "quit" ? correct.quit : correct[q.id] || [];
    let pts = 0;
    if (q.kind === "quit") {
      if (right && pick?.answer === right.answer) pts = q.points;
      if (right?.answer === "Sí" && pick?.name && right.names.includes(pick.name)) pts += q.bonus;
    } else if (q.kind === "top3") {
      (pick || []).forEach((p, i) => {
        if (!p || !right.includes(p)) return;
        pts += 20;
        if (right[i] === p) pts += 50;
      });
    } else if (right.some((r) => same(r, pick))) {
      pts = q.points;
    }
    byQuestion[q.id] = pts;
  }
  return { total: Object.values(byQuestion).reduce((a, b) => a + b, 0), byQuestion };
}
