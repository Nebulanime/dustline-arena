// effects.js — pooled visual feedback: tracers, muzzle flash, impact sparks and
// explosions. Everything is preallocated at load; the hot path never creates a
// mesh, a geometry or a material while the game runs.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_BURSTS = 6;
const BURST_PARTICLES = 12;

export function createEffects(scene) {
  // --- Tracers: 24 reusable lines.
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({
    color: PALETTE.tracer, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  // --- Muzzle flash: one light + one sprite quad, reused for every shot.
  const flashLight = new THREE.PointLight(PALETTE.muzzle, 0, 9, 2);
  scene.add(flashLight);
  const flashSprite = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ color: PALETTE.muzzle, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flashSprite.visible = false;
  scene.add(flashSprite);
  let flashLife = 0;

  // --- Sparks: 6 bursts of 12 points, one shared Points object. The points
  // use a soft radial sprite so they read as embers, not squares.
  const sparkCount = MAX_BURSTS * BURST_PARTICLES;
  const sparkPos = new Float32Array(sparkCount * 3);
  const sparkVel = new Float32Array(sparkCount * 3);
  const sparkLife = new Float32Array(MAX_BURSTS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = 32; dotCanvas.height = 32;
  const dg = dotCanvas.getContext('2d');
  const grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = grad;
  dg.fillRect(0, 0, 32, 32);
  const dotTex = new THREE.CanvasTexture(dotCanvas);
  const sparkPoints = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffc46b, size: 0.07, map: dotTex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, alphaTest: 0.01,
  }));
  sparkPoints.visible = false;
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);
  let burstIdx = 0;

  // --- Explosion: one expanding shell + one light, reused.
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff8a2a, 0, 16, 1.6);
  scene.add(boomLight);
  let boomLife = 0;

  const _m = new THREE.Vector3();

  function tracer(from, to) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % MAX_TRACERS;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.9;
    t.life = 0.09;
  }

  function muzzleFlash(at) {
    flashLight.position.copy(at);
    flashLight.intensity = 14;
    flashSprite.position.copy(at);
    flashSprite.visible = true;
    flashSprite.material.opacity = 0.95;
    flashSprite.lookAt(at.x, at.y, at.z);
    flashLife = 0.06;
  }

  function muzzleWorldPos(player) {
    player.eyePos(_m);
    player.lookDir(_m2);
    _m.addScaledVector(_m2, 0.9);
    _m.y -= 0.18;
    return { x: _m.x, y: _m.y, z: _m.z };
  }
  const _m2 = new THREE.Vector3();

  function sparks(x, y, z, nx, ny, nz) {
    const base = burstIdx * BURST_PARTICLES;
    burstIdx = (burstIdx + 1) % MAX_BURSTS;
    for (let i = 0; i < BURST_PARTICLES; i++) {
      const k = (base + i) * 3;
      sparkPos[k] = x; sparkPos[k + 1] = y; sparkPos[k + 2] = z;
      const rx = (Math.random() - 0.5) * 3 + nx * 2;
      const ry = (Math.random() - 0.5) * 3 + ny * 2 + 1.2;
      const rz = (Math.random() - 0.5) * 3 + nz * 2;
      sparkVel[k] = rx; sparkVel[k + 1] = ry; sparkVel[k + 2] = rz;
    }
    sparkLife[burstIdx === 0 ? MAX_BURSTS - 1 : burstIdx - 1] = 0.35;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkPoints.visible = true;
  }

  function explosion(pos) {
    boom.position.copy(pos);
    boom.visible = true;
    boomLife = 0.5;
    boomLight.position.copy(pos);
    boomLight.intensity = 60;
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    if (flashLife > 0) {
      flashLife -= dt;
      flashLight.intensity = Math.max(0, flashLife / 0.06) * 14;
      flashSprite.material.opacity = Math.max(0, flashLife / 0.06) * 0.95;
      if (flashLife <= 0) { flashSprite.visible = false; flashLight.intensity = 0; }
    }
    let anySpark = false;
    for (let b = 0; b < MAX_BURSTS; b++) {
      if (sparkLife[b] > 0) {
        sparkLife[b] -= dt;
        anySpark = true;
        for (let i = 0; i < BURST_PARTICLES; i++) {
          const k = (b * BURST_PARTICLES + i) * 3;
          sparkVel[k + 1] -= 9 * dt;
          sparkPos[k] += sparkVel[k] * dt;
          sparkPos[k + 1] += sparkVel[k + 1] * dt;
          sparkPos[k + 2] += sparkVel[k + 2] * dt;
          if (sparkPos[k + 1] < 0.02) { sparkPos[k + 1] = 0.02; sparkVel[k + 1] *= -0.3; }
        }
      }
    }
    if (anySpark) sparkGeo.attributes.position.needsUpdate = true;
    else sparkPoints.visible = false;
    if (boomLife > 0) {
      boomLife -= dt;
      const f = Math.max(0, boomLife / 0.5);
      const s = (1 - f) * 6 + 0.5;
      boom.scale.set(s, s, s);
      boom.material.opacity = f * 0.55;
      boomLight.intensity = f * 60;
      if (boomLife <= 0) { boom.visible = false; boomLight.intensity = 0; }
    }
  }

  return { scene, tracer, muzzleFlash, muzzleWorldPos, sparks, explosion, step };
}
