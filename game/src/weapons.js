// weapons.js — the arsenal: three buyable guns plus a frag grenade, and the one
// hitscan routine every shooter in the game uses. Spread, recoil and damage
// falloff reward stopping to aim; headshots pay double.

import * as THREE from 'three';

export const WEAPONS = [
  {
    id: 'pistol', name: 'P9 Sidearm', price: 0, kind: 'pistol',
    damage: 34, headMult: 2, interval: 0.18, mag: 12, reserve: 48,
    reload: 1.1, spread: 0.011, moveSpread: 0.028, recoil: 0.012, auto: false,
  },
  {
    id: 'smg', name: 'VK-9 Storm', price: 1200, kind: 'smg',
    damage: 22, headMult: 2, interval: 0.075, mag: 28, reserve: 112,
    reload: 1.6, spread: 0.03, moveSpread: 0.045, recoil: 0.008, auto: true,
  },
  {
    id: 'rifle', name: 'AR-77 Longshot', price: 2700, kind: 'rifle',
    damage: 38, headMult: 2, interval: 0.11, mag: 25, reserve: 75,
    reload: 2.0, spread: 0.015, moveSpread: 0.04, recoil: 0.014, auto: true,
  },
];

export const GRENADE = { price: 300, maxCarry: 2, fuse: 1.2, radius: 6, damage: 95 };

// Reused temporaries: the hot path never allocates.
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _toBot = new THREE.Vector3();

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t <= maxDist ? t : -1;
}

// One hitscan test against the world and every living bot. Bots are approximated
// by two body spheres and one head sphere; the nearest hit wins. Friendly fire
// is off: bots on the shooter's team are never hit.
export function hitscan(world, bots, ox, oy, oz, dx, dy, dz, maxDist, shooterTeam) {
  const wall = world.rayHit(ox, oy, oz, dx, dy, dz, maxDist);
  let bestT = wall ? wall.t : maxDist;
  let hitBot = null;
  let hitHead = false;
  for (const b of bots) {
    if (!b.alive || b.team === shooterTeam) continue;
    const bp = b.pos;
    let t = raySphere(ox, oy, oz, dx, dy, dz, bp.x, bp.y + 1.5, bp.z, 0.26, bestT);
    if (t >= 0) { bestT = t; hitBot = b; hitHead = true; continue; }
    t = raySphere(ox, oy, oz, dx, dy, dz, bp.x, bp.y + 1.15, bp.z, 0.42, bestT);
    if (t >= 0) { bestT = t; hitBot = b; hitHead = false; continue; }
    t = raySphere(ox, oy, oz, dx, dy, dz, bp.x, bp.y + 0.55, bp.z, 0.42, bestT);
    if (t >= 0) { bestT = t; hitBot = b; hitHead = false; }
  }
  if (hitBot) {
    return {
      kind: 'bot', bot: hitBot, head: hitHead, dist: bestT,
      x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT,
      nx: -dx, ny: -dy, nz: -dz,
    };
  }
  if (wall) {
    return { kind: 'world', dist: wall.t, x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz };
  }
  return { kind: 'none', dist: maxDist, x: ox + dx * maxDist, y: oy + dy * maxDist, z: oz + dz * maxDist, nx: 0, ny: 1, nz: 0 };
}

export function damageFalloff(damage, dist) {
  if (dist <= 25) return damage;
  const f = 1 - Math.min(0.3, (dist - 25) / 60);
  return damage * f;
}

