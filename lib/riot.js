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

// Pide algo a Riot y lo guarda en la caché de Cloudflare `ttl` segundos.
// La caché es gratis e ilimitada y nos protege del rate limit.
export async function riotGet(url, env, ttl) {
  const cache = caches.default;
  const cacheKey = new Request("https://cache.local/" + encodeURIComponent(url));
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

export async function getMatchIds(puuid, cfg, env, count = 10) {
  const start = Math.floor(new Date(cfg.start).getTime() / 1000);
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${start}&count=${count}`;
  return (await riotGet(url, env, 120)) || [];
}

export async function getMatch(matchId, cfg, env) {
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  return riotGet(url, env, 60 * 60 * 24 * 30); // una partida terminada nunca cambia
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
