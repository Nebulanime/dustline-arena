// main.js — bootstrap and the game loop. Input, phases, the fixed-step
// simulation, the capture objective, round/match flow, and the deterministic
// ?shot= scenes used for screenshots. Rendering is separate from simulation:
// the sim advances in fixed 1/60 s steps while the renderer draws every frame.

import * as THREE from 'three';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createState, PHASE, RULES, applyRoundResult, resetRound, rng } from './state.js';

const FIXED = 1 / 60;
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');           // 'start' | 'play' | 'end' | null
const seed = Number(params.get('seed') || 1);
const rand = rng(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2f3a);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 220);
scene.add(camera);

const state = createState();
state.seed = seed;
const world = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const player = createPlayer(world, scene, camera);
const bots = createBots(scene, world, state, audio, effects, player);
const arsenal = createArsenal(player, world, bots, effects, audio, state);
const hud = createHud(state, arsenal, player, bots, world);
bots.setKillHook((k, kt, v, vt, head) => hud.feed(k, kt, v, vt, head));

const input = { f: false, b: false, l: false, r: false, jump: false, crouch: false, sprint: false };
const speedRef = { value: 0 };
let firing = false;
let triggerQueued = false;
let now = 0;
let captureTickT = 0;
let frames = 0;
let shotTimer = 0;

// --- Input ---------------------------------------------------------------
const KEYMAP = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r', ShiftLeft: 'sprint', ShiftRight: 'sprint', ControlLeft: 'crouch', KeyC: 'crouch' };
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = KEYMAP[e.code];
  if (k) { input[k] = true; e.preventDefault(); }
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
  if (e.code === 'KeyR' && state.phase === PHASE.PLAY) arsenal.startReload();
  if (e.code === 'KeyG' && state.phase === PHASE.PLAY) arsenal.throwGrenade();
  if (e.code === 'KeyM') { state.muted = !state.muted; audio.setMuted(state.muted); }
  if (e.code === 'KeyB' && state.phase === PHASE.BUY) hud.showBuy(document.getElementById('buy-menu').hidden);
  if ((e.code === 'KeyP' || e.code === 'Escape') && (state.phase === PHASE.PLAY || state.phase === PHASE.BUY)) togglePause();
  if (state.phase === PHASE.BUY && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    const i = Number(e.code.slice(-1)) - 1;
    if (arsenal.buy(i)) hud.update(0, now);
  }
  if (state.phase === PHASE.BUY && e.code === 'Digit4') {
    if (arsenal.buyGrenade()) hud.update(0, now);
  }
  if (e.code === 'Enter' && state.phase === PHASE.MENU) startMatch();
  if (e.code === 'KeyR' && state.phase === PHASE.MATCH_END) startMatch();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) input[k] = false;
  if (e.code === 'Space') input.jump = false;
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (state.phase === PHASE.PLAY && !state.paused && document.pointerLockElement) {
    firing = true;
    triggerQueued = true;
  }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || shotMode) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * 0.0022));
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state.phase === PHASE.PLAY && !state.paused && !shotMode) {
    state.paused = true;
    hud.showOnly('pause');
  }
});
function lockPointer() {
  if (shotMode) return;
  renderer.domElement.requestPointerLock();
}
function togglePause() {
  state.paused = !state.paused;
  if (state.paused) {
    hud.showOnly('pause');
    document.exitPointerLock?.();
  } else {
    hud.showOnly(null);
    lockPointer();
  }
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Buttons.
document.getElementById('play').addEventListener('click', () => { audio.unlock(); startMatch(); });
document.getElementById('resume').addEventListener('click', () => togglePause());
document.getElementById('restart').addEventListener('click', () => { audio.unlock(); startMatch(); });
document.getElementById('ready').addEventListener('click', () => { if (state.phase === PHASE.BUY) startRound(); });
document.getElementById('buy-close').addEventListener('click', () => hud.showBuy(false));

// --- Match flow ----------------------------------------------------------
function startMatch() {
  Object.assign(state, createState());
  state.seed = seed;
  state.phase = PHASE.BUY;
  state.phaseT = 0;
  state.money = RULES.startMoney;
  arsenal.index = 0;
  arsenal.grenadeCount = 0;
  hud.showOnly(null);
  hud.showBuy(true);
  bots.spawnAll();
  player.reset(world.spawns.blue[1]);
  // No pointer lock here: the buy menu needs a free mouse. startRound locks it.
}

function startRound() {
  state.phase = PHASE.PLAY;
  state.phaseT = 0;
  state.timer = RULES.roundTime;
  state.captureBlue = 0;
  state.captureRed = 0;
  state.zoneHolder = null;
  hud.showBuy(false);
  hud.showOnly(null);
  bots.spawnAll();
  player.reset(world.spawns.blue[1]);
  arsenal.resetForRound();
  lockPointer();
}

function endRound(winner, reason) {
  if (state.phase !== PHASE.PLAY) return;
  applyRoundResult(state, winner);
  state.phase = PHASE.ROUND_END;
  state.phaseT = 0;
  if (winner === 'blue') audio.roundWin();
  else if (winner === 'red') audio.roundLose();
  document.getElementById('round-title').textContent =
    winner === 'blue' ? 'ROUND WON' : winner === 'red' ? 'ROUND LOST' : 'ROUND DRAW';
  document.getElementById('round-sub').textContent = reason + '  ·  ' + state.scoreBlue + ' — ' + state.scoreRed;
  hud.showOnly('round');
  document.exitPointerLock?.();
}

function endMatch() {
  state.phase = PHASE.MATCH_END;
  const acc = state.shotsFired > 0 ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0;
  hud.setMatch(
    state.matchWinner === 'blue' ? 'VICTORY' : state.matchWinner === 'red' ? 'DEFEAT' : 'DRAW',
    state.scoreBlue + ' — ' + state.scoreRed,
    `Eliminations ${state.kills} · Deaths ${state.deaths} · Accuracy ${acc}% · Rounds ${state.round}`,
  );
  hud.showOnly('match');
  document.exitPointerLock?.();
}

// --- Grenade splash --------------------------------------------------------
function onGrenadeExplode(g) {
  const R = GRENADE.radius;
  for (const b of bots.list) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - g.pos.x, (b.pos.y + 1) - g.pos.y, b.pos.z - g.pos.z);
    if (d < R) {
      const killed = bots.damageBot(b, GRENADE.damage * (1 - (d / R) * 0.7), false, player);
      if (killed && b.team === 'red') { state.kills += 1; state.money += 300; }
    }
  }
  if (player.alive) {
    const d = Math.hypot(player.pos.x - g.pos.x, (player.pos.y + 1) - g.pos.y, player.pos.z - g.pos.z);
    if (d < R) {
      const died = player.damage(GRENADE.damage * (1 - (d / R) * 0.7) * 0.5);
      if (died) { state.deaths += 1; hud.damageFlash(); }
    }
  }
  if (player.alive && Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z) < R + 4) {
    player.addRecoil(0.05);
  }
}

