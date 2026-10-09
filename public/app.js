const TIER_ES = {
  IRON: "Hierro", BRONZE: "Bronce", SILVER: "Plata", GOLD: "Oro", PLATINUM: "Platino",
  EMERALD: "Esmeralda", DIAMOND: "Diamante", MASTER: "Maestro", GRANDMASTER: "Gran Maestro", CHALLENGER: "Retador",
};
const TIER_VAR = {
  IRON: "iron", BRONZE: "bronze", SILVER: "silver", GOLD: "gold", PLATINUM: "platinum",
  EMERALD: "emerald", DIAMOND: "diamond", MASTER: "master", GRANDMASTER: "master", CHALLENGER: "master",
};
const LADDER = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER"];
const POS_ES = { TOP: "Top", JUNGLE: "Jungla", MIDDLE: "Mid", BOTTOM: "ADC", UTILITY: "Support" };

const qs = new URLSearchParams(location.search);
const demoParam = qs.has("demo") ? "?demo" : "";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tierColor = (tier) => `var(--t-${TIER_VAR[tier] || "iron"})`;
const historyCache = new Map();
let ddVersion = null;
let lastData = null;

/* ---------- utilidades de fecha ---------- */
const fmtDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long" });
const fmtTime = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });

function rangeText(start, end) {
  const s = new Date(start), e = new Date(new Date(end).getTime() - 1);
  return `Del ${fmtDay.format(s)} al ${fmtDay.format(e)}`;
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 6e4);
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ---------- escalera de rangos ---------- */
function renderLadder(players) {
  const el = $("ladder");
  const ranked = players.filter((p) => p.score >= 0);
  const unranked = players.length - ranked.length;
  if (!ranked.length) {
    el.innerHTML = `<p class="unranked-note">Todavía nadie tiene rango en SoloQ. La escalera aparece cuando alguien termine sus partidas de posicionamiento.</p>`;
    return;
  }

  // La escalera siempre llega hasta Maestro+ (la meta del torneo) y arranca
  // en el tier del jugador más bajo, con un mínimo de 3 tiers para que se lea bien.
  const scores = ranked.map((p) => p.score);
  const hi = 8;
  const lo = Math.min(Math.floor(Math.min(...scores) / 400), hi - 3);
  const tiers = LADDER.slice(lo, hi);
  const pct = (score) => ((Math.min(score, hi * 400 - 1) - lo * 400) / ((hi - lo) * 400)) * 100;

  // Repartimos los nombres en "carriles" para que no se pisen.
  const width = el.clientWidth || 600;
  const lanesEnd = [];
  const leaderScore = Math.max(...scores);
  const markers = [...ranked].sort((a, b) => a.score - b.score).map((p) => {
    const x = pct(p.score);
    const px = (x / 100) * width;
    const half = (p.alias.length * 8.5 + 18) / 2;
    let lane = lanesEnd.findIndex((end) => end < px - half - 6);
    if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(0); }
    lanesEnd[lane] = px + half;
    return { p, x, lane };
  });
  const laneH = 30;
  el.style.setProperty("--lanes-h", `${lanesEnd.length * laneH + 14}px`);

  const SHORT = { IRON: "Hie", BRONZE: "Bro", SILVER: "Plata", GOLD: "Oro", PLATINUM: "Plat", EMERALD: "Esm", DIAMOND: "Dia", MASTER: "Mae+" };
  const tierName = (t) => (width / tiers.length < 90 ? SHORT[t] : t === "MASTER" ? "Maestro+" : TIER_ES[t]);
  el.setAttribute("aria-label", ranked.map((p) => `${p.alias}: ${TIER_ES[p.tier]}${p.rank && LADDER.indexOf(p.tier) < 7 ? " " + p.rank : ""}, ${p.lp} LP`).join("; "));
  el.innerHTML = `
    <div class="ladder-markers">
      ${markers.map(({ p, x, lane }) => `
        <div class="marker${p.score === leaderScore ? " is-leader" : ""}" style="left:${x}%;--tier-c:${tierColor(p.tier)};--stem:${10 + lane * laneH}px">
          <span class="marker-name">${esc(p.alias)}</span><span class="marker-stem"></span>
        </div>`).join("")}
    </div>
    <div class="band">
      ${tiers.map((t) => `<div class="band-tier${t === "MASTER" ? " single" : ""}" style="--tier-c:${tierColor(t)}">
        ${(t === "MASTER" ? [0] : [0, 1, 2, 3]).map(() => `<span class="band-div"></span>`).join("")}
      </div>`).join("")}
    </div>
    <div class="band-labels">${tiers.map((t) => `<span style="--tier-c:${tierColor(t)}">${tierName(t)}</span>`).join("")}</div>
    ${unranked ? `<p class="unranked-note">${unranked === 1 ? "1 jugador sin rango todavía" : `${unranked} jugadores sin rango todavía`}.</p>` : ""}
  `;
}

