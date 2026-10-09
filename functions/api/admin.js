// GET /api/admin → sospechas de dúo y días con el límite superado, por jugador.
//
// Panel privado del organizador. Solo responde si el pedido trae la clave ADMIN_KEY
// (un secret de Cloudflare) en el encabezado X-Admin-Key.
//
// No le consulta nada a Riot: lee lo que fue guardando lib/duo.js cada vez que se
// recalculó la tabla. Por eso abre al instante aunque haya muchos jugadores.
import { loadConfig, getAccount, isDemo } from "../../lib/riot.js";
import { WINDOW, adminView, applyRecords, emptyState, loadState } from "../../lib/duo.js";
import { demoRecords } from "../../lib/demo.js";

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
          return { ...base, ...adminView(state) };
        }
        const acc = await getAccount(p.riotId, cfg, env); // en caché 7 días
        if (!acc) return { ...base, error: "No encontramos ese Riot ID." };
        return { ...base, ...adminView(await loadState(acc.puuid, env)) };
      } catch (err) {
        return { ...base, error: err.status === 429 ? "Riot está limitando las consultas. Probá en un minuto." : err.message };
      }
    })
  );

  return reply({
    title: cfg.title,
    demo,
    storage: Boolean(env.LP), // sin KV no se puede guardar nada y el panel queda vacío
    window: WINDOW,
    limit: cfg.dailyLimit ?? 12,
    players,
  });
}