// --- Fixed-step simulation -------------------------------------------------
function captureStep(dt) {
  const blueIn = (player.alive && world.inZone(player.pos.x, player.pos.z) ? 1 : 0) + bots.inZoneCount('blue');
  const redIn = bots.inZoneCount('red');
  if (blueIn > 0 && redIn === 0) {
    state.zoneHolder = 'blue';
    state.captureBlue = Math.min(100, state.captureBlue + RULES.captureRate * dt);
    captureTickT -= dt;
    if (captureTickT <= 0) { audio.captureTick(); captureTickT = 1; }
    if (state.captureBlue >= 100) {
      state.money += RULES.captureBonus;
      endRound('blue', 'SECTOR C SECURED');
    }
  } else if (redIn > 0 && blueIn === 0) {
    state.zoneHolder = 'red';
    state.captureRed = Math.min(100, state.captureRed + RULES.captureRate * dt);
    if (state.captureRed >= 100) endRound('red', 'SECTOR C LOST');
  } else if (blueIn > 0 && redIn > 0) {
    state.zoneHolder = 'contest';
  } else {
    state.zoneHolder = null;
  }
}

function step(dt) {
  now += dt;
  state.phaseT += dt;
  world.update(dt);
  effects.step(dt);

  if (state.phase === PHASE.BUY) {
    if (state.phaseT >= RULES.buyTime) startRound();
    return;
  }
  if (state.phase === PHASE.ROUND_END) {
    if (state.phaseT >= 3.5) {
      if (state.matchWinner) endMatch();
      else { resetRound(state); bots.spawnAll(); player.reset(world.spawns.blue[1]); arsenal.resetForRound(); hud.showBuy(true); }
    }
    return;
  }
  if (state.phase !== PHASE.PLAY || state.paused) return;

  state.timer -= dt;
  player.step(dt, input, speedRef);
  arsenal.step(dt);
  arsenal.stepGrenades(dt, onGrenadeExplode);
  bots.step(dt, now, () => hud.damageFlash());

  // Firing: full-auto holds, semi-auto fires once per click.
  const def = arsenal.def();
  if (player.alive && (def.auto ? firing : triggerQueued)) {
    const res = arsenal.shoot(now, speedRef.value);
    triggerQueued = false;
    if (res && res.hit) hud.hitmarker(res.head);
  }

  captureStep(dt);

  // Round end conditions.
  if (bots.aliveCount('red') === 0) endRound('blue', 'ENEMY TEAM ELIMINATED');
  else if (!player.alive && bots.aliveCount('blue') === 0) endRound('red', 'YOUR TEAM ELIMINATED');
  else if (state.timer <= 0) {
    const b = (player.alive ? 1 : 0) + bots.aliveCount('blue');
    const r = bots.aliveCount('red');
    if (b > r) endRound('blue', 'TIME — MORE OPERATIVES STANDING');
    else if (r > b) endRound('red', 'TIME — OUTNUMBERED');
    else endRound('draw', 'TIME — STALEMATE');
  }

  // In shot mode the player fires on their own so the frame shows gunfire.
  if (shotMode === 'play') {
    shotTimer -= dt;
    if (shotTimer <= 0) {
      shotTimer = 0.45;
      aimAtNearestRed();
      const res = arsenal.shoot(now, 0);
      if (res && res.hit) hud.hitmarker(res.head);
    }
  }
}

