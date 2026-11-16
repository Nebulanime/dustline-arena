// world.js — DUSTLINE ARENA: an original desert-industrial map with three lanes.
// Builds the scene, owns every collider, and answers the two geometric questions
// the whole simulation needs: "can a circle move here?" and "does this ray hit
// anything before that point?". All colliders are axis-aligned boxes.

import * as THREE from 'three';
import { PALETTE, mat, floorTexture } from './palette.js';

export const MAP = { halfX: 32, halfZ: 22, wallH: 4.5 };

// Crates and walls: [cx, cz, w, d, h]. The map is symmetric so both teams play
// the same lanes; the capture zone sits in the middle of it all.
const CRATES = [
  // Cover ring around the central zone.
  [-6, -4, 2, 2, 1.2], [-6, 4, 2, 2, 1.2], [6, -4, 2, 2, 1.2], [6, 4, 2, 2, 1.2],
  // Low walls that break the mid sightline.
  [-4, -9, 5, 1, 2.4], [4, 9, 5, 1, 2.4],
  // Tall pillars on the mid flanks.
  [-12, 0, 1.5, 1.5, 4], [12, 0, 1.5, 1.5, 4],
  // North lane.
  [-18, -14, 3, 1.5, 1.2], [-8, -16, 2, 2, 1.2], [8, -14, 3, 1.5, 2.4], [18, -16, 2, 2, 1.2],
  // South lane.
  [-18, 14, 3, 1.5, 1.2], [-8, 16, 2, 2, 1.2], [8, 14, 3, 1.5, 2.4], [18, 16, 2, 2, 1.2],
  // Spawn cover, both ends.
  [-24, -6, 1, 4, 2.4], [-24, 6, 1, 4, 2.4], [24, -6, 1, 4, 2.4], [24, 6, 1, 4, 2.4],
  // Long low walls on the far lanes.
  [0, -19, 10, 1, 1.2], [0, 19, 10, 1, 1.2],
];

// Bot routes: lane waypoints the AI patrols between.
const WAYPOINTS = [
  [-28, 0], [-20, -14], [-12, -14], [-4, -10], [-2, -5], [2, -5], [4, -10], [12, -14], [20, -14], [28, 0],
  [-20, 14], [-12, 14], [-4, 10], [4, 10], [12, 14], [20, 14],
  [-8, 0], [8, 0], [0, -7], [0, 7], [-16, 0], [16, 0],
];

export const SPAWNS = {
  blue: [[-28, -6], [-28, 0], [-28, 6]],
  red: [[28, -6], [28, 0], [28, 6], [26, -2]],
};

