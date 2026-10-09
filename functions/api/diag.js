// GET /api/diag
// Diagnóstico de RIOT_API_KEY y del KV de LP. Nunca devuelve la key: solo su forma
// (largo, prefijo, caracteres raros) y qué contesta Riot al usarla.
import { loadConfig } from "../../lib/riot.js";

export async function onRequestGet(context) {
  const key = context.env.RIOT_API_KEY;
  const out = { present: typeof key === "string" && key.length > 0 };

  if (out.present) {
    out.length = key.length; // una key de Riot mide 42
    out.startsWithRGAPI = key.startsWith("RGAPI-");
    out.validFormat = /^RGAPI-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    out.hasWhitespace = /\s/.test(key);
    out.hasQuotes = /["'`]/.test(key);
    out.hasEquals = key.includes("=");

    const cfg = await loadConfig(context);
    const res = await fetch(`https://${cfg.platform}.api.riotgames.com/lol/status/v4/platform-data`, {
      headers: { "X-Riot-Token": key.trim() },
    });
    out.riotStatus = res.status;
    out.riotMessage = res.ok ? "OK" : (await res.json().catch(() => null))?.status?.message ?? null;
  }

  out.adminKey = Boolean(context.env.ADMIN_KEY); // clave del panel del organizador

  // KV de los LP por partida: si está conectado y cuántos jugadores tienen "foto" guardada.
  out.lpBinding = Boolean(context.env.LP);
  if (out.lpBinding) {
    out.lpSnapshots = (await context.env.LP.list({ prefix: "snap:" })).keys.length;
    out.duoWatched = (await context.env.LP.list({ prefix: "watch:" })).keys.length; // jugadores revisados por el panel
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
