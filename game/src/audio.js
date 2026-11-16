// audio.js — every sound in the game is synthesised with WebAudio. No audio
// files are loaded, so the game makes zero network requests at runtime.
// One shared noise buffer, one master gain, short envelopes everywhere.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      ctx = null;
      return false;
    }
    return true;
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function noise(dur, filterType, freq, q, vol, when = 0) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function tone(freq0, freq1, dur, type, vol, when = 0) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t);
    if (freq1 !== freq0) o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // kind: 'pistol' | 'smg' | 'rifle' | 'enemy' — each weapon cracks differently.
  function shot(kind) {
    resume();
    if (kind === 'pistol') { noise(0.09, 'bandpass', 1800, 1.2, 0.5); tone(160, 55, 0.09, 'sine', 0.5); }
    else if (kind === 'smg') { noise(0.06, 'bandpass', 2400, 1.5, 0.38); tone(190, 70, 0.06, 'sine', 0.35); }
    else if (kind === 'rifle') { noise(0.12, 'bandpass', 1200, 1.0, 0.6); tone(130, 45, 0.12, 'sine', 0.6); }
    else { noise(0.08, 'bandpass', 1500, 1.0, 0.28); tone(150, 60, 0.08, 'sine', 0.25); }
  }

  return {
    unlock: resume,
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; },
    isMuted: () => muted,
    shot,
    dryFire() { resume(); tone(900, 700, 0.03, 'square', 0.12); },
    reload() { resume(); tone(500, 500, 0.03, 'square', 0.15); tone(700, 700, 0.03, 'square', 0.15, 0.18); tone(420, 420, 0.04, 'square', 0.18, 0.45); },
    hit() { resume(); tone(1400, 1400, 0.05, 'square', 0.22); },
    kill() { resume(); tone(880, 880, 0.07, 'sine', 0.3); tone(1318, 1318, 0.1, 'sine', 0.3, 0.07); },
    hurt() { resume(); noise(0.12, 'lowpass', 500, 1, 0.4); tone(110, 70, 0.12, 'sawtooth', 0.2); },
    explosion() { resume(); noise(0.7, 'lowpass', 900, 0.8, 0.9); tone(90, 28, 0.6, 'sine', 0.8); },
    throwPin() { resume(); tone(600, 900, 0.05, 'square', 0.15); },
    captureTick() { resume(); tone(1050, 1050, 0.06, 'sine', 0.2); },
    roundWin() { resume(); [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.3, i * 0.11)); },
    roundLose() { resume(); [392, 311, 233].forEach((f, i) => tone(f, f, 0.2, 'triangle', 0.28, i * 0.13)); },
    click() { resume(); tone(700, 700, 0.03, 'square', 0.12); },
    buy() { resume(); tone(660, 660, 0.06, 'sine', 0.25); tone(990, 990, 0.09, 'sine', 0.25, 0.06); },
  };
}
