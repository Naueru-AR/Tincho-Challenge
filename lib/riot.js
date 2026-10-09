// Cliente mínimo de la Riot Games API.
// La API key vive SOLO en el servidor (variable de entorno RIOT_API_KEY),
// nunca en el navegador.
//
// Sobre los límites del plan gratis de Cloudflare, que definen cómo se cachea acá:
//   - Cada pedido puede hacer como mucho 50 "subrequests", y ahí cuentan tanto los
//     fetch() a Riot como CADA lectura o escritura de la Cache API.
//   - Las operaciones de KV van aparte, con un tope de 1.000 por pedido.
// Por eso lo que dura (cuentas, íconos, partidas) se guarda en KV, y la Cache API se
// usa una sola vez por pedido, para guardar la respuesta entera (ver cachedResponse).

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Riot permite 20 consultas por segundo. Todas las consultas pasan por acá y se espacian
// para no superar PER_SECOND, aunque haya 20 jugadores y se pidan todos juntos.
const PER_SECOND = 15;
let recent = [];
async function throttle() {
  for (;;) {
    const now = Date.now();
    recent = recent.filter((t) => now - t < 1000);
    if (recent.length < PER_SECOND) return void recent.push(now);
    await sleep(1005 - (now - recent[0]));
  }
}

// Devuelve una copia de `env` con un tope de consultas a Riot para este pedido. Cuando se
// acaba, riotFetch falla enseguida y de forma prolija, en vez de chocar a mitad de camino
// con el límite de 50 consultas por pedido de Cloudflare.
export function withBudget(env, left) {
  const copy = Object.create(env);
  copy.riotBudget = { left };
  return copy;
}

// Pide algo a Riot, sin caché. 404 devuelve null; cualquier otro error se lanza con su status.
export async function riotFetch(url, env) {
  for (let attempt = 0; ; attempt++) {
    const budget = env.riotBudget;
    if (budget) {
      if (budget.left <= 0) throw Object.assign(new Error("Se alcanzó el tope de consultas de esta pasada."), { status: "budget" });
      budget.left--;
    }
    await throttle();
    const res = await fetch(url, { headers: { "X-Riot-Token": env.RIOT_API_KEY } });
    if (res.status === 404) return null;
    // Si Riot pide esperar un momento, se espera y se reintenta una vez.
    if (res.status === 429 && attempt === 0) {
      await sleep(Math.min(Number(res.headers.get("Retry-After")) || 1, 4) * 1000);
      continue;
    }
    if (!res.ok) {
      const err = new Error(`Riot respondió ${res.status} para ${new URL(url).pathname}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

// Caché en KV (binding `LP`) para lo que cambia poco. Sin KV no hay caché y se le pide a
// Riot cada vez. La copia en memoria ahorra lecturas mientras el servidor siga despierto.
const memory = new Map();
async function cached(env, name, ttl, load) {
  const key = `c:${await keyTag(env.RIOT_API_KEY)}:${name}`;
  const now = Date.now();
  const mem = memory.get(key);
  if (mem && mem.until > now) return mem.value;

  const kv = env.LP;
  let value = kv ? (await kv.get(key, "json"))?.v : undefined;
  if (value === undefined) {
    value = await load();
    if (value === null) return null; // lo que no existe no se guarda
    // Si se agotó la cuota diaria de escrituras de KV, el sitio sigue andando sin caché.
    // El vencimiento lleva un margen al azar para que no venza todo junto (por ejemplo,
    // los íconos de los 20 jugadores en la misma pasada).
    const expirationTtl = Math.round(ttl * (1 + Math.random() * 0.25));
    if (kv) await kv.put(key, JSON.stringify({ v: value }), { expirationTtl }).catch(() => {});
  }
  if (memory.size > 2000) memory.clear();
  memory.set(key, { value, until: now + Math.min(ttl, 600) * 1000 });
  return value;
}

// Guarda en la Cache API la respuesta entera de un endpoint (2 subrequests en total), para
// no repetirle a Riot las mismas consultas cuando varias personas miran el sitio a la vez.
// Solo se guardan las respuestas que `build` marca como cacheables (sin errores adentro).
export async function cachedResponse(context, build) {
  const { pathname } = new URL(context.request.url);
  const key = new Request(`https://cache.local/${await keyTag(context.env.RIOT_API_KEY)}${pathname}`);
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const { response, cacheable } = await build();
  if (cacheable) context.waitUntil(caches.default.put(key, response.clone()));
  return response;
}

// Guarda y recupera un dato suelto en la Cache API (1 consulta cada vez).
const noteKey = async (context, name) => new Request(`https://cache.local/${await keyTag(context.env.RIOT_API_KEY)}/note/${name}`);
export function remember(context, name, data, ttl) {
  context.waitUntil(
    noteKey(context, name).then((key) =>
      caches.default.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } }))
    )
  );
}
export async function recall(context, name) {
  const hit = await caches.default.match(await noteKey(context, name));
  return hit ? hit.json() : null;
}

