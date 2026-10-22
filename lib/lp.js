// LP ganados o perdidos en cada partida.
//
// La API de Riot NO dice cuántos LP dio cada partida (OP.GG tampoco los recibe de Riot).
// Se calculan igual que lo hace OP.GG: guardamos una "foto" del rango de cada jugador
// y, cuando aparece exactamente una partida nueva, la diferencia de puntaje entre la
// foto vieja y la nueva son los LP de esa partida.
//
// Las fotos se guardan en Cloudflare KV (gratis), en el binding `LP`.
// Si el binding no está configurado, todo esto se saltea y la página funciona igual,
// solo que sin los LP por partida.
//
// Clave en KV (una sola por jugador, para gastar una escritura por partida y no dos;
// el plan gratis permite 1.000 escrituras por día):
//   snap:<puuid>  → { games, score, lastMatchId, at, pendingSince?, lp: { "<matchId>": +25, ... },
//                     aegis: { count, ids } }
// (Antes los LP iban en una clave aparte, lp:<puuid>; se sigue leyendo si existe.)

import { getMatch, isRemake, riotFetch } from "./riot.js";

const MAX_SAVED = 80;              // cuántas partidas con LP guardamos por jugador
const GIVE_UP_MS = 20 * 60 * 1000; // si Riot tarda más que esto en mostrar la partida, la salteamos

/* ---------- Égida de Valor ----------
   Riot no informa si una partida tuvo la Égida de Valor (la protección por autofill o carril
   prioritario). Se deduce por los LP: la Égida da el DOBLE de LP en una victoria. Como lo que
   se gana por victoria cambia a medida que el jugador se acerca a su elo, se compara contra
   la MEDIANA DE SUS ÚLTIMAS AEGIS_RECENT VICTORIAS NORMALES (sin Égida): cuenta si dio al menos
   AEGIS_RATIO veces eso (si viene ganando +30, una de +60; si viene ganando +20, una de +40).
   Se usa la mediana y no solo la última porque una victoria rara (por ejemplo +15 por un cambio
   de división) no tiene que mover la referencia: con la última sola, todas las +30 siguientes
   parecían "el doble". Hacen falta al menos AEGIS_REF_MIN victorias normales anteriores para
   comparar: las primeras victorias registradas solo arman la referencia. Las derrotas no se
   tienen en cuenta.
   El contador se guarda aparte (aegis: { count, ids, recent, wins }), porque el registro de LP
   solo conserva las últimas MAX_SAVED partidas. */
