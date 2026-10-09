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