export async function getAccount(riotId, cfg, env) {
  const [name, tag] = riotId.split("#");
  const url = `https://${cfg.region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  // El PUUID no cambia: 7 días. Solo guardamos lo que se usa.
  return cached(env, `acc:${riotId.toLowerCase()}`, 60 * 60 * 24 * 7, async () => {
    const acc = await riotFetch(url, env);
    return acc && { puuid: acc.puuid };
  });
}

// Rango actual. No se cachea por separado: es justo lo que tiene que estar fresco.
export async function getSoloQ(puuid, cfg, env) {
  const url = `https://${cfg.platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
  const entries = (await riotFetch(url, env)) || [];
  return entries.find((e) => e.queueType === "RANKED_SOLO_5x5") || null;
}

// Ícono de invocador que el jugador tiene puesto en su cuenta. Cambia poco: 24 horas.
export async function getProfileIcon(puuid, cfg, env) {
  const url = `https://${cfg.platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  return cached(env, `icon:${puuid}`, 60 * 60 * 24, async () => (await riotFetch(url, env))?.profileIconId ?? null);
}

// IDs de las partidas de SoloQ desde `since` (por defecto, desde que empezó el torneo).
export async function getMatchIds(puuid, cfg, env, count = 10, since = new Date(cfg.start).getTime()) {
  const start = Math.floor(since / 1000);
  if (new Date(cfg.start).getTime() > Date.now()) return []; // el torneo todavía no empezó
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${start}&count=${count}`;
  return (await riotFetch(url, env)) || [];
}

// Una partida terminada nunca cambia: 30 días. Riot devuelve unos 40 KB por partida;
// guardamos solo los campos que usa el sitio, con la misma forma que la respuesta original.
function slimMatch(m) {
  return {
    metadata: { matchId: m.metadata.matchId },
    info: {
      gameCreation: m.info.gameCreation,
      gameStartTimestamp: m.info.gameStartTimestamp,
      gameEndTimestamp: m.info.gameEndTimestamp,
      gameDuration: m.info.gameDuration,
      participants: m.info.participants.map((p) => ({
        puuid: p.puuid,
        riotIdGameName: p.riotIdGameName,
        riotIdTagline: p.riotIdTagline,
        teamId: p.teamId,
        win: p.win,
        gameEndedInEarlySurrender: p.gameEndedInEarlySurrender,
        championName: p.championName,
        teamPosition: p.teamPosition,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        totalMinionsKilled: p.totalMinionsKilled,
        neutralMinionsKilled: p.neutralMinionsKilled,
      })),
    },
  };
}

export async function getMatch(matchId, cfg, env) {
  const url = `https://${cfg.region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  return cached(env, `m:${matchId}`, 60 * 60 * 24 * 30, async () => {
    const m = await riotFetch(url, env);
    return m && slimMatch(m);
  });
}

// Diferencia horaria del torneo en milisegundos. Se toma de la fecha "start" de
// participants.json (por ejemplo "-03:00" para Argentina).
export function tzOffset(cfg) {
  const m = /([+-])(\d\d):(\d\d)$/.exec(cfg.start);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000 : 0;
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
