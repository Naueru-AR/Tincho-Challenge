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
//   snap:<puuid>  → { games, score, lastMatchId, at, pendingSince?, lp: { "<matchId>": +25, ... } }
// (Antes los LP iban en una clave aparte, lp:<puuid>; se sigue leyendo si existe.)

import { getMatch, isRemake } from "./riot.js";

const MAX_SAVED = 80;              // cuántas partidas con LP guardamos por jugador
const GIVE_UP_MS = 20 * 60 * 1000; // si Riot tarda más que esto en mostrar la partida, la salteamos

// Últimos IDs de SoloQ, SIN caché: necesitamos el dato fresco para saber cuál es la partida nueva.
async function latestMatchIds(puuid, cfg, env, count) {
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${count}`;
  const res = await fetch(url, { headers: { "X-Riot-Token": env.RIOT_API_KEY } });
  if (!res.ok) throw new Error(`Riot respondió ${res.status} al pedir partidas`);
  return res.json();
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
      await kv.put(snapKey, JSON.stringify({ games, score, lastMatchId: last ?? null, at: now, lp: await savedLp(kv, puuid, prev) }));
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
  if (n === 1 && fresh && fresh.length === 1) {
    lp = Object.fromEntries(Object.entries({ ...lp, [fresh[0]]: score - prev.score }).slice(-MAX_SAVED));
  }

  await kv.put(snapKey, JSON.stringify({ games, score, lastMatchId: ids[0] ?? prev.lastMatchId, at: now, lp }));
}

// LP guardados de un jugador: { matchId: delta }.
export async function getLpChanges(puuid, env) {
  if (!env.LP) return {};
  return savedLp(env.LP, puuid, await env.LP.get(`snap:${puuid}`, "json"));
}
