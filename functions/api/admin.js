// GET /api/admin → sospechas de dúo y días con el límite superado, por jugador, y los
// resultados de los Pickems que carga el organizador.
// POST /api/admin → guarda esos resultados ({ pickems: { firstBan, quit, quitNames, overachiever } }).
//
// Panel privado del organizador. Solo responde si el pedido trae la clave ADMIN_KEY
// (un secret de Cloudflare) en el encabezado X-Admin-Key.
//
// No le consulta nada a Riot: lee lo que fue guardando lib/duo.js cada vez que se
// recalculó la tabla. Por eso abre al instante aunque haya muchos jugadores.
import { loadConfig, getAccount, isDemo, tzOffset } from "../../lib/riot.js";
import { WINDOW, adminView, applyRecords, emptyState, forgetOthers, loadState } from "../../lib/duo.js";
import { demoPlayers, demoRecords } from "../../lib/demo.js";
import { MANUAL, cleanManual } from "../../lib/pickems.js";

const DAY = 24 * 60 * 60 * 1000;

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// Compara las claves por su hash, para no filtrar por tiempo cuánto coincide.
async function sameKey(a, b) {
  const hash = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Devuelve la respuesta de error si la clave no es válida, o null si está todo bien.
async function denied(env, request) {
  if (!env.ADMIN_KEY) return reply({ error: "El panel no está configurado: falta el secret ADMIN_KEY en Cloudflare." }, 503);
  if (!(await sameKey(request.headers.get("X-Admin-Key") || "", env.ADMIN_KEY))) return reply({ error: "Clave incorrecta." }, 401);
  return null;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const no = await denied(env, request);
  if (no) return no;
  if (!env.LP) return reply({ error: "El almacenamiento KV no está conectado." }, 503);
  const cfg = await loadConfig(context);
  const body = await request.json().catch(() => ({}));
  const manual = cleanManual(body.pickems, cfg);
  await env.LP.put(MANUAL, JSON.stringify(manual));
  return reply({ pickems: manual });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const no = await denied(env, request);
  if (no) return no;

  let cfg = await loadConfig(context);
  const demo = isDemo(context);
  // El ejemplo simula un torneo que empezó anteayer, así siempre tiene algo para mostrar.
  if (demo) {
    const start = new Date(Math.floor((Date.now() + tzOffset(cfg)) / DAY) * DAY - tzOffset(cfg) - 2 * DAY);
    cfg = { ...cfg, players: demoPlayers(cfg), start: start.toISOString(), end: new Date(start.getTime() + 31 * DAY).toISOString() };
  }
  const roster = new Map(cfg.players.map((p) => [p.riotId.toLowerCase(), p.alias || p.riotId.split("#")[0]]));

  const puuids = new Set();
  const players = await Promise.all(
    cfg.players.map(async (p, i) => {
      const [name, tag] = p.riotId.split("#");
      const base = {
        i,
        alias: p.alias || name,
        riotId: p.riotId,
        opggUrl: `https://op.gg/lol/summoners/${cfg.opggRegion}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`,
      };
      try {
        if (demo) {
          // En el ejemplo las partidas entran de a una, como pasaría en el torneo.
          const state = emptyState();
          for (const r of demoRecords(i)) applyRecords(state, [r], cfg, roster, r.t + 30 * 60 * 1000);
          return { ...base, ...adminView(state, cfg) };
        }
        const acc = await getAccount(p.riotId, cfg, env); // en caché 7 días
        if (!acc) return { ...base, error: "No encontramos ese Riot ID." };
        puuids.add(acc.puuid);
        return { ...base, ...adminView(await loadState(acc.puuid, env), cfg) };
      } catch (err) {
        return { ...base, error: err.status === 429 ? "Riot está limitando las consultas. Probá en un minuto." : err.message };
      }
    })
  );

  // Limpieza: si se pudo identificar a todos los participantes, se borra lo guardado de las
  // cuentas que ya no están en la lista (por ejemplo, las de prueba). Si alguno falló, no
  // se borra nada, para no perder datos por un error pasajero.
  if (!demo && players.every((p) => !p.error)) {
    context.waitUntil(forgetOthers(puuids, env).catch((err) => console.log("forgetOthers:", err.message)));
  }

  return reply({
    title: cfg.title,
    demo,
    storage: Boolean(env.LP), // sin KV no se puede guardar nada y el panel queda vacío
    window: WINDOW,
    limit: cfg.dailyLimit ?? 8,
    players,
    pickems: (env.LP && (await env.LP.get(MANUAL, "json"))) || {},
  });
}
