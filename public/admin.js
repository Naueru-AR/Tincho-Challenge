// Panel del organizador: posibles dúos y días con el límite de partidas superado.
// La clave se pide una vez y queda guardada solo mientras dure la pestaña.
// El panel no le consulta nada a Riot: muestra lo que el sitio fue guardando solo.
import { $, esc, setBrand } from "./shared.js";

const KEY = "tincho-admin-key";
const demoParam = new URLSearchParams(location.search).has("demo") ? "?demo" : "";
const fmtDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtWhen = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (iso) => fmtDay.format(new Date(`${iso}T12:00:00Z`));
const span = (from, to) => (from === to ? day(from) : `${day(from)} al ${day(to)}`);
const pct = (x) => (x < 0.001 ? "menos de 0,1" : (x * 100).toLocaleString("es-AR", { maximumFractionDigits: x < 0.1 ? 1 : 0 }));
let windowSize = 12;

async function api() {
  const res = await fetch(`/api/admin${demoParam}`, { headers: { "X-Admin-Key": sessionStorage.getItem(KEY) || "" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `El servidor respondió ${res.status}.`), { status: res.status });
  return data;
}

/* ---------- dibujo ---------- */
const crossed = (s) => {
  const games = s.together + s.against;
  return `Se cruzaron ${games} ${games === 1 ? "vez" : "veces"}: <b>${s.together}</b> en el mismo equipo y <b>${s.against}</b> en contra.
    Por casualidad eso pasa el <b>${pct(s.chance)} %</b> de las veces.`;
};
const who = (s, tags = "") => `
  <span class="suspect-who">
    <a href="${esc(s.opggUrl)}" target="_blank" rel="noopener">${esc(s.name)}</a>${tags}
    ${s.participant ? `<span class="tag">Participante: ${esc(s.participant)}</span>` : ""}
  </span>`;

// Sospecha vigente: sale de las últimas partidas del jugador.
function currentHtml(s) {
  const why = [];
  if (s.streak) why.push(`<b>${s.streak.count} partidas seguidas</b> en el mismo equipo (${span(s.streak.from, s.streak.to)})`);
  if (s.day) why.push(`<b>${s.day.count} partidas juntos</b> el ${day(s.day.date)}`);
  if (!why.length) why.push(`<b>${s.together} partidas juntos</b> sin enfrentarse nunca`);
  return `
    <li class="suspect ${s.level}">
      ${who(s, `<span class="tag ${s.level === "alto" ? "hot" : "warn"}">Sospecha ${s.level === "alto" ? "alta" : "media"}</span>`)}
      <span class="suspect-why">${why.join(" · ")}</span>
      <span class="suspect-nums">${crossed(s)}</span>
    </li>`;
}

// Histórico: sospechas altas y días pasados del límite, con la fecha en que se detectaron.
function historyHtml(h) {
  const when = `<span class="suspect-date">Detectado el ${fmtWhen.format(new Date(h.at))}</span>`;
  if (h.kind === "limit") {
    return `
      <li class="suspect alto">
        <span class="suspect-who">Límite diario superado <span class="tag hot">+${h.over}</span></span>
        <span class="suspect-why">Jugó <b>${h.played} partidas</b> el ${day(h.date)}.</span>
        ${when}
      </li>`;
  }
  return `
    <li class="suspect alto">
      ${who(h, `<span class="tag hot">Posible dúo</span>`)}
      <span class="suspect-why">${h.streak ? `<b>${h.streak} partidas seguidas</b> en el mismo equipo` : `<b>${h.together} partidas juntos</b> sin enfrentarse`} (${span(h.from, h.to)})</span>
      <span class="suspect-nums">${crossed(h)}</span>
      ${when}
    </li>`;
}

const hasAlerts = (p) => Boolean(p.error || p.current?.length || p.history?.length);

function cardHtml(p) {
  if (p.error) return `<article class="adm-card flagged"><h3>${esc(p.alias)} <small>${esc(p.riotId)}</small></h3><p class="adm-err">${esc(p.error)}</p></article>`;
  return `
    <article class="adm-card flagged">
      <h3><a href="${esc(p.opggUrl)}" target="_blank" rel="noopener">${esc(p.alias)}</a> <small>${esc(p.riotId)}</small></h3>
      ${p.current.length ? `
        <h4>Ahora <small>últimas ${windowSize} partidas</small></h4>
        <ul class="suspects">${p.current.map(currentHtml).join("")}</ul>` : ""}
      ${p.history.length ? `
        <h4>Histórico</h4>
        <ul class="suspects">${p.history.map(historyHtml).join("")}</ul>` : ""}
    </article>`;
}

// Solo se muestran los jugadores con alguna alerta; el resto no aparece.
function render(data) {
  windowSize = data.window;
  const list = data.players;
  const flagged = list.filter(hasAlerts);
  const now = list.reduce((n, p) => n + (p.current?.length || 0), 0);
  const duos = list.reduce((n, p) => n + (p.history?.filter((h) => h.kind === "duo").length || 0), 0);
  const days = list.reduce((n, p) => n + (p.history?.filter((h) => h.kind === "limit").length || 0), 0);
  const box = (n, one, many) => `<div class="${n ? "hot" : ""}"><b>${n}</b><span>${n === 1 ? one : many}</span></div>`;
  $("adm-summary").innerHTML =
    box(now, "sospecha vigente de dúo", "sospechas vigentes de dúo") +
    box(duos, "sospecha alta en el histórico", "sospechas altas en el histórico") +
    box(days, "día con el límite superado", "días con el límite superado");
  $("adm-cards").innerHTML = flagged.length
    ? flagged.map(cardHtml).join("")
    : `<p class="adm-clear">Sin alertas: se revisaron ${list.length} jugadores y ninguno tiene posibles dúos ni días pasados del límite.</p>`;

  const checked = list.map((p) => p.checkedAt).filter(Boolean).sort();
  const pending = list.filter((p) => !p.error && !p.checkedAt).length;
  $("adm-status").textContent = `${list.length} jugadores` +
    (checked.length ? ` · Última revisión ${fmtWhen.format(new Date(checked[checked.length - 1]))}` : "") +
    (pending ? ` · ${pending} todavía sin revisar` : "");
}

/* ---------- carga ---------- */
async function load() {
  $("adm-status").textContent = "Cargando…";
  const data = await api();
  setBrand(data.title);
  $("foot-name").textContent = data.title;
  $("adm-note").hidden = data.storage;
  $("adm-demo").hidden = !data.demo;
  show(true);
  render(data);
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
