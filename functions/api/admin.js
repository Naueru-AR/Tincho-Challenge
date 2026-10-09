// GET /api/admin            → resumen de todos los jugadores con lo que ya está guardado
// GET /api/admin?sync=<n>   → trae de Riot las partidas que faltan del jugador n y lo vuelve a analizar
//
// Panel privado del organizador. Solo responde si el pedido trae la clave ADMIN_KEY
// (un secret de Cloudflare) en el encabezado X-Admin-Key.
import { loadConfig, getAccount, isDemo } from "../../lib/riot.js";
import { analyze, loadRecords, syncRecords } from "../../lib/duo.js";
import { demoRecords } from "../../lib/demo.js";

// Al navegador solo le mandamos las alertas: los sospechosos de dúo y los días pasados
// del límite. De un jugador sin alertas no viaja ningún detalle.
function alertsOnly(a) {
  return { limit: a.limit, suspects: a.suspects, overDays: a.days.filter((d) => d.over > 0) };
}

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

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.ADMIN_KEY) return reply({ error: "El panel no está configurado: falta el secret ADMIN_KEY en Cloudflare." }, 503);
  if (!(await sameKey(request.headers.get("X-Admin-Key") || "", env.ADMIN_KEY))) return reply({ error: "Clave incorrecta." }, 401);

  const cfg = await loadConfig(context);
  const demo = isDemo(context);
  const roster = new Map(cfg.players.map((p) => [p.riotId.toLowerCase(), p.alias || p.riotId.split("#")[0]]));

  const entry = async (p, i, sync) => {
    const [name, tag] = p.riotId.split("#");
    const base = {
      i,
      alias: p.alias || name,
      riotId: p.riotId,
      opggUrl: `https://op.gg/lol/summoners/${cfg.opggRegion}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`,
    };
    try {
      if (demo) return { ...base, pending: 0, ...alertsOnly(analyze(demoRecords(i), cfg, roster)) };
      const acc = await getAccount(p.riotId, cfg, env);
      if (!acc) return { ...base, error: "No encontramos ese Riot ID." };
      // Sin `sync` solo se lee lo guardado; `pending: null` avisa que falta consultar a Riot.
      const { records, pending } = sync
        ? await syncRecords(acc.puuid, cfg, env)
        : { records: await loadRecords(acc.puuid, env), pending: null };
      return { ...base, pending, ...alertsOnly(analyze(records, cfg, roster)) };
    } catch (err) {
      return { ...base, error: err.status === 429 ? "Riot está limitando las consultas. Probá en un minuto." : err.message };
    }
  };

  const sync = new URL(request.url).searchParams.get("sync");
  if (sync !== null) {
    const i = Number(sync);
    const p = cfg.players[i];
    if (!Number.isInteger(i) || !p) return reply({ error: "Jugador inexistente." }, 400);
    return reply({ player: await entry(p, i, true) });
  }

  return reply({
    title: cfg.title,
    demo,
    storage: Boolean(env.LP), // sin KV no queda nada guardado entre visitas
    players: await Promise.all(cfg.players.map((p, i) => entry(p, i, false))),
  });
}
