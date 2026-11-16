// palette.js — the single source of truth for DUSTLINE ARENA's look.
// One dusk-desert palette: sand, rusted steel, amber accent, blue vs red teams.
// Materials are built once here and shared by the world and the bots so the
// scene reads at a glance and no module invents its own colours.
import * as THREE from 'three';

export const PALETTE = {
  sky: 0x2b2f3a,
  fog: 0x2b2f3a,
  sand: 0xb98d5e,
  sandDark: 0x8a6a45,
  steel: 0x4a525c,
  steelDark: 0x2e343c,
  concrete: 0x6e6a63,
  crate: 0x7a5c38,
  crateTop: 0x9c7a4a,
  accent: 0xf0a830,
  zone: 0x37d67a,
  teamBlue: 0x3fa7ff,
  teamRed: 0xff5a3c,
  muzzle: 0xffd27a,
  tracer: 0xffe9b0,
  ink: 0xe9e6df,
  muted: 0x98a0a8,
};

// Lazily built shared materials. MeshStandardMaterial with flat colours keeps
// the render cheap and the look deliberately stylised.
const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + '|' + (opts.roughness ?? 0.9) + '|' + (opts.metalness ?? 0) + '|' + (opts.emissive ?? 0);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}

export function glowMat(color, intensity = 1.6) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
}

// A canvas texture for the floor: sand with a faint grid and speckles, drawn
// once at load. No external image files are used anywhere in the game.
export function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#b98d5e';
  g.fillRect(0, 0, 512, 512);
  // Speckles.
  for (let i = 0; i < 2600; i++) {
    const x = (Math.random() * 512) | 0;
    const y = (Math.random() * 512) | 0;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    g.fillRect(x, y, 2, 2);
  }
  // Grid lines every 64 px (4 world units when repeated).
  g.strokeStyle = 'rgba(60,40,20,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