export function createWorld(scene) {
  const colliders = []; // {x0,z0,x1,z1,y0,y1}
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  // Floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfX * 2 + 4, MAP.halfZ * 2 + 4),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Outer walls.
  const wallMat = mat(PALETTE.steelDark, { roughness: 0.85 });
  const wallDefs = [
    [0, -MAP.halfZ - 0.5, MAP.halfX * 2 + 2, 1],
    [0, MAP.halfZ + 0.5, MAP.halfX * 2 + 2, 1],
    [-MAP.halfX - 0.5, 0, 1, MAP.halfZ * 2 + 2],
    [MAP.halfX + 0.5, 0, 1, MAP.halfZ * 2 + 2],
  ];
  for (const [x, z, w, d] of wallDefs) {
    const m = new THREE.Mesh(boxGeo, wallMat);
    m.scale.set(w, MAP.wallH, d);
    m.position.set(x, MAP.wallH / 2, z);
    scene.add(m);
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, y0: 0, y1: MAP.wallH });
  }

  // Crates with a little colour variation so the map reads at a glance.
  const crateMats = [mat(PALETTE.crate), mat(PALETTE.crateTop), mat(PALETTE.concrete), mat(PALETTE.steel)];
  for (let i = 0; i < CRATES.length; i++) {
    const [x, z, w, d, h] = CRATES[i];
    const m = new THREE.Mesh(boxGeo, crateMats[i % crateMats.length]);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    scene.add(m);
    // A thin amber edge on the taller cover so lanes read in the dark.
    if (h >= 2.4) {
      const cap = new THREE.Mesh(boxGeo, mat(PALETTE.accent, { roughness: 0.6 }));
      cap.scale.set(w + 0.06, 0.08, d + 0.06);
      cap.position.set(x, h - 0.04, z);
      scene.add(cap);
    }
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, y0: 0, y1: h });
  }

  // Capture zone: glowing ring, four posts, a floating beacon.
  const zone = { x: 0, z: 0, r: 3.5 };
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(zone.r - 0.35, zone.r, 48),
    new THREE.MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.03, 0);
  scene.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(zone.r, 48),
    new THREE.MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 0.02, 0);
  scene.add(disc);
  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.9 }),
  );
  beacon.position.set(0, 3.2, 0);
  scene.add(beacon);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 6, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.set(0, 3, 0);
  scene.add(beam);

  // Lighting: warm dusk sun + cool sky fill, plus fog for depth.
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.5);
  sun.position.set(18, 26, 10);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x5e4630, 1.15));
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 110);

  // --- Collision: move a circle (x,z) with radius r by (dx,dz), axis by axis.
  function circleHits(x, z, r) {
    for (const c of colliders) {
      const nx = Math.max(c.x0, Math.min(x, c.x1));
      const nz = Math.max(c.z0, Math.min(z, c.z1));
      const ddx = x - nx, ddz = z - nz;
      if (ddx * ddx + ddz * ddz < r * r) return true;
    }
    return false;
  }

  function moveCircle(p, dx, dz, r) {
    const nx = p.x + dx;
    if (!circleHits(nx, p.z, r)) p.x = nx;
    const nz = p.z + dz;
    if (!circleHits(p.x, nz, r)) p.z = nz;
    // Clamp inside the arena no matter what.
    p.x = Math.max(-MAP.halfX + r, Math.min(MAP.halfX - r, p.x));
    p.z = Math.max(-MAP.halfZ + r, Math.min(MAP.halfZ - r, p.z));
  }

  // --- Ray vs world: slab test against every box + the floor plane.
  function rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = Infinity;
    let bestN = null;
    for (const c of colliders) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, c, maxDist);
      if (t >= 0 && t < best) {
        best = t;
        bestN = rayBoxNormal(ox, oy, oz, dx, dy, dz, c);
      }
    }
    // Floor plane y=0.
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t >= 0 && t < best && t <= maxDist) {
        const hx = ox + dx * t, hz = oz + dz * t;
        if (Math.abs(hx) <= MAP.halfX + 2 && Math.abs(hz) <= MAP.halfZ + 2) {
          best = t;
          bestN = { x: 0, y: 1, z: 0 };
        }
      }
    }
    if (best === Infinity) return null;
    return { t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, nx: bestN.x, ny: bestN.y, nz: bestN.z };
  }

  function rayBox(ox, oy, oz, dx, dy, dz, c, maxDist) {
    let tmin = 0, tmax = maxDist;
    const axes = [
      [ox, dx, c.x0, c.x1], [oy, dy, c.y0, c.y1], [oz, dz, c.z0, c.z1],
    ];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return -1;
      } else {
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
      }
    }
    return tmin;
  }

  function rayBoxNormal(ox, oy, oz, dx, dy, dz, c) {
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2, cz = (c.z0 + c.z1) / 2;
    const px = ox + dx * 0.001, py = oy + dy * 0.001, pz = oz + dz * 0.001;
    const ex = (c.x1 - c.x0) / 2 + 0.001, ey = (c.y1 - c.y0) / 2 + 0.001, ez = (c.z1 - c.z0) / 2 + 0.001;
    const rx = Math.abs(px - cx) / ex, ry = Math.abs(py - cy) / ey, rz = Math.abs(pz - cz) / ez;
    if (rx > ry && rx > rz) return { x: Math.sign(px - cx), y: 0, z: 0 };
    if (ry > rz) return { x: 0, y: Math.sign(py - cy), z: 0 };
    return { x: 0, y: 0, z: Math.sign(pz - cz) };
  }

  function blockedBetween(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return false;
    const hit = rayHit(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05);
    return hit !== null;
  }

  let t = 0;
  return {
    colliders, zone, waypoints: WAYPOINTS, spawns: SPAWNS,
    moveCircle, rayHit, blockedBetween,
    inZone(x, z) {
      const dx = x - zone.x, dz = z - zone.z;
      return dx * dx + dz * dz <= zone.r * zone.r;
    },
    update(dt) {
      t += dt;
      beacon.rotation.y += dt * 1.4;
      beacon.position.y = 3.2 + Math.sin(t * 1.8) * 0.25;
      ring.material.opacity = 0.6 + Math.sin(t * 2.2) * 0.2;
    },
  };
}
