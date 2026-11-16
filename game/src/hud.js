// hud.js — every DOM surface of the game: the crosshair, health and ammo
// readouts, money, round score and timer, the capture bar, the kill feed, the
// buy menu, the start/pause/round/match overlays, and a top-down minimap.
// It only renders state; main.js owns the buttons and the keys.

import { WEAPONS, GRENADE } from './weapons.js';
import { MAP } from './world.js';

function $(id) { return document.getElementById(id); }

export function createHud(state, arsenal, player, bots, world) {
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    hpNum: $('hp-num'),
    hpBar: $('hp-bar'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    grenades: $('grenades'),
    money: $('money'),
    scoreBlue: $('score-blue'),
    scoreRed: $('score-red'),
    roundNum: $('round-num'),
    timer: $('timer'),
    feed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    captureWrap: $('capture-wrap'),
    captureBlue: $('capture-blue'),
    captureRed: $('capture-red'),
    captureLabel: $('capture-label'),
    buyMenu: $('buy-menu'),
    buyMoney: $('buy-money'),
    buyList: $('buy-list'),
    start: $('overlay-start'),
    pause: $('overlay-pause'),
    round: $('overlay-round'),
    match: $('overlay-match'),
    matchTitle: $('match-title'),
    matchScore: $('match-score'),
    matchStats: $('match-stats'),
    vignette: $('vignette'),
    minimap: $('minimap'),
    weaponName: $('weapon-name'),
  };
  const mm = el.minimap.getContext('2d');
  const MM_W = el.minimap.width, MM_H = el.minimap.height;
  const mmScale = Math.min(MM_W / (MAP.halfX * 2), MM_H / (MAP.halfZ * 2));
  let mmT = 0;
  let hitT = 0;

  // --- Buy menu rows, built once from the weapon table.
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    const row = document.createElement('div');
    row.className = 'buy-row';
    row.id = 'buy-' + w.id;
    row.innerHTML = `<span class="buy-key">${i + 1}</span>
      <span class="buy-name">${w.name}</span>
      <span class="buy-stat">DMG ${w.damage} · ${w.mag} rnd · ${w.auto ? 'AUTO' : 'SEMI'}</span>
      <span class="buy-price">$${w.price}</span>`;
    el.buyList.appendChild(row);
  }
  const gRow = document.createElement('div');
  gRow.className = 'buy-row';
  gRow.id = 'buy-grenade';
  gRow.innerHTML = `<span class="buy-key">4</span>
    <span class="buy-name">Frag Grenade</span>
    <span class="buy-stat">Blast radius ${GRENADE.radius}m · max ${GRENADE.maxCarry}</span>
    <span class="buy-price">$${GRENADE.price}</span>`;
  el.buyList.appendChild(gRow);

  function fmtTime(s) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return m + ':' + String(ss).padStart(2, '0');
  }

  function update(dt, now) {
    const d = arsenal.def();
    el.ammoMag.textContent = arsenal.reloading > 0 ? '--' : String(arsenal.mag);
    el.ammoReserve.textContent = '/ ' + arsenal.reserve;
    el.grenades.textContent = '◉ ' + arsenal.grenadeCount;
    el.weaponName.textContent = d.name + (arsenal.reloading > 0 ? ' — RELOADING' : '');
    el.hpNum.textContent = String(Math.ceil(player.health));
    el.hpBar.style.width = Math.max(0, player.health) + '%';
    el.hpBar.classList.toggle('low', player.health <= 30);
    el.money.textContent = '$' + state.money;
    el.scoreBlue.textContent = String(state.scoreBlue);
    el.scoreRed.textContent = String(state.scoreRed);
    el.roundNum.textContent = 'ROUND ' + state.round;
    el.timer.textContent = fmtTime(Math.max(0, state.timer));
    el.timer.classList.toggle('low', state.timer <= 15);

    // Crosshair gap grows with spread: bloom + movement.
    const gap = 6 + arsenal.bloom * 500 + (player.crouching ? -2 : 0);
    el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');

    // Capture bar.
    const show = state.captureBlue > 0 || state.captureRed > 0 || state.zoneHolder;
    el.captureWrap.style.display = show ? 'block' : 'none';
    if (show) {
      el.captureBlue.style.width = state.captureBlue + '%';
      el.captureRed.style.width = state.captureRed + '%';
      el.captureLabel.textContent = state.zoneHolder === 'contest' ? 'SECTOR C — CONTESTED'
        : state.zoneHolder === 'blue' ? 'SECTOR C — CAPTURING…'
        : state.zoneHolder === 'red' ? 'SECTOR C — ENEMY CAPTURING!'
        : 'SECTOR C';
    }

    // Buy affordability.
    for (let i = 0; i < WEAPONS.length; i++) {
      const row = $('buy-' + WEAPONS[i].id);
      row.classList.toggle('owned', arsenal.index === i);
      row.classList.toggle('cant', state.money < WEAPONS[i].price && arsenal.index !== i);
    }
    $('buy-grenade').classList.toggle('cant', state.money < GRENADE.price || arsenal.grenadeCount >= GRENADE.maxCarry);
    el.buyMoney.textContent = '$' + state.money;

    if (hitT > 0) {
      hitT -= dt;
      if (hitT <= 0) el.hitmarker.classList.remove('on', 'head');
    }

    // Minimap at 10 Hz — cheap and enough for tactics.
    mmT -= dt;
    if (mmT <= 0) {
      mmT = 0.1;
      drawMinimap(now);
    }
  }

  function drawMinimap(now) {
    mm.clearRect(0, 0, MM_W, MM_H);
    mm.fillStyle = 'rgba(20,22,26,0.85)';
    mm.fillRect(0, 0, MM_W, MM_H);
    const ox = MM_W / 2, oz = MM_H / 2;
    const px = (x) => ox + x * mmScale;
    const pz = (z) => oz + z * mmScale;
    // Walls and crates.
    mm.fillStyle = '#6e6a63';
    for (const c of world.colliders) {
      mm.fillRect(px(c.x0), pz(c.z0), (c.x1 - c.x0) * mmScale, (c.z1 - c.z0) * mmScale);
    }
    // Capture zone.
    mm.strokeStyle = '#37d67a';
    mm.lineWidth = 1.5;
    mm.beginPath();
    mm.arc(px(world.zone.x), pz(world.zone.z), world.zone.r * mmScale, 0, Math.PI * 2);
    mm.stroke();
    // Bots: teammates always, enemies only when they fired recently.
    for (const b of bots.list) {
      if (!b.alive) continue;
      if (b.team === 'blue') {
        mm.fillStyle = '#3fa7ff';
        mm.beginPath(); mm.arc(px(b.pos.x), pz(b.pos.z), 3, 0, Math.PI * 2); mm.fill();
      } else if (now - b.lastFiredAt < 2.5) {
        mm.fillStyle = '#ff5a3c';
        mm.beginPath(); mm.arc(px(b.pos.x), pz(b.pos.z), 3, 0, Math.PI * 2); mm.fill();
      }
    }
    // Player arrow.
    if (player.alive) {
      mm.save();
      mm.translate(px(player.pos.x), pz(player.pos.z));
      mm.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI / 2);
      mm.fillStyle = '#ffffff';
      mm.beginPath();
      mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(-4.5, 5); mm.closePath();
      mm.fill();
      mm.restore();
    }
  }

  function hitmarker(head) {
    el.hitmarker.classList.add('on');
    el.hitmarker.classList.toggle('head', !!head);
    hitT = 0.14;
  }

  function damageFlash() {
    el.vignette.style.opacity = '0.85';
    setTimeout(() => { el.vignette.style.opacity = '0'; }, 130);
  }

  function feed(killer, kTeam, victim, vTeam, head) {
    const div = document.createElement('div');
    div.className = 'feed-line';
    div.innerHTML = `<b class="${kTeam}">${killer}</b> ${head ? '◎' : '×'} <b class="${vTeam}">${victim}</b>`;
    el.feed.prepend(div);
    while (el.feed.children.length > 5) el.feed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0'; }, 3800);
    setTimeout(() => { div.remove(); }, 4300);
  }

  function showOnly(which) {
    for (const k of ['start', 'pause', 'round', 'match']) {
      el[k].hidden = k !== which;
    }
    el.buyMenu.hidden = true;
  }

  function banner(title, sub, color) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.bannerTitle.style.color = color || '#e9e6df';
    el.banner.hidden = false;
    setTimeout(() => { el.banner.hidden = true; }, 2600);
  }

  return {
    el, update, hitmarker, damageFlash, feed, showOnly, banner,
    showBuy(show) { el.buyMenu.hidden = !show; },
    setMatch(title, score, stats) {
      el.matchTitle.textContent = title;
      el.matchScore.textContent = score;
      el.matchStats.textContent = stats;
    },
  };
}
