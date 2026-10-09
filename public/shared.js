// Lo que comparten la página principal (app.js) y el podio final (podio.js).
export const TIER_ES = {
  IRON: "Hierro", BRONZE: "Bronce", SILVER: "Plata", GOLD: "Oro", PLATINUM: "Platino",
  EMERALD: "Esmeralda", DIAMOND: "Diamante", MASTER: "Maestro", GRANDMASTER: "Gran Maestro", CHALLENGER: "Retador",
};
const TIER_VAR = {
  IRON: "iron", BRONZE: "bronze", SILVER: "silver", GOLD: "gold", PLATINUM: "platinum",
  EMERALD: "emerald", DIAMOND: "diamond", MASTER: "master", GRANDMASTER: "master", CHALLENGER: "master",
};

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const tierColor = (tier) => `var(--t-${TIER_VAR[tier] || "iron"})`;
export const isApex = (tier) => ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier);
export const rankText = (p) => `${TIER_ES[p.tier]}${isApex(p.tier) ? "" : " " + p.rank}`;

// Emblema oficial de cada rango (Community Dragon publica los archivos del cliente del juego).
export const tierIcon = (tier) =>
  `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier.toLowerCase()}.svg`;

/* ---------- escudo del encabezado ---------- */
// El nombre del torneo va dentro del escudo: las primeras palabras en la cinta
// dorada y la última en la cinta de abajo. Si no entra, se comprime para que entre.
function fitText(el, text, max) {
  el.textContent = text;
  el.removeAttribute("textLength");
  if (el.getComputedTextLength() > max) {
    el.setAttribute("textLength", max);
    el.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
}
export function setBrand(title) {
  const words = title.trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : "";
  const draw = () => { fitText($("brand-name"), words.join(" "), 72); fitText($("brand-last"), last, 54); };
  draw();
  document.fonts?.ready.then(draw); // se vuelve a medir cuando carga la tipografía
  $("brand").setAttribute("aria-label", `${title}: inicio`);
}

/* ---------- ícono de invocador ---------- */
// Data Dragon necesita el número de versión del juego para armar las URLs de imágenes.
export const dd = { version: null };
export const ddReady = fetch("https://ddragon.leagueoflegends.com/api/versions.json")
  .then((r) => r.json()).then((v) => { dd.version = v[0]; }).catch(() => {});

// Ícono de la cuenta, clickeable: abre el perfil en OP.GG. Si no hay ícono se ve la inicial.
export function avatarHtml(p, extra = "") {
  const src = p.profileIconId != null && dd.version
    ? `https://ddragon.leagueoflegends.com/cdn/${dd.version}/img/profileicon/${p.profileIconId}.png` : "";
  return `
    <a class="avatar" href="${esc(p.opggUrl)}" target="_blank" rel="noopener" title="Ver a ${esc(p.alias)} en OP.GG" aria-label="Perfil de ${esc(p.alias)} en OP.GG" style="--tier-c:${tierColor(p.tier)}">
      <span class="avatar-initial" aria-hidden="true">${esc(p.alias.trim()[0].toUpperCase())}</span>
      ${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.remove()">` : ""}${extra}
    </a>`;
}

/* ---------- podio: corona para el 1.º, medalla de plata y de bronce ---------- */
const CROWN = `
  <svg viewBox="0 0 56 40" aria-hidden="true">
    <path d="M6 32 3 11l13 9L28 4l12 16 13-9-3 21z" fill="url(#pod-gold)" stroke="#8A5E12" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="6" y="32" width="44" height="5" rx="1.5" fill="url(#pod-gold)" stroke="#8A5E12" stroke-width="1.5"/>
    <circle cx="3" cy="10" r="3" fill="#F7D774"/><circle cx="28" cy="4" r="3.4" fill="#F7D774"/><circle cx="53" cy="10" r="3" fill="#F7D774"/>
    <circle cx="28" cy="25" r="3" fill="#D61F3C"/><circle cx="16" cy="27" r="2" fill="#7CC4F5"/><circle cx="40" cy="27" r="2" fill="#7CC4F5"/>
  </svg>`;
const medal = (n, light, dark) => `
  <svg viewBox="0 0 40 52" aria-hidden="true">
    <path d="M9 2h9l4 16h-8z" fill="#3D6FD6"/><path d="M31 2h-9l-4 16h8z" fill="#D61F3C"/>
    <circle cx="20" cy="34" r="15" fill="${dark}"/><circle cx="20" cy="34" r="12" fill="${light}"/>
    <circle cx="20" cy="34" r="12" fill="none" stroke="${dark}" stroke-width="1" stroke-dasharray="2 2.4"/>
    <text x="20" y="40.5" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="18" fill="#141826">${n}</text>
  </svg>`;
const ICONS = [CROWN, medal(2, "#DDE5EE", "#8E9AAB"), medal(3, "#E0A274", "#96582E")];
const PLACE = ["Primer lugar", "Segundo lugar", "Tercer lugar"];

// Degradado dorado de la corona: se define una sola vez por página.
export const POD_DEFS = `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs><linearGradient id="pod-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7D774"/><stop offset="1" stop-color="#C8902E"/></linearGradient></defs>
  </svg>`;

function podCard(p, i) {
  const medal = `<span class="pod-medal" aria-hidden="true">${ICONS[i]}</span>`;
  const place = `<span class="pod-place">${PLACE[i]}</span>`;
  if (!p) return `<li class="pod p${i + 1} empty"><span class="avatar">${medal}</span>${place}<span class="pod-vacant">Vacante</span></li>`;
  const games = p.wins + p.losses;
  return `
    <li class="pod p${i + 1}" style="--tier-c:${tierColor(p.tier)}">
      ${avatarHtml(p, medal)}
      ${place}
      <span class="pod-name">${esc(p.alias)}</span>
      <span class="pod-rank">${rankText(p)}<small>${p.lp} LP</small></span>
      <span class="pod-wl">${p.wins}–${p.losses}${games ? ` · ${Math.round((p.wins / games) * 100)}%` : ""}</span>
    </li>`;
}

// Recibe los jugadores ya ordenados y devuelve el podio con sus tres primeros.
export const podiumHtml = (players) => `<ol class="podium">${[0, 1, 2].map((i) => podCard(players[i], i)).join("")}</ol>`;
