// bots.js — the AI. Six bots, two teams, one simple brain: patrol the lanes,
// engage what they can see, take cover when hurt, and push the zone when the
// round asks for it. They shoot with the same hitscan routine as the player,
// in bursts, with a reaction delay — so fights feel fair, not instant.

import * as THREE from 'three';
import { PALETTE, mat } from './palette.js';
import { hitscan, damageFalloff, raySphere } from './weapons.js';

const BOT_DEFS = [
  { name: 'VEX', team: 'blue' },
  { name: 'NOVA', team: 'blue' },
  { name: 'RAZOR', team: 'red' },
  { name: 'GHOST', team: 'red' },
  { name: 'HAVOC', team: 'red' },
  { name: 'WRAITH', team: 'red' },
];

const EYE_Y = 1.5;
const BOT_SPEED = 3.4;
const BOT_DAMAGE = 11;
const BOT_BURST = 4;
const BOT_INTERVAL = 0.13;
const BOT_SPREAD = 0.055;
const BOT_RANGE = 34;

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();

function buildMesh(team) {
  const g = new THREE.Group();
  const teamMat = mat(team === 'blue' ? PALETTE.teamBlue : PALETTE.teamRed, { roughness: 0.7 });
  const dark = mat(PALETTE.steelDark, { roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.34), teamMat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mat(0xd8c9a8, { roughness: 0.8 }));
  head.position.y = 1.55;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), mat(team === 'blue' ? 0x9fd8ff : 0xffb09a, { roughness: 0.4 }));
  visor.position.set(0, 1.58, 0.17);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), dark);
  gun.position.set(0.22, 1.05, -0.25);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.28), dark);
  legs.position.y = 0.28;
  g.add(body, head, visor, gun, legs);
  // Team ring on the floor so friend and foe read at a glance.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 24),
    new THREE.MeshBasicMaterial({ color: team === 'blue' ? PALETTE.teamBlue : PALETTE.teamRed, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  return g;
}

export function createBots(scene, world, state, audio, effects, player) {
  const list = BOT_DEFS.map((d, i) => {
    const mesh = buildMesh(d.team);
    scene.add(mesh);
    return {
      id: i, name: d.name, team: d.team,
      pos: new THREE.Vector3(), yaw: 0, hp: 100, alive: true,
      mode: 'patrol', wp: 0, idleT: 0, reaction: 0,
      burstLeft: 0, shotT: 0, pauseT: 0, coverT: 0,
      lastFiredAt: -10, lastSeen: null, strafeDir: 1, strafeT: 0,
      mesh,
    };
  });

  function spawnAll() {
    const used = { blue: 0, red: 0 };
    for (const b of list) {
      const sp = world.spawns[b.team][used[b.team] % world.spawns[b.team].length];
      used[b.team] += 1;
      b.pos.set(sp[0], 0, sp[1]);
      b.yaw = b.team === 'blue' ? -Math.PI / 2 : Math.PI / 2;
      b.hp = 100;
      b.alive = true;
      b.mode = 'patrol';
      b.wp = (Math.random() * world.waypoints.length) | 0;
      b.idleT = Math.random();
      b.burstLeft = 0;
      b.mesh.visible = true;
      b.mesh.rotation.set(0, b.yaw, 0);
      b.mesh.position.copy(b.pos);
    }
  }

  function enemiesOf(bot) {
    const out = [];
    if (bot.team === 'red') {
      if (player.alive) out.push({ pos: player.pos, isPlayer: true, hp: player.health });
      for (const o of list) if (o.team === 'blue' && o.alive) out.push({ pos: o.pos, isPlayer: false, bot: o, hp: o.hp });
    } else {
      for (const o of list) if (o.team === 'red' && o.alive) out.push({ pos: o.pos, isPlayer: false, bot: o, hp: o.hp });
    }
    return out;
  }

  // Can this bot see that enemy? Line of sight, range, and a 120-degree cone —
  // unless the enemy is very close, in which case hearing gives them away.
  function canSee(bot, enemy) {
    const ep = enemy.pos;
    const dx = ep.x - bot.pos.x, dz = ep.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > BOT_RANGE) return null;
    const facingX = -Math.sin(bot.yaw), facingZ = -Math.cos(bot.yaw);
    const dot = (dx * facingX + dz * facingZ) / Math.max(0.001, dist);
    if (dist > 6 && dot < 0.35) return null;
    _eye.set(bot.pos.x, bot.pos.y + EYE_Y, bot.pos.z);
    _chest.set(ep.x, ep.y + 1.2, ep.z);
    if (world.blockedBetween(_eye.x, _eye.y, _eye.z, _chest.x, _chest.y, _chest.z)) return null;
    return { dist, enemy };
  }

  function nearestWaypoint(x, z) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < world.waypoints.length; i++) {
      const w = world.waypoints[i];
      const d = (w[0] - x) ** 2 + (w[1] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const vx = (dx / d) * speed, vz = (dz / d) * speed;
    world.moveCircle(bot.pos, vx * dt, vz * dt, 0.45);
    bot.yaw = Math.atan2(-vx, -vz);
    return d < 0.6;
  }

  function faceTarget(bot, tx, tz, dt) {
    const target = Math.atan2(-(tx - bot.pos.x), -(tz - bot.pos.z));
    let diff = target - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-dt * 6, Math.min(dt * 6, diff));
  }

  function botShoot(bot, target, now) {
    bot.lastFiredAt = now;
    _eye.set(bot.pos.x, bot.pos.y + 1.35, bot.pos.z);
    // Aim at the chest with a spread cone; crouched players are harder to hit.
    const aimY = target.isPlayer && player.crouching ? 1.15 : 1.2;
    const tp = target.pos;
    _dir.set(tp.x - _eye.x, aimY - _eye.y + 0.3, tp.z - _eye.z).normalize();
    _dir.x += (Math.random() - 0.5) * 2 * BOT_SPREAD;
    _dir.y += (Math.random() - 0.5) * 2 * BOT_SPREAD;
    _dir.z += (Math.random() - 0.5) * 2 * BOT_SPREAD;
    _dir.normalize();
    const hit = hitscan(world, list, _eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, BOT_RANGE + 10, bot.team);
    const muzzle = { x: _eye.x + _dir.x * 0.6, y: _eye.y - 0.1, z: _eye.z + _dir.z * 0.6 };
    effects.tracer(muzzle, hit);
    effects.muzzleFlash(muzzle);
    audio.shot('enemy');
    // The player is not in the bot list, so test them separately and take the
    // nearest of the two results. Only red bots can hurt the player.
    let pT = Infinity; let pHead = false;
    if (player.alive && bot.team === 'red') {
      const t1 = raySphere(_eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, player.pos.x, player.pos.y + 1.5, player.pos.z, 0.26, BOT_RANGE + 10);
      if (t1 >= 0) { pT = t1; pHead = true; }
      else {
        const t2 = raySphere(_eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, player.pos.x, player.pos.y + 1.15, player.pos.z, 0.42, BOT_RANGE + 10);
        if (t2 >= 0) pT = t2;
        else {
          const t3 = raySphere(_eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, player.pos.x, player.pos.y + 0.55, player.pos.z, 0.42, BOT_RANGE + 10);
          if (t3 >= 0) pT = t3;
        }
      }
    }
    if (pT < hit.dist) {
      const dmg = damageFalloff(BOT_DAMAGE, pT) * (pHead ? 2 : 1);
      const died = player.damage(dmg);
      audio.hurt();
      effects.sparks(_eye.x + _dir.x * pT, _eye.y + _dir.y * pT, _eye.z + _dir.z * pT, -_dir.x, -_dir.y, -_dir.z);
      if (died) {
        state.deaths += 1;
        if (killHook) killHook(bot.name, 'red', 'YOU', 'blue', pHead);
      }
      return;
    }
    if (hit.kind === 'bot') {
      const dmg = damageFalloff(BOT_DAMAGE, hit.dist) * (hit.head ? 2 : 1);
      const killed = damageBot(hit.bot, dmg, hit.head, bot);
      effects.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
      if (killed && hit.bot.team === 'red' && bot.team === 'blue') {
        // A teammate's kill still pays the player a little — teamwork matters.
        state.money += 150;
      }
    } else if (hit.kind === 'world') {
      effects.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
    }
  }

  function damageBot(bot, dmg, head, attacker) {
    if (!bot.alive) return false;
    bot.hp -= dmg;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.mesh.rotation.set(0, bot.yaw, Math.PI / 2); // fall over
      bot.mesh.position.y = 0.15;
      if (killHook) {
        const killer = attacker === player ? { name: 'YOU', team: 'blue' } : attacker;
        killHook(killer.name, killer.team, bot.name, bot.team, head);
      }
      return true;
    }
    // Getting shot makes a bot flinch toward cover when badly hurt.
    if (bot.hp < 35 && bot.mode !== 'engage') bot.mode = 'cover';
    return false;
  }

  function step(dt, now, onPlayerHit) {
    for (const bot of list) {
      if (!bot.alive) continue;
      // Pick the nearest visible enemy.
      let seen = null;
      for (const e of enemiesOf(bot)) {
        const s = canSee(bot, e);
        if (s && (!seen || s.dist < seen.dist)) seen = s;
      }
      if (seen) {
        bot.mode = 'engage';
        bot.lastSeen = { x: seen.enemy.pos.x, z: seen.enemy.pos.z };
        faceTarget(bot, seen.enemy.pos.x, seen.enemy.pos.z, dt);
        if (bot.reaction <= 0) {
          bot.reaction = 0.45 + Math.random() * 0.35;
          bot.burstLeft = 0;
          bot.pauseT = 0;
        } else {
          bot.reaction -= dt;
          if (bot.reaction <= 0 && bot.burstLeft <= 0) { bot.burstLeft = BOT_BURST; bot.shotT = 0; }
        }
        // Strafe while fighting so they are not standing targets.
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.7 + Math.random() * 0.9; }
        const sx = Math.cos(bot.yaw) * bot.strafeDir, sz = -Math.sin(bot.yaw) * bot.strafeDir;
        world.moveCircle(bot.pos, sx * 2.0 * dt, sz * 2.0 * dt, 0.45);
        if (bot.burstLeft > 0 && bot.reaction <= 0) {
          bot.shotT -= dt;
          if (bot.shotT <= 0) {
            bot.shotT = BOT_INTERVAL;
            bot.burstLeft -= 1;
            const before = bot.team === 'red' ? player.health : 0;
            botShoot(bot, seen.enemy, now);
            if (bot.team === 'red' && seen.enemy.isPlayer && player.health < before) onPlayerHit();
            if (bot.burstLeft <= 0) bot.pauseT = 0.6 + Math.random() * 0.6;
          }
        } else if (bot.pauseT > 0) {
          bot.pauseT -= dt;
          if (bot.pauseT <= 0) bot.burstLeft = BOT_BURST;
        }
      } else {
        bot.reaction = 0;
        if (bot.mode === 'cover') {
          bot.coverT -= dt;
          if (bot.coverT <= 0) bot.mode = 'patrol';
        } else if (world.inZone(bot.pos.x, bot.pos.z)) {
          bot.mode = 'capture'; // hold the zone
        } else if (bot.mode !== 'patrol') {
          bot.mode = 'patrol';
        }
        if (bot.mode === 'patrol') {
          // Half the time, patrol toward the zone instead of a random lane —
          // that is what makes the objective contested instead of ignored.
          const w = world.waypoints[bot.wp];
          const arrived = moveToward(bot, w[0], w[1], dt, BOT_SPEED);
          if (arrived) {
            bot.idleT -= dt;
            if (bot.idleT <= 0) {
              if (Math.random() < 0.45) {
                bot.wp = nearestWaypoint(0 + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
              } else {
                bot.wp = (Math.random() * world.waypoints.length) | 0;
              }
              bot.idleT = 0.8 + Math.random() * 1.6;
            }
          }
        } else if (bot.mode === 'cover') {
          // Duck behind the nearest crate: walk to its far side from the enemy.
          const w = world.waypoints[bot.wp];
          moveToward(bot, w[0], w[1], dt, BOT_SPEED);
        }
      }
      bot.mesh.position.copy(bot.pos);
      if (bot.alive) bot.mesh.rotation.y = bot.yaw;
    }
  }

  function aliveCount(team) {
    let n = 0;
    for (const b of list) if (b.team === team && b.alive) n += 1;
    return n;
  }

  function inZoneCount(team) {
    let n = 0;
    for (const b of list) if (b.team === team && b.alive && world.inZone(b.pos.x, b.pos.z)) n += 1;
    return n;
  }

  let killHook = null;

  return {
    list, spawnAll, step, damageBot, aliveCount, inZoneCount,
    setKillHook(fn) { killHook = fn; },
  };
}
