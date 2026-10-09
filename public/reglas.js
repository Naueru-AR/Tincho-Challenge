// Página de reglas. El texto está escrito a mano en reglas.html; acá solo se completan
// el nombre, la edición y los números del banco de partidas, que salen de participants.json.
import { $, setBrand } from "./shared.js";

fetch("/participants.json")
  .then((r) => r.json())
  .then((cfg) => {
    document.title = `Reglas · ${cfg.title}`;
    setBrand(cfg.title);
    $("foot-name").textContent = cfg.title;
    const year = new Date(cfg.start).getFullYear();
    $("chip").textContent = cfg.edition ? `${cfg.edition} · ${year}` : String(year);
    // El límite diario se muestra con el mismo número que usa el resto del sitio.
    const fill = (cls, value) => { if (value != null) for (const el of document.querySelectorAll(cls)) el.textContent = value; };
    fill(".rule-limit", cfg.dailyLimit);
    fill(".rule-free", cfg.freeLastDays);
  })
  .catch(() => {}); // si falla, la página queda con los textos por defecto