export function createArsenal(player, world, bots, effects, audio, state) {
  const grenades = []; // {pos, vel, fuse, owner}
  const grenadeMeshes = [];
  const gGeo = new THREE.SphereGeometry(0.12, 10, 8);

  const a = {
    index: 0,
    mag: WEAPONS[0].mag,
    reserve: WEAPONS[0].reserve,
    reloading: 0,       // seconds left, 0 = not reloading
    lastShot: -10,
    grenadeCount: 0,
    bloom: 0,           // extra spread from sustained fire, decays
    grenades,
  };

  function def() { return WEAPONS[a.index]; }

  function spreadNow(speed) {
    const d = def();
    const moving = Math.min(1, speed / 6);
    let s = d.spread + d.moveSpread * moving + a.bloom;
    if (player.crouching) s *= 0.65;
    if (!player.onGround) s *= 1.6;
    return s;
  }

  function shoot(now, speed) {
    const d = def();
    if (a.reloading > 0 || now - a.lastShot < d.interval) return false;
    if (a.mag <= 0) { audio.dryFire(); a.lastShot = now; return false; }
    a.lastShot = now;
    a.mag -= 1;
    a.bloom = Math.min(0.05, a.bloom + d.recoil * 0.5);
    state.shotsFired += 1;
    player.addRecoil(d.recoil);

    // Random point in the spread cone around the look direction.
    player.lookDir(_dir);
    const s = spreadNow(speed);
    _dir.x += (Math.random() - 0.5) * 2 * s;
    _dir.y += (Math.random() - 0.5) * 2 * s;
    _dir.z += (Math.random() - 0.5) * 2 * s;
    _dir.normalize();
    player.eyePos(_origin);
    const hit = hitscan(world, bots.list, _origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, 120, 'blue');

    const muzzle = effects.muzzleWorldPos(player);
    effects.tracer(muzzle, hit);
    effects.muzzleFlash(muzzle);
    audio.shot(d.kind);

    if (hit.kind === 'bot') {
      const dmg = damageFalloff(d.damage, hit.dist) * (hit.head ? d.headMult : 1);
      state.shotsHit += 1;
      const killed = bots.damageBot(hit.bot, dmg, hit.head, player);
      effects.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
      audio.hit();
      if (killed) {
        audio.kill();
        state.kills += 1;
        state.money += 300;
      }
      return { hit: true, head: hit.head, killed };
    }
    if (hit.kind === 'world') effects.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
    return { hit: false };
  }

  function startReload() {
    const d = def();
    if (a.reloading > 0 || a.mag === d.mag || a.reserve <= 0) return;
    a.reloading = d.reload;
    audio.reload();
  }

  function throwGrenade() {
    if (a.grenadeCount <= 0 || a.reloading > 0) return false;
    a.grenadeCount -= 1;
    player.lookDir(_dir);
    player.eyePos(_origin);
    const pos = new THREE.Vector3(_origin.x, _origin.y - 0.1, _origin.z);
    const vel = new THREE.Vector3(_dir.x * 17 + player.vel.x * 0.5, _dir.y * 17 + 5.5, _dir.z * 17 + player.vel.z * 0.5);
    const mesh = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ color: 0x2e343c, roughness: 0.5, metalness: 0.6 }));
    mesh.position.copy(pos);
    effects.scene.add(mesh);
    grenadeMeshes.push(mesh);
    grenades.push({ pos, vel, fuse: GRENADE.fuse, owner: 'blue' });
    audio.throwPin();
    return true;
  }

  function stepGrenades(dt, onExplode) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 18 * dt;
      world.moveCircle(g.pos, g.vel.x * dt, g.vel.z * dt, 0.12);
      g.pos.y += g.vel.y * dt;
      if (g.pos.y < 0.12) { g.pos.y = 0.12; g.vel.y = Math.abs(g.vel.y) * 0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
      grenadeMeshes[i].position.copy(g.pos);
      if (g.fuse <= 0) {
        explode(g, onExplode);
        effects.scene.remove(grenadeMeshes[i]);
        grenadeMeshes[i].geometry.dispose();
        grenadeMeshes.splice(i, 1);
        grenades.splice(i, 1);
      }
    }
  }

  function explode(g, onExplode) {
    effects.explosion(g.pos);
    audio.explosion();
    if (onExplode) onExplode(g);
  }

  function step(dt) {
    a.bloom = Math.max(0, a.bloom - dt * 0.06);
    if (a.reloading > 0) {
      a.reloading -= dt;
      if (a.reloading <= 0) {
        a.reloading = 0;
        const d = def();
        const need = d.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    }
  }

  function resetForRound() {
    a.reloading = 0;
    a.bloom = 0;
    const d = def();
    a.mag = d.mag;
    a.reserve = d.reserve;
  }

  function buy(index) {
    const w = WEAPONS[index];
    if (!w || index === a.index) return false;
    if (state.money < w.price) return false;
    state.money -= w.price;
    a.index = index;
    a.mag = w.mag;
    a.reserve = w.reserve;
    a.reloading = 0;
    audio.buy();
    return true;
  }

  function buyGrenade() {
    if (a.grenadeCount >= GRENADE.maxCarry || state.money < GRENADE.price) return false;
    state.money -= GRENADE.price;
    a.grenadeCount += 1;
    audio.buy();
    return true;
  }

  // Return the live object itself (not a snapshot): the HUD reads mag, reserve
  // and grenade counts from it every frame.
  return Object.assign(a, {
    def, shoot, startReload, throwGrenade, stepGrenades, step, resetForRound, buy, buyGrenade,
    muzzleDir(_out) { player.lookDir(_out); return _out; },
  });
}