/* ---------- tabla ---------- */
function renderBoard(players) {
  $("board").innerHTML = players.map((p, i) => {
    const games = p.wins + p.losses;
    const wr = games ? Math.round((p.wins / games) * 100) : null;
    const isApex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(p.tier);
    const tier = p.tier
      ? `<span class="tier" style="--tier-c:${tierColor(p.tier)}">${TIER_ES[p.tier]}${isApex ? "" : " " + p.rank}<small>${p.lp} LP</small></span>`
      : `<span class="tier">Sin rango<small>${games ? "" : "0 partidas"}</small></span>`;
    return `
    <li class="row" data-i="${i}">
      <div class="row-main">
        <span class="pos">${i + 1}</span>
        <span class="who">
          <button class="alias toggle" type="button" aria-expanded="false" aria-controls="h-${i}" ${p.puuid ? "" : "disabled"}>${esc(p.alias)}</button>
          <span class="rid"><a href="${esc(p.opggUrl)}" target="_blank" rel="noopener">${esc(p.riotId)}</a></span>
          ${p.error ? `<span class="row-error">${esc(p.error)}</span>` : ""}
        </span>
        ${tier}
        <span class="wl num"><span class="w">${p.wins}</span>–<span class="l">${p.losses}</span></span>
        <span class="wr">
          <span class="wr-val">${wr === null ? "–" : wr + "%"}</span>
          <span class="wr-bar" aria-hidden="true"><i style="width:${wr ?? 0}%"></i></span>
        </span>
      </div>
      <div class="history" id="h-${i}" hidden></div>
    </li>`;
  }).join("");
}

