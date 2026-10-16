// Pickems: cada participante entra con su Riot ID y un PIN, y predice cómo termina el torneo.
// Mientras se puede votar, se ve el formulario y quién ya votó. Cuando empieza el torneo se
// ven los picks de todos, y al terminar, los puntos y la respuesta correcta de cada pregunta.
import { $, esc, setBrand, dd, ddReady, POD_DEFS, pickemsPodiumHtml } from "./shared.js";

const fmtClose = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
const SESSION = "pickems-login"; // Riot ID y PIN mientras la pestaña esté abierta

let data = null; // respuesta de GET /api/pickems
let board = []; // jugadores de /api/leaderboard (ícono y OP.GG para el podio)
let me = null; // { riotId, alias, pin, picks, isNew }
const champs = { byId: new Map(), byName: new Map() }; // campeones del LoL (Data Dragon)

const aliasOf = (riotId) => data.players.find((p) => p.riotId === riotId)?.alias || riotId;
const champName = (id) => champs.byId.get(id)?.name || id;
const plain = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const champImg = (id) => (dd.version && champs.byId.has(id) ? `https://ddragon.leagueoflegends.com/cdn/${dd.version}/img/champion/${champs.byId.get(id).id}.png` : "");

async function loadChamps() {
  await ddReady;
  if (!dd.version) return;
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${dd.version}/data/es_AR/champion.json`).catch(() => null);
  const list = res?.ok ? Object.values((await res.json()).data) : [];
  for (const c of list.sort((a, b) => a.name.localeCompare(b.name, "es"))) {
    // En las partidas Riot usa el id (por ejemplo "MonkeyKing" para Wukong); se compara sin mayúsculas.
    champs.byId.set(c.id.toLowerCase(), c);
    champs.byId.set(c.id, c);
    champs.byName.set(c.name.toLowerCase(), c);
  }
}

async function api(method, body) {
  const res = await fetch("/api/pickems", method === "GET" ? { cache: "no-store" } : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `El servidor respondió ${res.status}.`);
  return out;
}

/* ---------- cómo se muestra un pick ---------- */
function pickText(q, v) {
  if (q.kind === "top3") return (v || []).map((x, i) => `${i + 1}.º ${x ? esc(aliasOf(x)) : "—"}`).join(" · ");
  if (!v) return "—";
  if (q.kind === "quit") return `${esc(v.answer)}${v.name ? ` · ${esc(aliasOf(v.name))}` : ""}`;
  if (q.kind === "player") return v === NONE ? "Nadie" : esc(aliasOf(v));
  if (q.kind === "champ") {
    const src = champImg(v);
    return `${src ? `<img class="pk-champ" src="${src}" alt="" loading="lazy">` : ""}${esc(champName(v))}`;
  }
  return esc(v);
}
const answerText = (q, list) => {
  if (q.kind === "quit") return list ? `${esc(list.answer)}${list.names.length ? ` · ${list.names.map((n) => esc(aliasOf(n))).join(", ")}` : ""}` : "A definir por el organizador";
  if (!list?.length) return q.manual ? "A definir por el organizador" : "Sin resolver";
  if (q.kind === "top3") return pickText(q, list);
  return list.map((v) => pickText(q, v)).join(" o ");
};

/* ---------- formulario ---------- */
const NONE = "none"; // "Nadie", en las preguntas que lo permiten
const playerOptions = (sel, none = false, empty = "Elegí un jugador") => `<option value="">${empty}</option>` +
  (none ? `<option value="${NONE}"${sel === NONE ? " selected" : ""}>Nadie</option>` : "") +
  data.players.map((p) => `<option value="${esc(p.riotId)}"${p.riotId === sel ? " selected" : ""}>${esc(p.alias)}</option>`).join("");

function control(q, v) {
  const name = `q-${q.id}`;
  if (q.kind === "player") return `<select class="pk-input" name="${name}">${playerOptions(v, q.none)}</select>`;
  if (q.kind === "quit") {
    return `<div class="pk-options">${q.options.map((o) => `
      <label><input type="radio" name="${name}" value="${esc(o)}"${o === v?.answer ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div>
      <select class="pk-input pk-quit-name" name="${name}-name" aria-label="¿Quién abandona? (opcional)"${v?.answer === "Sí" ? "" : " disabled"}>${playerOptions(v?.name, false, `¿Quién? (opcional, +${q.bonus} pts)`)}</select>`;
  }
  if (q.kind === "top3") {
    return `<div class="pk-top3">${[0, 1, 2].map((i) => `
      <label><span>${i + 1}.º</span><select class="pk-input" name="${name}-${i}">${playerOptions(v?.[i])}</select></label>`).join("")}</div>`;
  }
  if (q.kind === "option") {
    return `<div class="pk-options">${q.options.map((o) => `
      <label><input type="radio" name="${name}" value="${esc(o)}"${o === v ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div>`;
  }
  // Campeón: una grilla con la foto de cada uno, con buscador. El elegido queda en el campo oculto.
  const id = v && champs.byId.get(v) ? champs.byId.get(v).id : "";
  const list = [...champs.byName.values()];
  return `
    <div class="pk-champs">
      <input type="hidden" name="${name}" value="${esc(id)}">
      <p class="pk-champ-sel">${id ? `<img src="${champImg(id)}" alt="">${esc(champName(id))}` : "Ningún campeón elegido"}</p>
      <input class="pk-input pk-champ-search" type="search" placeholder="Buscar campeón" aria-label="Buscar campeón" autocomplete="off">
      <div class="pk-champ-grid" role="listbox" aria-label="${esc(q.text)}">
        ${list.map((c) => `<button type="button" class="pk-ch${c.id === id ? " on" : ""}" data-id="${esc(c.id)}" data-name="${esc(plain(c.name))}" role="option" aria-selected="${c.id === id}" title="${esc(c.name)}"><img src="${champImg(c.id)}" alt="" loading="lazy"><span>${esc(c.name)}</span></button>`).join("")}
      </div>
    </div>`;
}

const qHead = (q, i) => `
  <div class="pk-q-head">
    <span class="pk-num">${i + 1}</span>
    <h3>${esc(q.text)}</h3>
    <span class="pk-pts">${q.points}${q.bonus ? ` +${q.bonus}` : ""} pts</span>
  </div>
  ${q.note ? `<p class="pk-note">${esc(q.note)}</p>` : ""}`;

// Acomoda las tarjetas como ladrillos: cada una ocupa las filas (de 1 px) que necesita, así una
// tarjeta alta no deja un hueco debajo de las chicas que tiene al lado.
let stacker = null;
function stack(list) {
  const fit = () => {
    for (const el of list.children) {
      const h = el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginBottom);
      el.style.gridRowEnd = `span ${Math.ceil(h)}`;
    }
  };
  stacker?.disconnect();
  stacker = new ResizeObserver(() => requestAnimationFrame(fit));
  for (const el of list.children) stacker.observe(el);
  fit();
}

// Lo que votó, de solo lectura: una vez enviado, el voto no se puede cambiar.
function renderMine(justSent = false) {
  $("pk-main").innerHTML = `
    <div class="pk-bar">
      <p class="pk-who">Votaste como <b>${esc(me.alias)}</b> <span class="tag ok">Voto enviado</span></p>
      <button id="pk-exit" class="refresh" type="button">Salir</button>
    </div>
    ${justSent ? `<p class="pk-sent">¡Listo! Tu voto quedó registrado.</p>` : ""}
    <p class="updated">Tu voto ya no se puede cambiar. Los picks de todos se ven cuando cierre la votación.</p>
    <div class="adm-card pk-mine"><ul class="pk-rows">${data.questions.map((q) => `<li><span class="pk-row-q">${esc(q.text)}</span><span class="pk-row-a">${pickText(q, me.picks[q.id])}</span><b>${q.points}</b></li>`).join("")}</ul></div>`;
  $("pk-exit").onclick = () => { sessionStorageSafe("remove"); me = null; render(); };
}

function renderForm() {
  if (me.picks) return renderMine();
  const picks = {};
  $("pk-main").innerHTML = `
    <div class="pk-bar">
      <p class="pk-who">Votando como <b>${esc(me.alias)}</b>${me.isNew ? ` <span class="tag warn">Primera vez</span>` : ""}</p>
      <button id="pk-exit" class="refresh" type="button">Salir</button>
    </div>
    <p class="pk-first">Tenés <b>un solo voto</b>: una vez enviado no se puede cambiar. El PIN que pusiste queda como tu clave para volver a entrar y ver lo que votaste.</p>
    <form id="pk-form" class="pk-list" novalidate>
      ${data.questions.map((q, i) => `<fieldset class="pk-q">${qHead(q, i)}${control(q, picks[q.id])}</fieldset>`).join("")}
      <div class="pk-save">
        <button class="btn-primary" type="submit">Enviar voto</button>
        <p class="pk-msg" id="pk-msg" role="status"></p>
      </div>
    </form>
    <p class="hint">Todas las preguntas son obligatorias. Revisá bien antes de enviar.</p>`;
  $("pk-exit").onclick = () => { sessionStorageSafe("remove"); me = null; render(); };
  $("pk-form").onsubmit = save;
  // Al responder una pregunta marcada como faltante, se le saca la marca.
  $("pk-form").addEventListener("change", (e) => {
    e.target.closest(".pk-q")?.classList.remove("missing");
    // El nombre de quién abandona solo se puede elegir si la respuesta es Sí.
    if (e.target.name === "q-quit") {
      const sel = $("pk-form").elements["q-quit-name"];
      sel.disabled = e.target.value !== "Sí";
      if (sel.disabled) sel.value = "";
    }
  });
  $("pk-form").addEventListener("click", (e) => { if (e.target.closest(".pk-ch")) e.target.closest(".pk-q")?.classList.remove("missing"); });
  stack($("pk-form"));
  for (const box of document.querySelectorAll(".pk-champs")) {
    const hidden = box.querySelector("input[type=hidden]");
    box.querySelector(".pk-champ-search").oninput = (e) => {
      const q = plain(e.target.value.trim());
      for (const b of box.querySelectorAll(".pk-ch")) b.hidden = q !== "" && !b.dataset.name.includes(q);
    };
    box.querySelector(".pk-champ-grid").onclick = (e) => {
      const btn = e.target.closest(".pk-ch");
      if (!btn) return;
      const same = hidden.value === btn.dataset.id; // tocar el elegido lo deselecciona
      hidden.value = same ? "" : btn.dataset.id;
      for (const b of box.querySelectorAll(".pk-ch")) { b.classList.toggle("on", b === btn && !same); b.setAttribute("aria-selected", b === btn && !same); }
      box.querySelector(".pk-champ-sel").innerHTML = same ? "Ningún campeón elegido" : `<img src="${champImg(btn.dataset.id)}" alt="">${esc(champName(btn.dataset.id))}`;
    };
  }
}

function readForm() {
  const f = $("pk-form");
  const val = (n) => f.elements[n]?.value || null;
  const picks = {};
  for (const q of data.questions) {
    const n = `q-${q.id}`;
    if (q.kind === "top3") picks[q.id] = [0, 1, 2].map((i) => val(`${n}-${i}`));
    else if (q.kind === "option") picks[q.id] = f.querySelector(`input[name="${n}"]:checked`)?.value || null;
    else if (q.kind === "quit") {
      const answer = f.querySelector(`input[name="${n}"]:checked`)?.value || null;
      picks[q.id] = answer && { answer, name: answer === "Sí" ? val(`${n}-name`) : null };
    }
    else picks[q.id] = val(n);
  }
  return picks;
}

async function save(e) {
  e.preventDefault();
  const msg = $("pk-msg");
  const picks = readForm();
  const bad = data.questions.find((q) =>
    (q.kind === "top3" && picks[q.id].some((x, i) => x && picks[q.id].indexOf(x) !== i)));
  if (bad) {
    msg.className = "pk-msg err";
    msg.textContent = `“${bad.text}”: no repitas jugadores.`;
    return;
  }
  // Todas son obligatorias: se marcan las que faltan y se lleva a la primera.
  const empty = data.questions.filter((q) => (q.kind === "top3" ? picks[q.id].some((x) => !x) : q.kind === "quit" ? !picks[q.id]?.answer : !picks[q.id]));
  const cards = [...document.querySelectorAll(".pk-q")];
  data.questions.forEach((q, i) => cards[i].classList.toggle("missing", empty.includes(q)));
  if (empty.length) {
    msg.className = "pk-msg err";
    msg.textContent = `Todas las preguntas son obligatorias. Te falta${empty.length > 1 ? "n" : ""} ${empty.length}.`;
    const first = cards[data.questions.indexOf(empty[0])];
    window.scrollTo({ top: first.getBoundingClientRect().top + scrollY - 90 });
    return;
  }
  if (!confirm("Una vez enviado, tu voto no se puede cambiar. ¿Enviarlo?")) return;
  const btn = e.submitter;
  btn.setAttribute("aria-busy", "true");
  try {
    const out = await api("POST", { riotId: me.riotId, pin: me.pin, picks });
    me = { ...me, ...out };
    if (!data.voters.includes(me.alias)) data.voters.push(me.alias);
    renderMine(true);
    window.scrollTo({ top: $("pk-main").getBoundingClientRect().top + scrollY - 90 });
  } catch (err) {
    msg.className = "pk-msg err";
    msg.textContent = err.message;
  } finally {
    btn.removeAttribute("aria-busy");
  }
}

/* ---------- entrar ---------- */
function sessionStorageSafe(op, value) {
  try {
    if (op === "get") return JSON.parse(sessionStorage.getItem(SESSION) || "null");
    if (op === "set") sessionStorage.setItem(SESSION, JSON.stringify(value));
    if (op === "remove") sessionStorage.removeItem(SESSION);
  } catch { return null; }
}

async function login(riotId, pin) {
  const out = await api("POST", { riotId, pin });
  me = { ...out, pin };
  sessionStorageSafe("set", { riotId, pin });
  render();
}

function renderLogin() {
  const voted = data.voters.length;
  $("pk-main").innerHTML = `
    <form id="pk-login" class="adm-login pk-login">
      <label for="pk-id">Tu Riot ID</label>
      <select id="pk-id" class="pk-input" required>
        <option value="">Elegí tu cuenta</option>
        ${data.players.map((p) => `<option value="${esc(p.riotId)}">${esc(p.riotId)}</option>`).join("")}
      </select>
      <label for="pk-pin">PIN de 4 números</label>
      <div class="adm-field">
        <input id="pk-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" required>
        <button class="refresh" type="submit">Entrar</button>
      </div>
      <p class="adm-err" id="pk-err" role="alert"></p>
      <p class="hint">¿Primera vez? Elegí un PIN: queda como tu clave para volver a ver tu voto.</p>
    </form>
    <div class="pk-voters">
      <h2>Ya votaron <small>${voted} de ${data.players.length}</small></h2>
      ${voted ? `<ul class="adm-days">${data.voters.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : `<p class="adm-none">Todavía no votó nadie. ¡Sé el primero!</p>`}
    </div>`;
  $("pk-login").onsubmit = async (e) => {
    e.preventDefault();
    const err = $("pk-err");
    err.textContent = "";
    const pin = $("pk-pin").value.trim();
    if (!$("pk-id").value) return void (err.textContent = "Elegí tu Riot ID.");
    if (!/^\d{4}$/.test(pin)) return void (err.textContent = "El PIN tiene que ser de 4 números.");
    e.submitter.setAttribute("aria-busy", "true");
    try { await login($("pk-id").value, pin); } catch (x) { err.textContent = x.message; e.submitter?.removeAttribute("aria-busy"); }
  };
}

/* ---------- picks de todos (cerrado) y resultados (final) ---------- */
function renderVotes() {
  const final = Boolean(data.answers);
  const votes = data.votes || [];
  if (!votes.length) {
    $("pk-main").innerHTML = `<p class="podium-none">Nadie dejó sus picks antes del cierre.</p>`;
    return;
  }
  const row = (q, v) => {
    const pts = final ? v.byQuestion[q.id] : null;
    const cls = final ? (pts >= q.points ? "hit" : pts > 0 ? "part" : "miss") : "";
    return `<li class="${cls}"><span class="pk-row-q">${esc(q.text)}</span><span class="pk-row-a">${pickText(q, v.picks?.[q.id])}</span>${final ? `<b>${pts}</b>` : ""}</li>`;
  };
  const card = (v, i) => `
    <details class="adm-card pk-card"${!final && votes.length === 1 ? " open" : ""}>
      <summary>
        ${final ? `<span class="pk-pos">${i + 1}</span>` : ""}
        <span class="pk-name">${esc(v.alias)}</span>
        ${final ? `<span class="pk-total">${v.total}<small> / ${data.max}</small></span>` : `<span class="pk-see">Ver picks</span>`}
      </summary>
      <ul class="pk-rows">${data.questions.map((q) => row(q, v)).join("")}</ul>
    </details>`;
  const answersBlock = final ? `
    <div class="pk-answers">
      <h2>Respuestas</h2>
      <ul class="pk-rows">${data.questions.map((q) => `<li><span class="pk-row-q">${esc(q.text)}</span><span class="pk-row-a">${answerText(q, data.answers[q.id])}</span><b>${q.points}</b></li>`).join("")}</ul>
    </div>` : "";
  const podium = final ? `<div class="podium-group pickems pk-podium">${POD_DEFS}${pickemsPodiumHtml(votes, board, data.max)}</div>` : "";
  $("pk-main").innerHTML = `
    ${podium}
    <h2>${final ? "Tabla de Pickems" : "Los picks de cada uno"}</h2>
    ${final ? "" : `<p class="updated">${data.status === "calculating" ? "Estamos recontando todas las partidas del torneo. Los puntos aparecen cuando termine el recuento." : "Los puntos se calculan cuando termina el torneo."}</p>`}
    <div class="pk-cards">${votes.map(card).join("")}</div>
    ${answersBlock}`;
}

/* ---------- página ---------- */
function render() {
  if (data.status === "open") {
    $("pk-when").textContent = `Cierra el ${fmtClose.format(new Date(data.closes))} h`;
    if (data.unavailable) return void ($("pk-main").innerHTML = `<p class="podium-none">Los Pickems no están disponibles ahora.</p>`);
    return me ? renderForm() : renderLogin();
  }
  $("pk-when").textContent = data.answers ? "Resultados finales" : data.status === "calculating" ? "El torneo terminó: calculando resultados" : "Cerrado: el torneo está en juego";
  renderVotes();
}

async function start() {
  try {
    [data] = await Promise.all([api("GET"), loadChamps()]);
    // Con los resultados, el podio usa el ícono de la cuenta de cada uno.
    if (data.answers) board = (await fetch("/api/leaderboard").then((r) => r.json()).catch(() => ({}))).players || [];
  } catch (e) {
    $("pk-main").innerHTML = `<p class="podium-none">No pudimos cargar los Pickems: ${esc(e.message)}</p>`;
    return;
  }
  document.title = `Pickems · ${data.title}`;
  $("pk-max").textContent = `${data.max} puntos`;
  setBrand(data.title);
  $("foot-name").textContent = data.title;
  const year = new Date(data.start).getFullYear();
  $("chip").textContent = data.edition ? `${data.edition} · ${year}` : String(year);

  // Si ya había entrado en esta pestaña, vuelve directo a su formulario.
  const saved = data.status === "open" && sessionStorageSafe("get");
  if (saved) {
    try { return void (await login(saved.riotId, saved.pin)); } catch { sessionStorageSafe("remove"); }
  }
  render();
}

start();
