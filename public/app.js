import { $, esc, tierColor, isApex, TIER_ES, POD_DEFS, podiumHtml, avatarHtml, dd, ddReady, setBrand, tierIcon } from "./shared.js";

const LADDER = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER"];
const POS_ES = { TOP: "Top", JUNGLE: "Jungla", MIDDLE: "Mid", BOTTOM: "ADC", UTILITY: "Support" };

const qs = new URLSearchParams(location.search);
const demoParam = qs.has("demo") ? "?demo" : "";
const historyCache = new Map();
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

/* ---------- top 3 ---------- */
// Los tres primeros de la tabla general. El podio por bracket (High y Low Elo)
// está en podio.html y se habilita cuando termina el torneo.
function renderTop3(players) {
  $("top3").innerHTML = POD_DEFS + podiumHtml(players.filter((p) => p.score >= 0));
}

/* ---------- tabla ---------- */
function renderBoard(players) {
  $("board").innerHTML = players.map((p, i) => {
    const games = p.wins + p.losses;
    const wr = games ? Math.round((p.wins / games) * 100) : null;
    const tier = p.tier
      ? `<span class="tier" style="--tier-c:${tierColor(p.tier)}">
           <img class="tier-icon" src="${tierIcon(p.tier)}" alt="" onerror="this.remove()">
           <span>${TIER_ES[p.tier]}${isApex(p.tier) ? "" : " " + p.rank}<small>${p.lp} LP</small></span>
         </span>`
      : `<span class="tier"><span>Sin rango<small>${games ? "" : "0 partidas"}</small></span></span>`;
    return `
    <li class="row" data-i="${i}">
      <div class="row-main">
        <span class="pos">${i + 1}</span>
        <span class="who">
          ${avatarHtml(p)}
          <span class="who-text">
            <button class="alias toggle" type="button" aria-expanded="false" aria-controls="h-${i}" ${p.puuid ? "" : "disabled"}>${esc(p.alias)}</button>
            <span class="rid"><a href="${esc(p.opggUrl)}" target="_blank" rel="noopener">${esc(p.riotId)}</a></span>
            ${p.error ? `<span class="row-error">${esc(p.error)}</span>` : ""}
          </span>
        </span>
        ${tier}
        <span class="wr">
          <span class="wr-top">
            <b class="wr-val ${wr === null ? "" : wr >= 50 ? "up" : "down"}">${wr === null ? "–" : wr + "%"}</b>
            <span class="wr-wl"><span class="w">${p.wins}V</span> · <span class="l">${p.losses}D</span></span>
          </span>
          <span class="wr-bar" aria-hidden="true">${games ? `<i class="w" style="flex:${p.wins}"></i><i class="l" style="flex:${p.losses}"></i>` : ""}</span>
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
      historyCache.set(p.puuid, data);
    } catch (e) {
      box.innerHTML = `<p class="history-msg">${esc(e.message)} Tocá de nuevo el jugador para reintentar.</p>`;
      btn.setAttribute("aria-expanded", "false"); row.classList.remove("open");
      setTimeout(() => (box.hidden = true), 2500);
      return;
    }
  }
  box.innerHTML = renderGames(historyCache.get(p.puuid));
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

// Franja de resumen arriba del historial, todo sobre el día de hoy: a la izquierda,
// cuántas partidas jugó sobre el límite diario; a la derecha, cómo le fue.
function renderSummary(today, sum) {
  const over = today ? today.played - today.limit : 0;
  const flag = !today ? ""
    : over > 0 ? `<span class="today-flag over">Límite superado por ${over}</span>`
    : over === 0 ? `<span class="today-flag full">Llegó al límite</span>`
    : `<span class="today-flag">Le quedan ${-over}</span>`;
  return `
    <div class="today${over > 0 ? " over" : ""}">
      <div class="today-row">
        ${today ? `<span class="today-title">Hoy</span>
        <span class="today-count"><b>${today.played}</b> de ${today.limit} partidas</span>${flag}` : ""}
        ${sum ? `<span class="today-sum">${sum}</span>` : ""}
      </div>
      ${today ? `<div class="today-meter" role="img" aria-label="${today.played} de ${today.limit} partidas jugadas hoy">${
        Array.from({ length: today.limit }, (_, i) => `<i class="${i < today.played ? "on" : ""}"></i>`).join("")}</div>` : ""}
    </div>`;
}

function renderGames({ matches, today }) {
  if (!matches.length) return `${renderSummary(today, "")}<p class="history-msg">Hoy todavía no jugó partidas de SoloQ.</p>`;
  const played = matches.filter((m) => !m.remake); // las remakes no suman ni restan
  const w = played.filter((m) => m.win).length;
  const remakes = matches.length - played.length;
  const img = (c) => dd.version ? `https://ddragon.leagueoflegends.com/cdn/${dd.version}/img/champion/${encodeURIComponent(c)}.png` : "";
  const known = matches.filter((m) => typeof m.lpChange === "number");
  const net = known.reduce((s, m) => s + m.lpChange, 0);
  const res = (m) => m.remake
    ? `<span class="g-res" title="Remake: no cuenta como victoria ni derrota.">Remake</span>`
    : typeof m.lpChange === "number"
    ? `<span class="g-res has-lp" title="${m.win ? "Victoria" : "Derrota"}"><b>${signed(m.lpChange)}</b><small>LP</small></span>`
    : `<span class="g-res" title="${m.win ? "Victoria" : "Derrota"}. Los LP de esta partida no quedaron registrados.">${m.win ? "V" : "D"}</span>`;
  const sum = `<b class="up">${w}</b> ${w === 1 ? "ganada" : "ganadas"} · <b class="down">${played.length - w}</b> ${played.length - w === 1 ? "perdida" : "perdidas"} · <b>${remakes}</b> ${remakes === 1 ? "remake" : "remakes"}${
    known.length ? ` · <b class="${net >= 0 ? "up" : "down"}">${signed(net)} LP</b>` : ""}`;
  return `
    ${renderSummary(today, sum)}
    <ul class="games" aria-label="Partidas de hoy">
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
  setBrand(d.title);
  $("foot-name").textContent = d.title;
  const year = new Date(d.start).getFullYear();
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
  $("final-link").href = `podio.html${demoParam}`;
  $("final-link").hidden = now < e; // el podio final aparece cuando termina el torneo
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
  if (!lastData) $("board").innerHTML = Array.from({ length: 6 }, () => `<li class="skeleton"></li>`).join("");
  try {
    const res = await fetch(`/api/leaderboard${demoParam}`);
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}.`);
    lastData = await res.json();
    await ddReady; // hace falta para los íconos de las cuentas
    historyCache.clear();
    renderHeader(lastData);
    $("updated").textContent = `Actualizado ${fmtTime.format(new Date(lastData.updatedAt))}`;
    $("demo").hidden = !lastData.demo;
    renderTop3(lastData.players);
    renderBoard(lastData.players);
    renderLadder(lastData.players);
  } catch (e) {
    $("updated").textContent = `No se pudo actualizar: ${e.message}`;
    if (!lastData) $("board").innerHTML = `<li class="history-msg">No pudimos cargar la tabla. Revisá tu conexión y recargá la página.</li>`;
  }
}

$("board").addEventListener("click", (e) => {
  const btn = e.target.closest(".toggle");
  if (btn && !btn.disabled) toggleHistory(btn.closest(".row"));
});
let resizeT;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => lastData && renderLadder(lastData.players), 150); });

load();
setInterval(load, 5 * 60 * 1000);
