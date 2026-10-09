// Cliente mínimo de la Riot Games API con caché en el borde de Cloudflare.
// La API key vive SOLO en el servidor (variable de entorno RIOT_API_KEY),
// nunca en el navegador.

export const TIERS = [
  "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM",
  "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER",
];
const DIVISIONS = ["IV", "III", "II", "I"];

// Puntaje para ordenar: cada tier vale 400 (4 divisiones x 100 LP).
// Master+ no tiene divisiones, así que se ordena por LP sobre la base de Master.
export function rankScore(entry) {
  if (!entry) return -1;
  const t = TIERS.indexOf(entry.tier);
  if (t >= 7) return 7 * 400 + entry.leaguePoints;
  return t * 400 + DIVISIONS.indexOf(entry.rank) * 100 + entry.leaguePoints;
}

// Riot cifra los PUUID con cada API key: uno obtenido con una key no sirve con otra
// (responde 400). Por eso la caché se separa por key, usando una huella corta
// (nunca la key misma). Al cambiar la key, lo cacheado con la anterior se ignora.
const keyTags = new Map();
async function keyTag(key) {
  if (!keyTags.has(key)) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    keyTags.set(key, [...new Uint8Array(hash)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join(""));
  }
  return keyTags.get(key);
}

// Pide algo a Riot y lo guarda en la caché de Cloudflare `ttl` segundos.
// La caché es gratis e ilimitada y nos protege del rate limit.
export async function riotGet(url, env, ttl) {
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.local/${await keyTag(env.RIOT_API_KEY)}/${encodeURIComponent(url)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const res = await fetch(url, { headers: { "X-Riot-Token": env.RIOT_API_KEY } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Riot respondió ${res.status} para ${new URL(url).pathname}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` },
    })
  );
  return data;
}

export async function getAccount(riotId, cfg, env) {
  const [name, tag] = riotId.split("#");
  const url = `https://${cfg.region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  return riotGet(url, env, 60 * 60 * 24 * 7); // el PUUID no cambia: 7 días
}

export async function getSoloQ(puuid, cfg, env) {
  const url = `https://${cfg.platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
  const entries = (await riotGet(url, env, 120)) || [];
  return entries.find((e) => e.queueType === "RANKED_SOLO_5x5") || null;
}

// Ícono de invocador que el jugador tiene puesto en su cuenta.
export async function getProfileIcon(puuid, cfg, env) {
  const url = `https://${cfg.platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  const s = await riotGet(url, env, 60 * 60 * 6); // cambia poco: 6 horas
  return s?.profileIconId ?? null;
}

// IDs de las partidas de SoloQ desde `since` (por defecto, desde que empezó el torneo).
export async function getMatchIds(puuid, cfg, env, count = 10, since = new Date(cfg.start).getTime()) {
  const start = Math.floor(since / 1000);
  if (new Date(cfg.start).getTime() > Date.now()) return []; // el torneo todavía no empezó
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${start}&count=${count}`;
  return (await riotGet(url, env, 120)) || [];
}

export async function getMatch(matchId, cfg, env) {
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  return riotGet(url, env, 60 * 60 * 24 * 30); // una partida terminada nunca cambia
}

// Una "remake" aparece en el historial pero no cuenta como victoria ni derrota.
export function isRemake(match) {
  return match.info.gameDuration < 300 || match.info.participants.some((p) => p.gameEndedInEarlySurrender);
}

// Lee participants.json desde los archivos estáticos del sitio.
export async function loadConfig(context) {
  const url = new URL("/participants.json", context.request.url);
  const res = await context.env.ASSETS.fetch(url);
  return res.json();
}

export function json(data, maxAge = 60) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}

export function isDemo(context) {
  const u = new URL(context.request.url);
  return !context.env.RIOT_API_KEY || u.searchParams.has("demo");
}