async function toggleHistory(row) {
  const btn = row.querySelector(".toggle");
  const box = row.querySelector(".history");
  const open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!open));
  row.classList.toggle("open", !open);
  box.hidden = open;
  if (open) return;

  const p = lastData.players[Number(row.dataset.i)];
  if (!historyCache.has(p.puuid)) {
    box.innerHTML = `<p class="history-msg">Cargando partidas…</p>`;
    try {
      const res = await fetch(`/api/player/${encodeURIComponent(p.puuid)}${demoParam}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No pudimos cargar el historial.");
      historyCache.set(p.puuid, data.matches);
    } catch (e) {
      box.innerHTML = `<p class="history-msg">${esc(e.message)} Tocá de nuevo el jugador para reintentar.</p>`;
      btn.setAttribute("aria-expanded", "false"); row.classList.remove("open");
      setTimeout(() => (box.hidden = true), 2500);
      return;
    }
  }
  box.innerHTML = renderGames(historyCache.get(p.puuid));
}

function renderGames(matches) {
  if (!matches.length) return `<p class="history-msg">Sin partidas de SoloQ desde que empezó el torneo.</p>`;
  const played = matches.filter((m) => !m.remake); // las remakes no suman ni restan
  const w = played.filter((m) => m.win).length;
  const remakes = matches.length - played.length;
  const img = (c) => ddVersion ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${encodeURIComponent(c)}.png` : "";
  const known = matches.filter((m) => typeof m.lpChange === "number");
  const net = known.reduce((s, m) => s + m.lpChange, 0);
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
  const res = (m) => m.remake
    ? `<span class="g-res" title="Remake: no cuenta como victoria ni derrota.">Remake</span>`
    : typeof m.lpChange === "number"
    ? `<span class="g-res has-lp" title="${m.win ? "Victoria" : "Derrota"}"><b>${signed(m.lpChange)}</b><small>LP</small></span>`
    : `<span class="g-res" title="${m.win ? "Victoria" : "Derrota"}. Los LP de esta partida no quedaron registrados.">${m.win ? "V" : "D"}</span>`;
  return `
    <p class="history-sum">Últimas ${matches.length} partidas del torneo: ${w} ganadas, ${played.length - w} perdidas${remakes ? `, ${remakes} remake${remakes > 1 ? "s" : ""}` : ""}${known.length ? ` · <span class="net ${net >= 0 ? "up" : "down"}">${signed(net)} LP</span>` : ""}</p>
    <ul class="games">
      ${matches.map((m) => `
        <li class="game ${m.remake ? "remake" : m.win ? "win" : "loss"}">
          <img src="${img(m.champion)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span><span class="g-champ">${esc(m.champion)}</span>
            <span class="g-meta">${POS_ES[m.position] || "—"}, ${mmss(m.duration)}, ${ago(m.endedAt)}</span></span>
          <span class="g-kda">${m.kills}/${m.deaths}/${m.assists}<small>${m.cs} CS</small></span>
          ${res(m)}
        </li>`).join("")}
    </ul>`;
}

/* ---------- encabezado y cuenta regresiva ---------- */
function renderHeader(d) {
  document.title = d.title;
  const words = d.title.trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : "";
  $("title").innerHTML = `<span>${esc(words.join(" "))}</span>${last ? ` <span class="gold">${esc(last)}</span>` : ""}`;
  $("brand-name").textContent = d.title;
  $("foot-name").textContent = d.title;
  const year = new Date(d.start).getFullYear();
  $("brand-ed").textContent = d.edition || "";
  $("chip").textContent = d.edition ? `${d.edition} · ${year}` : String(year);
  $("ghost").textContent = year;
  $("when").textContent = `${rangeText(d.start, d.end)} de ${year}`;
  $("meta").textContent = `${d.players.length} ${d.players.length === 1 ? "jugador" : "jugadores"} · SoloQ`;
  tick();
}

function tick() {
  if (!lastData) return;
  const now = Date.now(), s = new Date(lastData.start).getTime(), e = new Date(lastData.end).getTime();
  const box = $("cd-boxes");
  if (now >= e) {
    $("cd-label").textContent = "Resultado final";
    box.innerHTML = `<p class="cd-done">Torneo terminado</p>`;
    return;
  }
  const target = now < s ? s : e;
  $("cd-label").textContent = now < s ? "El torneo arranca en" : "El torneo termina en";
  let t = Math.floor((target - now) / 1000);
  const parts = [Math.floor(t / 86400), Math.floor((t % 86400) / 3600), Math.floor((t % 3600) / 60), t % 60];
  ["cd-d", "cd-h", "cd-m", "cd-s"].forEach((id, i) => { const el = $(id); if (el) el.textContent = String(parts[i]).padStart(2, "0"); });
}
setInterval(tick, 1000);

/* ---------- carga ---------- */
async function load() {
  const btn = $("refresh");
  btn.setAttribute("aria-busy", "true");
  btn.textContent = "Actualizando…";
  if (!lastData) $("board").innerHTML = Array.from({ length: 6 }, () => `<li class="skeleton"></li>`).join("");
  try {
    const res = await fetch(`/api/leaderboard${demoParam}`);
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}.`);
    lastData = await res.json();
    historyCache.clear();
    renderHeader(lastData);
    $("updated").textContent = `Actualizado ${fmtTime.format(new Date(lastData.updatedAt))}`;
    $("demo").hidden = !lastData.demo;
    renderLadder(lastData.players);
    renderBoard(lastData.players);
  } catch (e) {
    $("updated").textContent = `No se pudo actualizar: ${e.message}`;
    if (!lastData) $("board").innerHTML = `<li class="history-msg">No pudimos cargar la tabla. Revisá tu conexión y tocá Actualizar.</li>`;
  } finally {
    btn.removeAttribute("aria-busy");
    btn.textContent = "Actualizar";
  }
}

$("board").addEventListener("click", (e) => {
  const btn = e.target.closest(".toggle");
  if (btn && !btn.disabled) toggleHistory(btn.closest(".row"));
});
$("refresh").addEventListener("click", load);
let resizeT;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => lastData && renderLadder(lastData.players), 150); });

fetch("https://ddragon.leagueoflegends.com/api/versions.json")
  .then((r) => r.json()).then((v) => (ddVersion = v[0])).catch(() => {});
load();
setInterval(load, 5 * 60 * 1000);
