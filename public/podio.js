// Podio final: los tres primeros de High Elo y de Low Elo.
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

  const cut = d.highEloFrom;
  const cutText = `${TIER_ES[cut.tier]}${cut.rank ? " " + cut.rank : ""}`;
  const brackets = [
    { key: "high", name: "High Elo", note: `${cutText} o más` },
    { key: "low", name: "Low Elo", note: `Por debajo de ${cutText}` },
  ];
  $("podiums").innerHTML = POD_DEFS + brackets.map((b) => {
    const top = d.players.filter((p) => p.bracket === b.key);
    return `
      <div class="podium-group ${b.key}">
        <h2 class="podium-title">${b.name}<small>${esc(b.note)}</small></h2>
        ${top.length ? podiumHtml(top) : `<p class="podium-none">No hubo jugadores en este bracket.</p>`}
      </div>`;
  }).join("");
}

fetch(`/api/leaderboard${demoParam}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`El servidor respondió ${r.status}.`))))
  .then(async (d) => { await ddReady; render(d); })
  .catch((e) => { $("podiums").innerHTML = `<p class="podium-none">No pudimos cargar el podio: ${esc(e.message)}</p>`; });