const AEGIS_RATIO = 1.8; // "el doble", con margen por si varía 1 o 2 LP
const AEGIS_REF_MIN = 2; // victorias normales que hacen falta para poder comparar
const AEGIS_RECENT = 5; // victorias normales que forman la referencia
const median = (xs) => { const v = [...xs].sort((x, y) => x - y); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
export function isAegis(recent, delta) {
  if (delta <= 0 || recent.length < AEGIS_REF_MIN) return false; // sin referencia, no se puede saber
  return delta >= AEGIS_RATIO * median(recent);
}
// Recorre los LP registrados en orden y arma el contador.
function aegisFrom(lp) {
  const out = { count: 0, ids: [], recent: [], wins: 0, rule: 3 };
  for (const [id, d] of Object.entries(lp)) addResult(out, id, d);
  return out;
}
// Suma el resultado de una partida al contador.
function addResult(aegis, id, delta) {
  if (delta <= 0) return; // las derrotas no cuentan
  aegis.wins++;
  if (isAegis(aegis.recent, delta)) {
    if (!aegis.ids.includes(id)) { aegis.count++; aegis.ids = [...aegis.ids, id].slice(-40); }
  } else {
    aegis.recent = [...aegis.recent, delta].slice(-AEGIS_RECENT); // victoria normal: suma a la referencia
  }
}
// El contador guardado vale si se armó con la regla actual (los anteriores se recalculan).
const current = (a) => a?.rule === 3; // versión de la regla (cambiarla recalcula todo)

// Últimos IDs de SoloQ, SIN caché: necesitamos el dato fresco para saber cuál es la partida nueva.
async function latestMatchIds(puuid, cfg, env, count) {
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${count}`;
  return (await riotFetch(url, env)) || [];
}

async function isRemakeId(matchId, cfg, env) {
  const m = await getMatch(matchId, cfg, env);
  return m ? isRemake(m) : false;
}

// LP ya registrados de un jugador, estén en la foto o en la clave del formato anterior.
async function savedLp(kv, puuid, snap) {
  return snap?.lp ?? (await kv.get(`lp:${puuid}`, "json")) ?? {};
}

// Se llama cada vez que se consulta el rango de un jugador (desde /api/leaderboard).
export async function trackLp(puuid, entry, score, cfg, env) {
  const kv = env.LP;
  if (!kv || !entry) return;

  const games = entry.wins + entry.losses;
  const snapKey = `snap:${puuid}`;
  const prev = await kv.get(snapKey, "json");
  const now = Date.now();

  // Primera vez que vemos al jugador: sacamos la foto inicial.
  if (!prev) {
    const [last] = await latestMatchIds(puuid, cfg, env, 1);
    await kv.put(snapKey, JSON.stringify({ games, score, lastMatchId: last ?? null, at: now }));
    return;
  }

  // Sin partidas nuevas. (Si hay menos partidas que antes es un dato viejo de la caché,
  // salvo que sea muchísimo menos: eso es un reinicio de temporada.)
  if (games === prev.games) return;
  if (games < prev.games) {
    if (prev.games - games > 5) {
      const [last] = await latestMatchIds(puuid, cfg, env, 1);
      await kv.put(snapKey, JSON.stringify({ games, score, lastMatchId: last ?? null, at: now, lp: await savedLp(kv, puuid, prev), aegis: prev.aegis }));
    }
    return;
  }

  // Hay partidas nuevas: buscamos cuáles son en el historial.
  const n = games - prev.games;
  const ids = await latestMatchIds(puuid, cfg, env, n + 4);
  const cut = prev.lastMatchId ? ids.indexOf(prev.lastMatchId) : -1;
  let fresh = cut === -1 ? null : ids.slice(0, cut);

  // Sacamos las remakes, que no suman ni restan.
  if (fresh && fresh.length > n) {
    const flags = await Promise.all(fresh.map((id) => isRemakeId(id, cfg, env)));
    fresh = fresh.filter((_, i) => !flags[i]);
  }

  // Riot todavía no publicó la partida en el historial: esperamos a la próxima consulta.
  if (fresh && fresh.length < n) {
    const pendingSince = prev.pendingSince ?? now;
    if (now - pendingSince < GIVE_UP_MS) {
      if (!prev.pendingSince) await kv.put(snapKey, JSON.stringify({ ...prev, pendingSince }));
      return;
    }
    fresh = null; // tardó demasiado: seguimos sin anotar LP para esta partida
  }

  // Solo podemos saber los LP exactos si hubo UNA partida entre foto y foto.
  let lp = await savedLp(kv, puuid, prev);
  // La primera vez, el contador de Égidas se arma con lo que ya estaba registrado.
  const aegis = current(prev.aegis) ? { ...prev.aegis } : aegisFrom(lp);
  if (n === 1 && fresh && fresh.length === 1) {
    const delta = score - prev.score;
    addResult(aegis, fresh[0], delta);
    lp = Object.fromEntries(Object.entries({ ...lp, [fresh[0]]: delta }).slice(-MAX_SAVED));
  }

  await kv.put(snapKey, JSON.stringify({ games, score, lastMatchId: ids[0] ?? prev.lastMatchId, at: now, lp, aegis }));
}

// Cuántas Égidas de Valor lleva un jugador (ver arriba). Si el contador todavía no se armó,
// se calcula con los LP registrados.
export async function getAegis(puuid, env) {
  const snap = env.LP && (await env.LP.get(`snap:${puuid}`, "json"));
  if (!snap) return 0;
  return current(snap.aegis) ? snap.aegis.count : aegisFrom(snap.lp ?? {}).count;
}

// LP guardados de un jugador: { matchId: delta }.
export async function getLpChanges(puuid, env) {
  if (!env.LP) return {};
  return savedLp(env.LP, puuid, await env.LP.get(`snap:${puuid}`, "json"));
}
