// Datos falsos para ver la página sin API key (o agregando ?demo a la URL).
const CHAMPS = ["Ahri", "LeeSin", "Jinx", "Thresh", "Darius", "Yasuo", "Lux", "Kaisa", "Viego", "Orianna", "Sett", "Nami", "Ezreal", "Graves", "Malphite"];
const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

const DEMO_PLAYERS = [
  { tier: "MASTER", rank: "I", lp: 212, wins: 96, losses: 71 },
  { tier: "DIAMOND", rank: "I", lp: 54, wins: 61, losses: 44 },
  { tier: "DIAMOND", rank: "III", lp: 8, wins: 70, losses: 63 },
  { tier: "EMERALD", rank: "I", lp: 88, wins: 52, losses: 47 },
  { tier: "EMERALD", rank: "III", lp: 12, wins: 40, losses: 38 },
  { tier: "PLATINUM", rank: "I", lp: 71, wins: 33, losses: 30 },
  { tier: "PLATINUM", rank: "IV", lp: 0, wins: 29, losses: 34 },
  { tier: "GOLD", rank: "II", lp: 45, wins: 21, losses: 26 },
  { tier: "SILVER", rank: "I", lp: 97, wins: 18, losses: 22 },
  { tier: null },
];

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

export function demoLeaderboard(cfg) {
  return cfg.players.map((p, i) => {
    const d = DEMO_PLAYERS[i % DEMO_PLAYERS.length];
    return { puuid: `demo-${i}`, profileIconId: [7, 23, 12, 28, 18, 4, 21, 9][i % 8], ...d };
  });
}

// Partidas de "hoy" de ejemplo. Algunos jugadores se pasan del límite diario para ver el aviso.
export function demoMatches(puuid) {
  const i = Number(puuid.split("-")[1]) || 0;
  const r = rand(i + 7);
  const now = Date.now();
  const games = [7, 12, 14, 3, 0, 9][i % 6];
  const remakeAt = i % 2 ? 2 : -1; // algunos jugadores tienen una remake en el día
  const total = games + (remakeAt >= 0 ? 1 : 0);
  return Array.from({ length: total }, (_, k) => {
    const endedAt = now - (k * 47 + 4) * 60 * 1000;
    if (k === remakeAt) {
      return {
        id: `DEMO_${i}_${k}`, remake: true, win: false, champion: CHAMPS[(i + k) % CHAMPS.length],
        position: POSITIONS[(i + k) % 5], kills: 0, deaths: 0, assists: 0, cs: 0, duration: 195, endedAt, lpChange: null,
      };
    }
    const win = r() > 0.45 - i * 0.03;
    const duration = 1300 + Math.floor(r() * 900);
    return {
      id: `DEMO_${i}_${k}`,
      win,
      champion: CHAMPS[Math.floor(r() * CHAMPS.length)],
      position: POSITIONS[(i + k) % 5],
      kills: Math.floor(r() * (win ? 12 : 7)),
      deaths: 1 + Math.floor(r() * (win ? 5 : 9)),
      assists: Math.floor(r() * 14),
      cs: Math.floor(duration / 60 * (5 + r() * 3)),
      duration,
      endedAt,
      // La primera partida del día queda sin LP, como pasa cuando no llegó a registrarse.
      lpChange: k === total - 1 ? null : win ? 18 + Math.floor(r() * 11) : -(14 + Math.floor(r() * 9)),
    };
  });
}

// Partidas de ejemplo para el panel del organizador (ver lib/duo.js).
// El jugador 2 tiene un dúo evidente y un día pasado del límite; el 1, un compañero repetido.
const DEMO_NAMES = ["Zed Main", "xXMidOrFeedXx", "Tryndamigo", "La Vaca Lola", "Faker de Lanus", "Jungla Diff", "Teemo Hater", "El Bicho", "Mate Amargo", "SupGap", "Chori Pan", "Nashor Dance"];
export function demoRecords(i) {
  const r = rand(i + 31);
  // Cada desconocido es distinto, como en SoloQ real: solo se repiten los que plantamos a propósito.
  let n = 0;
  const someone = () => { const name = `${DEMO_NAMES[Math.floor(r() * DEMO_NAMES.length)]} ${++n}`; return [`demo-${i}-${n}`, `${name}#LAS`]; };
  const duo = ["demo-duo", "Duo Sospechoso#LAS"];
  const repeat = ["demo-rep", "Compa Repetido#LAS"];
  // Con 8 por día, en 3 días hay 24 habilitadas: el 0 las usa justo, el 2 y el 5 se pasan.
  const perDay = [[6, 10, 8], [8, 10, 5], [10, 14, 9], [4, 3, 6], [0, 2, 0], [7, 9, 11]][i % 6];
  const DAY = 24 * 60 * 60 * 1000;
  const out = [];
  perDay.forEach((games, d) => {
    for (let k = 0; k < games; k++) {
      const mates = [someone(), someone(), someone(), someone()];
      if (i % 6 === 2 && d === 1 && k < 6) mates[0] = duo; // seis seguidas con el mismo
      if (i % 6 === 1 && d === 1 && k % 3 === 0) mates[0] = repeat; // cuatro salteadas en un día
      out.push({
        id: `DEMO_${i}_${d}_${k}`,
        t: Date.now() - (2 - d) * DAY - (games - k) * 45 * 60 * 1000,
        remake: i % 2 === 1 && d === 0 && k === 1,
        win: r() > 0.48,
        mates,
        foes: [someone(), someone(), someone(), someone(), someone()],
      });
    }
  });
  return out;
}

// Banco de partidas de ejemplo al empezar el día, para ver los casos: le quedan, lo agotó
// justo, se pasó y cupo liberado (null, como en los últimos días del torneo).
export function demoBank(puuid) {
  const i = Number(puuid.split("-")[1]) || 0;
  return [14, 12, 10, null, 24, 8][i % 6];
}

// Con la lista de participantes vacía, el modo de ejemplo usa estos jugadores inventados
// para que igual se pueda ver cómo queda el sitio.
export function demoPlayers(cfg) {
  if (cfg.players.length) return cfg.players;
  return ["Ejemplo Uno", "Ejemplo Dos", "Ejemplo Tres", "Ejemplo Cuatro", "Ejemplo Cinco", "Ejemplo Seis"].map((alias, i) => ({ alias, riotId: `Ejemplo${i + 1}#DEMO` }));
}