function aimAtNearestRed() {
  let best = null, bestD = Infinity;
  for (const b of bots.list) {
    if (b.team !== 'red' || !b.alive) continue;
    const d = (b.pos.x - player.pos.x) ** 2 + (b.pos.z - player.pos.z) ** 2;
    if (d < bestD) { bestD = d; best = b; }
  }
  if (!best) return;
  const dx = best.pos.x - player.pos.x, dz = best.pos.z - player.pos.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = 0.02;
}

// --- Rendering ---------------------------------------------------------------
const _look = new THREE.Vector3();
function render() {
  if (state.phase === PHASE.MENU || state.phase === PHASE.MATCH_END) {
    // Slow cinematic orbit over the arena behind the overlay.
    const a = now * 0.07;
    camera.position.set(Math.sin(a) * 26, 13, Math.cos(a) * 26);
    camera.lookAt(0, 0.5, 0);
  } else if (!player.alive && state.phase === PHASE.PLAY) {
    // Spectate the first living teammate.
    const mate = bots.list.find((b) => b.team === 'blue' && b.alive);
    if (mate) {
      const bx = -Math.sin(mate.yaw), bz = -Math.cos(mate.yaw);
      camera.position.set(mate.pos.x - bx * 3.2, mate.pos.y + 2.4, mate.pos.z - bz * 3.2);
      _look.set(mate.pos.x + bx * 6, mate.pos.y + 1.2, mate.pos.z + bz * 6);
      camera.lookAt(_look);
    }
  }
  renderer.render(scene, camera);
}

// --- Shot modes --------------------------------------------------------------
function setupShotMode() {
  if (!shotMode) return;
  if (shotMode === 'start') {
    bots.spawnAll();
    player.reset(world.spawns.blue[1]);
    hud.showOnly('start');
  } else if (shotMode === 'play') {
    Object.assign(state, createState());
    state.seed = seed;
    state.phase = PHASE.PLAY;
    state.money = 5000;
    arsenal.index = 2; // rifle
    arsenal.mag = WEAPONS[2].mag;
    arsenal.reserve = WEAPONS[2].reserve;
    arsenal.grenadeCount = 1;
    bots.spawnAll();
    player.reset([-6, 0, 0]);
    player.yaw = -Math.PI / 2;
    // Staged screenshot: the player cannot die while the frame is composed.
    player.invulnerable = true;
    const reds = bots.list.filter((b) => b.team === 'red');
    reds[0].pos.set(3, 0, 1.5);
    reds[1].pos.set(6, 0, -2.5);
    // They face the player and strafe, but every red's reaction is staged long
    // so none can kill the player before the screenshot is taken.
    for (const r of reds) r.reaction = 30;
    reds[0].mode = 'engage';
    reds[1].mode = 'engage';
    // Teammates hold the spawn so the frame stays about the mid fight.
    const blues = bots.list.filter((b) => b.team === 'blue');
    blues[0].pos.set(-24, 0, -8); blues[0].mode = 'cover'; blues[0].coverT = 30; blues[0].wp = 0;
    blues[1].pos.set(-24, 0, 8); blues[1].mode = 'cover'; blues[1].coverT = 30; blues[1].wp = 0;
    state.captureBlue = 55;
    hud.showOnly(null);
    hud.showBuy(false);
  } else if (shotMode === 'end') {
    Object.assign(state, createState());
    state.scoreBlue = 5;
    state.scoreRed = 2;
    state.round = 7;
    state.matchWinner = 'blue';
    state.kills = 11;
    state.deaths = 3;
    state.shotsFired = 120;
    state.shotsHit = 61;
    bots.spawnAll();
    endMatch();
  }
}

// --- Main loop ---------------------------------------------------------------
let last = performance.now();
let acc = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dtMs = Math.min(100, t - last);
  last = t;
  if (!state.paused) {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= FIXED && n < 5) {
      step(FIXED);
      acc -= FIXED;
      n += 1;
    }
    if (n === 5) acc = 0;
  }
  hud.update(dtMs / 1000, now);
  render();
  frames += 1;
  if (shotMode && frames === 50) window.__shotReady = true;
}

setupShotMode();
if (!shotMode) {
  // Normal play: menu overlay, everyone at their spawns. Shot modes stage
  // their own scene above, so they must not be reset here.
  hud.showOnly('start');
  bots.spawnAll();
  player.reset(world.spawns.blue[1]);
}
// Debug/testing handle: the playtest reads live state through this.
window.__game = { state, player, bots, arsenal, world };
requestAnimationFrame(loop);
