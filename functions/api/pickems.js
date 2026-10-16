// GET  /api/pickems → preguntas, quién votó y, cuando corresponde, los picks y los puntos.
// POST /api/pickems → { riotId, pin } para entrar; con `picks`, vota. El voto es uno solo:
// una vez enviado no se puede cambiar.
// Solo lee y escribe KV: no le consulta nada a Riot.
import { loadConfig, json } from "../../lib/riot.js";
import { QUESTIONS, MAX, MANUAL, missing, closesAt, rules, norm, findPlayer, aliasOf, newSalt, hashPin, cleanPicks, answers, score, finalStats } from "../../lib/pickems.js";

const MAX_FAILS = 5; // intentos de PIN fallidos antes de bloquear 15 minutos

const fail = (status, message) => new Response(JSON.stringify({ error: message }), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const statusOf = (cfg, now = Date.now()) =>
  now < new Date(closesAt(cfg)).getTime() ? "open" : now < new Date(cfg.end).getTime() ? "locked" : "final";

// Los picks guardados de todos, en el orden de participants.json.
async function allVotes(cfg, env) {
  const recs = await Promise.all(cfg.players.map((p) => env.LP.get(`pick:${norm(p.riotId)}`, "json")));
  return recs
    .map((r, i) => r && { riotId: cfg.players[i].riotId, alias: aliasOf(cfg.players[i]), picks: r.picks, at: r.at })
    .filter(Boolean);
}

export async function onRequestGet(context) {
  const { env } = context;
  const cfg = await loadConfig(context);
  const r = rules(cfg);
  const status = statusOf(cfg);
  const base = {
    title: cfg.title,
    edition: cfg.edition || null,
    start: cfg.start,
    closes: closesAt(cfg),
    end: cfg.end,
    status,
    max: MAX,
    questions: QUESTIONS.map((q) => ({ ...q, note: q.note?.replace("{minGames}", r.minGames).replace("{minChampGames}", r.minChampGames) })),
    players: cfg.players.map((p) => ({ riotId: p.riotId, alias: aliasOf(p) })),
  };
  if (!env.LP) return json({ ...base, voters: [], unavailable: true }, 0);

  const votes = await allVotes(cfg, env);
  // Mientras se puede votar, los picks son secretos: solo se ve quién ya votó.
  if (status === "open") return json({ ...base, voters: votes.map((v) => v.alias) }, 0);

  if (status === "locked") return json({ ...base, votes }, 60);

  // Terminado: los puntos aparecen recién cuando están la tabla final y el recuento completo de
  // partidas (ver lib/pickems.js). Mientras tanto se muestran los picks sin puntos.
  const [final, stats, manual] = await Promise.all([env.LP.get("pickems:final", "json"), finalStats(env), env.LP.get(MANUAL, "json")]);
  if (!final || !stats) return json({ ...base, status: "calculating", votes }, 60);

  const correct = answers(cfg, final, stats, manual || {});
  const ranking = votes
    .map((v) => ({ ...v, ...score(v.picks, correct) }))
    .sort((a, b) => b.total - a.total || (a.at < b.at ? -1 : 1)); // a igual puntaje, el que votó antes
  return json({ ...base, answers: correct, votes: ranking }, 120);
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.LP) return fail(503, "Los Pickems no están disponibles ahora.");
  const cfg = await loadConfig(context);
  const body = await request.json().catch(() => ({}));

  const player = findPlayer(cfg, body.riotId);
  if (!player) return fail(400, "Ese Riot ID no está entre los participantes del torneo.");
  const pin = String(body.pin ?? "");
  if (!/^\d{4}$/.test(pin)) return fail(400, "El PIN tiene que ser de 4 números.");

  const id = norm(player.riotId);
  const failKey = `pickfail:${id}`;
  const fails = Number(await env.LP.get(failKey)) || 0;
  if (fails >= MAX_FAILS) return fail(429, "Demasiados intentos con PIN incorrecto. Probá de nuevo en 15 minutos.");

  const rec = await env.LP.get(`pick:${id}`, "json");
  if (rec && (await hashPin(pin, rec.salt)) !== rec.hash) {
    await env.LP.put(failKey, String(fails + 1), { expirationTtl: 900 });
    return fail(401, "PIN incorrecto.");
  }

  const me = { riotId: player.riotId, alias: aliasOf(player) };
  // Solo entrar: devuelve sus picks. La cuenta se crea recién cuando guarda por primera vez.
  if (!body.picks) return json({ ...me, isNew: !rec, picks: rec?.picks || null }, 0);

  if (statusOf(cfg) !== "open") return fail(403, "La votación de los Pickems ya cerró.");
  if (rec) return fail(409, "Ya votaste: tu voto no se puede cambiar.");
  const picks = cleanPicks(body.picks, cfg);
  const empty = missing(picks);
  if (empty.length) return fail(400, `Todas las preguntas son obligatorias. Falta: ${empty.map((q) => q.text).join(", ")}.`);
  const salt = newSalt();
  const saved = {
    riotId: player.riotId,
    salt,
    hash: await hashPin(pin, salt),
    picks,
    at: new Date().toISOString(), // fecha del voto (desempata)
  };
  await env.LP.put(`pick:${id}`, JSON.stringify(saved));
  return json({ ...me, isNew: false, picks: saved.picks }, 0);
}
