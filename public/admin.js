// Panel del organizador: posibles dúos y días con el límite de partidas superado.
// La clave se pide una vez y queda guardada solo mientras dure la pestaña.
import { $, esc, setBrand } from "./shared.js";

const KEY = "tincho-admin-key";
const demoParam = new URLSearchParams(location.search).has("demo") ? "demo&" : "";
const fmtDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const day = (iso) => fmtDay.format(new Date(`${iso}T12:00:00Z`));
const players = new Map();

async function api(query = "") {
  const res = await fetch(`/api/admin?${demoParam}${query}`, { headers: { "X-Admin-Key": sessionStorage.getItem(KEY) || "" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `El servidor respondió ${res.status}.`), { status: res.status });
  return data;
}

/* ---------- dibujo ---------- */
const pct = (x) => (x < 0.001 ? "menos de 0,1" : (x * 100).toLocaleString("es-AR", { maximumFractionDigits: x < 0.1 ? 1 : 0 }));

function suspectHtml(s) {
  const why = [];
  if (s.streak) why.push(`<b>${s.streak.count} partidas seguidas</b> en el mismo equipo (${s.streak.from === s.streak.to ? day(s.streak.from) : `${day(s.streak.from)} al ${day(s.streak.to)}`})`);
  if (s.day) why.push(`<b>${s.day.count} partidas juntos</b> el ${day(s.day.date)}`);
  if (!why.length) why.push(`<b>${s.together} partidas juntos</b> sin enfrentarse nunca`);
  const games = s.together + s.against;
  return `
    <li class="suspect ${s.level}">
      <span class="suspect-who">
        <a href="${esc(s.opggUrl)}" target="_blank" rel="noopener">${esc(s.name)}</a>
        <span class="tag ${s.level === "alto" ? "hot" : "warn"}">Sospecha ${s.level === "alto" ? "alta" : "media"}</span>
        ${s.participant ? `<span class="tag">Participante: ${esc(s.participant)}</span>` : ""}
      </span>
      <span class="suspect-why">${why.join(" · ")}</span>
      <span class="suspect-nums">Se cruzaron ${games} ${games === 1 ? "vez" : "veces"}: <b>${s.together}</b> en el mismo equipo y <b>${s.against}</b> en contra.
        Por casualidad eso pasa el <b>${pct(s.chance)} %</b> de las veces.</span>
    </li>`;
}

const hasAlerts = (p) => Boolean(p.error || p.suspects?.length || p.overDays?.length);

function cardHtml(p) {
  if (p.error) return `<article class="adm-card flagged"><h3>${esc(p.alias)} <small>${esc(p.riotId)}</small></h3><p class="adm-err">${esc(p.error)}</p></article>`;
  return `
    <article class="adm-card flagged">
      <h3><a href="${esc(p.opggUrl)}" target="_blank" rel="noopener">${esc(p.alias)}</a> <small>${esc(p.riotId)}</small></h3>
      ${p.suspects.length ? `
        <h4>Posible dúo</h4>
        <ul class="suspects">${p.suspects.map(suspectHtml).join("")}</ul>` : ""}
      ${p.overDays.length ? `
        <h4>Límite diario superado <small>límite ${p.limit}</small></h4>
        <ul class="adm-days">${p.overDays.map((d) => `<li class="over">${day(d.date)} <b>${d.played}</b> <i>+${d.over}</i></li>`).join("")}</ul>` : ""}
    </article>`;
}

// Solo se muestran los jugadores con alguna alerta; el resto no aparece.
function render(done = true) {
  const list = [...players.values()].sort((a, b) => a.i - b.i);
  const flagged = list.filter(hasAlerts);
  const duo = list.reduce((n, p) => n + (p.suspects?.length || 0), 0);
  const high = list.reduce((n, p) => n + (p.suspects?.filter((s) => s.level === "alto").length || 0), 0);
  const over = list.reduce((n, p) => n + (p.overDays?.length || 0), 0);
  $("adm-summary").innerHTML = `
    <div class="${duo ? "hot" : ""}"><b>${duo}</b><span>${duo === 1 ? "alerta de posible dúo" : "alertas de posible dúo"}${duo ? ` (${high} de sospecha alta)` : ""}</span></div>
    <div class="${over ? "hot" : ""}"><b>${over}</b><span>${over === 1 ? "día con el límite superado" : "días con el límite superado"}</span></div>`;
  $("adm-cards").innerHTML = flagged.length
    ? flagged.map(cardHtml).join("")
    : done ? `<p class="adm-clear">Sin alertas: se revisaron ${list.length} jugadores y ninguno tiene posibles dúos ni días pasados del límite.</p>` : "";
}

/* ---------- carga ---------- */
// Primero se muestra lo que ya está guardado y después se le pide a Riot, jugador por
// jugador, lo que falte. Cada pedido trae hasta 20 partidas y Riot permite 100 consultas
// cada 2 minutos, así que la primera vez hay que ir de a poco, con pausas.
const PAUSE = 30; // segundos entre tandas del mismo jugador
const wait = async (seconds, label) => {
  for (let s = seconds; s > 0; s--) {
    $("adm-status").textContent = `${label} Sigue en ${s} s…`;
    await new Promise((r) => setTimeout(r, 1000));
  }
};
async function load() {
  $("adm-status").textContent = "Cargando…";
  const data = await api();
  setBrand(data.title);
  $("foot-name").textContent = data.title;
  $("adm-note").hidden = data.storage;
  $("adm-demo").hidden = !data.demo;
  players.clear();
  for (const p of data.players) players.set(p.i, p);
  show(true);
  render(false);

  for (const p of data.players) {
    if (p.error) continue;
    let stuck = 0;
    let last = Infinity;
    for (let tries = 0; tries < 80; tries++) {
      $("adm-status").textContent = `Consultando a Riot: ${p.alias}…`;
      const { player } = await api(`sync=${p.i}`);
      players.set(p.i, player);
      render(false);
      if (player.error || !player.pending) break;
      // Si no avanza varias veces seguidas (y no es por el límite de Riot), se deja así.
      stuck = player.pending >= last && !player.limited ? stuck + 1 : 0;
      if (stuck >= 2) break;
      last = player.pending;
      await wait(player.limited ? PAUSE * 2 : PAUSE, `Descargando el historial de ${p.alias}: faltan ${player.pending} partidas.`);
    }
  }
  render();
  $("adm-status").textContent = `${data.players.length} jugadores revisados · Actualizado ${new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
}

function show(inside) {
  $("adm-login").hidden = inside;
  $("adm-panel").hidden = !inside;
}

async function start() {
  try {
    await load();
  } catch (e) {
    if (e.status === 401) sessionStorage.removeItem(KEY);
    if (e.status === 401 || e.status === 503) {
      show(false);
      $("adm-login-msg").textContent = e.message;
    } else {
      $("adm-status").textContent = `No se pudo actualizar: ${e.message}`;
    }
  }
}

$("adm-form").addEventListener("submit", (e) => {
  e.preventDefault();
  sessionStorage.setItem(KEY, $("adm-key").value);
  $("adm-key").value = "";
  $("adm-login-msg").textContent = "";
  start();
});
$("adm-refresh").addEventListener("click", start);
$("adm-exit").addEventListener("click", () => { sessionStorage.removeItem(KEY); show(false); });

if (sessionStorage.getItem(KEY)) start();
