// Podio final: seis lugares, los tres primeros de High Elo y los tres primeros de Low Elo,
// con las mismas tarjetas que el Top 3 de la página de inicio.
// Se habilita cuando termina el torneo. Con ?preview se puede ver antes, para probar.
import { $, esc, TIER_ES, POD_DEFS, podiumHtml, ddReady, setBrand } from "./shared.js";

const qs = new URLSearchParams(location.search);
const demoParam = qs.has("demo") ? "?demo" : "";
const fmtDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" });

function render(d) {
  document.title = `Podio final · ${d.title}`;
  setBrand(d.title);
  $("foot-name").textContent = d.title;
  $("chip").textContent = d.edition ? `${d.edition} · ${new Date(d.start).getFullYear()}` : String(new Date(d.start).getFullYear());

  const end = new Date(d.end);
  const finished = Date.now() >= end.getTime();
  if (!finished && !qs.has("preview")) {
    $("final-lead").textContent = `Se habilita cuando termine el torneo, el ${fmtDay.format(new Date(end.getTime() - 1))}.`;
    $("podiums").innerHTML = `<p class="podium-none">Todavía se está jugando. Mientras tanto, seguí la tabla en vivo.</p>`;
    return;
  }
  $("final-lead").textContent = finished
    ? `Resultado final al ${fmtDay.format(new Date(end.getTime() - 1))}.`
    : "Vista previa: el torneo todavía no terminó, estas posiciones pueden cambiar.";

  // El corte: desde ese rango para arriba es High Elo; el escalón anterior para abajo, Low Elo.
  // Con el corte en Diamante III queda "Diamante III o más" y "Diamante IV o menos".
  const cut = d.highEloFrom;
  const TIERS = Object.keys(TIER_ES), RANKS = ["IV", "III", "II", "I"];
  const name = (tier, rank) => `${TIER_ES[tier]}${rank ? " " + rank : ""}`;
  const r = RANKS.indexOf(cut.rank);
  const below = r > 0 ? name(cut.tier, RANKS[r - 1]) : name(TIERS[TIERS.indexOf(cut.tier) - 1], "I");
  const groups = [
    { key: "high", name: "High Elo", note: `${name(cut.tier, cut.rank)} o más` },
    { key: "low", name: "Low Elo", note: `${below} o menos` },
  ];
  $("podiums").innerHTML = POD_DEFS + groups.map((b) => {
    const top = d.players.filter((p) => p.bracket === b.key);
    return `
      <div class="podium-group ${b.key}">
        <h2 class="podium-title">${b.name}<small>${esc(b.note)}</small></h2>
        ${top.length ? podiumHtml(top, "Sin jugador") : `<p class="podium-none">No hubo jugadores en esta categoría.</p>`}
      </div>`;
  }).join("");
}

fetch(`/api/leaderboard${demoParam}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`El servidor respondió ${r.status}.`))))
  .then(async (d) => { await ddReady; render(d); })
  .catch((e) => { $("podiums").innerHTML = `<p class="podium-none">No pudimos cargar el podio: ${esc(e.message)}</p>`; });
