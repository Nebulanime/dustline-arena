// state.js — one object owns every piece of match state. The simulation reads
// and writes only through here, so a round, a score or a wallet can never drift
// out of sync between the HUD, the bots and the game loop.

export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  PLAY: 'play',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export const RULES = {
  winRounds: 5,        // first team to 5 round wins takes the match
  maxRounds: 9,        // hard cap; a 4-4 tie after 9 rounds is a draw
  roundTime: 100,      // seconds per round
  buyTime: 15,         // seconds of buy phase before round 1 and between rounds
  startMoney: 800,
  killReward: 300,
  winBonus: 1000,
  lossBonus: 500,
  captureBonus: 1200,
  captureNeed: 100,    // capture progress 0..100
  captureRate: 9,      // progress per second while one team holds the zone alone
};

// Deterministic RNG (mulberry32) so ?shot= scenes and replays are stable.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createState() {
  return {
    phase: PHASE.MENU,
    phaseT: 0,          // seconds spent in the current phase
    round: 1,
    scoreBlue: 0,
    scoreRed: 0,
    money: RULES.startMoney,
    timer: RULES.roundTime,
    captureBlue: 0,     // 0..100, capture progress per team
    captureRed: 0,
    zoneHolder: null,   // 'blue' | 'red' | 'contest' | null
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    roundWinner: null,  // 'blue' | 'red' | 'draw'
    matchWinner: null,
    paused: false,
    muted: false,
    seed: 1,
  };
}

// Apply a round result to the score and the player's wallet. Returns the
// winner string so the HUD and the bots agree on what happened.
export function applyRoundResult(s, winner) {
  s.roundWinner = winner;
  if (winner === 'blue') {
    s.scoreBlue += 1;
    s.money += RULES.winBonus;
  } else if (winner === 'red') {
    s.scoreRed += 1;
    s.money += RULES.lossBonus;
  }
  if (s.scoreBlue >= RULES.winRounds || s.scoreRed >= RULES.winRounds || s.round >= RULES.maxRounds) {
    s.matchWinner = s.scoreBlue > s.scoreRed ? 'blue' : s.scoreRed > s.scoreBlue ? 'red' : 'draw';
  }
  return winner;
}

export function resetRound(s) {
  s.round += 1;
  s.timer = RULES.roundTime;
  s.captureBlue = 0;
  s.captureRed = 0;
  s.zoneHolder = null;
  s.roundWinner = null;
  s.phase = PHASE.BUY;
  s.phaseT = 0;
}
