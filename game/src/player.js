// player.js — the first-person controller. Acceleration-based movement with
// friction, crouching, jumping, map collision, and a recoil-kicked camera.
// The viewmodel is a small procedural rifle built from boxes, attached to the
// camera so it bobs with movement and kicks back when firing.

import * as THREE from 'three';
import { PALETTE, mat } from './palette.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.45;
const ACCEL = 55;
const FRICTION = 9;
const SPEED_WALK = 6.0;
const SPEED_CROUCH = 3.1;
const SPEED_SPRINT = 7.6;
const GRAVITY = 22;
const JUMP_VEL = 7.6;

export function createPlayer(world, scene, camera) {
  const pos = new THREE.Vector3(-28, 0, 0);
  const vel = new THREE.Vector3();
  const viewmodel = buildViewmodel();
  camera.add(viewmodel);
  scene.add(camera); // camera must be in the scene for its children to render

  const p = {
    pos, vel,
    yaw: -Math.PI / 2,   // facing +x, down the mid lane from the blue spawn
    pitch: 0,
    onGround: true,
    crouching: false,
    health: 100,
    alive: true,
    eyeH: EYE_STAND,
    recoil: 0,           // pitch kick, decays back to zero
    bobT: 0,
    viewmodel,
  };

  function buildViewmodel() {
    const g = new THREE.Group();
    const dark = mat(PALETTE.steelDark, { roughness: 0.5, metalness: 0.4 });
    const grip = mat(PALETTE.steel, { roughness: 0.6, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
    body.position.set(0, -0.02, 0);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), grip);
    barrel.position.set(0, 0.01, -0.44);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), grip);
    mag.position.set(0, -0.12, -0.08);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), mat(PALETTE.accent, { roughness: 0.4 }));
    sight.position.set(0, 0.07, -0.1);
    g.add(body, barrel, mag, sight);
    g.scale.setScalar(0.82);
    g.position.set(0.3, -0.29, -0.6);
    return g;
  }

  function reset(spawn) {
    pos.set(spawn[0], 0, spawn[1]);
    vel.set(0, 0, 0);
    p.yaw = spawn[0] < 0 ? -Math.PI / 2 : Math.PI / 2;
    p.pitch = 0;
    p.health = 100;
    p.alive = true;
    p.recoil = 0;
    p.crouching = false;
    p.eyeH = EYE_STAND;
  }

  // input: {f,b,l,r,jump,crouch,sprint} booleans gathered by main.js.
  function step(dt, input, moving) {
    if (!p.alive) return;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    // Wish direction in world space (forward is -z rotated by yaw).
    let wx = 0, wz = 0;
    if (input.f) { wx += -sin; wz += -cos; }
    if (input.b) { wx += sin; wz += cos; }
    if (input.l) { wx += -cos; wz += sin; }
    if (input.r) { wx += cos; wz += -sin; }
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    p.crouching = input.crouch;
    const targetEye = p.crouching ? EYE_CROUCH : EYE_STAND;
    p.eyeH += (targetEye - p.eyeH) * Math.min(1, dt * 12);

    const maxSpeed = p.crouching ? SPEED_CROUCH : input.sprint ? SPEED_SPRINT : SPEED_WALK;
    vel.x += wx * ACCEL * dt;
    vel.z += wz * ACCEL * dt;
    // Friction when no input, and a speed cap that never lets the player
    // outrun the wish direction.
    const damp = wl > 0 ? 1 : Math.max(0, 1 - FRICTION * dt);
    vel.x *= damp;
    vel.z *= damp;
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > maxSpeed) { vel.x *= maxSpeed / sp; vel.z *= maxSpeed / sp; }

    if (input.jump && p.onGround && !p.crouching) {
      vel.y = JUMP_VEL;
      p.onGround = false;
    }
    vel.y -= GRAVITY * dt;
    world.moveCircle(pos, vel.x * dt, vel.z * dt, RADIUS);
    pos.y += vel.y * dt;
    if (pos.y <= 0) { pos.y = 0; vel.y = 0; p.onGround = true; }

    // Camera: eye height + recoil kick, decaying back.
    p.recoil = Math.max(0, p.recoil - dt * 0.09);
    camera.position.set(pos.x, pos.y + p.eyeH, pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch + p.recoil;
    camera.rotation.z = 0;

    // Viewmodel bob + recoil kickback.
    p.bobT += dt * (sp > 0.5 ? sp * 1.6 : 0);
    const bobA = p.crouching ? 0.004 : 0.009;
    viewmodel.position.set(
      0.3 + Math.sin(p.bobT) * bobA,
      -0.29 + Math.abs(Math.cos(p.bobT)) * bobA * 1.4,
      -0.6 + p.recoil * 1.2,
    );
    if (moving !== undefined) moving.value = sp;
  }

  function damage(amount) {
    if (!p.alive || p.invulnerable) return false;
    p.health -= amount;
    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      return true;
    }
    return false;
  }

  function addRecoil(amount) {
    p.recoil = Math.min(0.09, p.recoil + amount);
    p.pitch = Math.min(1.2, p.pitch + amount * 0.35);
  }

  function eyePos(out) {
    out.set(pos.x, pos.y + p.eyeH, pos.z);
    return out;
  }

  function lookDir(out) {
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    out.set(-sy * cp, sp, -cy * cp);
    return out;
  }

  // Return the live object itself (not a snapshot): the loop reads yaw, pitch,
  // health and alive from it every frame and writes yaw/pitch from the mouse.
  return Object.assign(p, { reset, step, damage, addRecoil, eyePos, lookDir });
}
