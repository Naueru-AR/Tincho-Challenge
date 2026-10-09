// Datos falsos para ver la página sin API key (o agregando ?demo a la URL).
const CHAMPS = ["Ahri", "LeeSin", "Jinx", "Thresh", "Darius", "Yasuo", "Lux", "Kaisa", "Viego", "Orianna", "Sett", "Nami", "Ezreal", "Graves", "Malphite"];
const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

const DEMO_PLAYERS = [
  { tier: "DIAMOND", rank: "II", lp: 54, wins: 61, losses: 44 },
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
    return { puuid: `demo-${i}`, ...d };
  });
}

export function demoMatches(puuid) {
  const i = Number(puuid.split("-")[1]) || 0;
  const r = rand(i + 7);
  const now = Date.now();
  return Array.from({ length: 10 }, (_, k) => {
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
      endedAt: now - k * 1000 * 60 * 60 * (3 + Math.floor(r() * 10)),
    };
  });
}
