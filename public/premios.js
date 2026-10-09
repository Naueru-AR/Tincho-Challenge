// Premios del torneo. Se cargan a mano en participants.json, en "prizes".
import { $, esc, setBrand } from "./shared.js";

function render(cfg) {
  document.title = `Premios · ${cfg.title}`;
  setBrand(cfg.title);
  $("foot-name").textContent = cfg.title;
  const year = new Date(cfg.start).getFullYear();
  $("chip").textContent = cfg.edition ? `${cfg.edition} · ${year}` : String(year);

  const prizes = cfg.prizes || [];
  $("prizes").innerHTML = prizes.length
    ? `<ul class="prize-list">${prizes.map((p) => `
        <li class="prize">
          <span class="prize-for">${esc(p.title)}${p.note ? `<small>${esc(p.note)}</small>` : ""}</span>
          <span class="prize-what">${esc(p.prize)}</span>
        </li>`).join("")}</ul>`
    : `<p class="podium-none">Los premios todavía no están anunciados.</p>`;
}

fetch("/participants.json")
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`El servidor respondió ${r.status}.`))))
  .then(render)
  .catch((e) => { $("prizes").innerHTML = `<p class="podium-none">No pudimos cargar los premios: ${esc(e.message)}</p>`; });
