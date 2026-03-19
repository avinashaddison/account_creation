const getCtx = (): AudioContext => {
  if (!(window as any).__audioCtx) {
    (window as any).__audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  const ctx = (window as any).__audioCtx as AudioContext;
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};

function masterGain(ctx: AudioContext, vol = 1.0): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.connect(ctx.destination);
  return g;
}

function osc(ctx: AudioContext, type: OscillatorType, freq: number, start: number, end: number, master: GainNode) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  o.connect(master);
  o.start(start);
  o.stop(end);
  return o;
}

function freqRamp(o: OscillatorNode, ctx: AudioContext, from: number, to: number, at: number, duration: number) {
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + duration);
}

function gainEnv(g: GainNode, ctx: AudioContext, vol: number, attack: number, decay: number, release: number, at = ctx.currentTime) {
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(vol * 0.3, at + attack + decay);
  g.gain.exponentialRampToValueAtTime(0.001, at + attack + decay + release);
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function playNoise(ctx: AudioContext, vol: number, attack: number, decay: number, at: number, dest: AudioNode) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(4000, at);
  filter.Q.setValueAtTime(0.5, at);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.001, at + attack + decay);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start(at);
  src.stop(at + attack + decay + 0.05);
}

export const sounds = {
  hover: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.05);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(2400, t);
      o.frequency.exponentialRampToValueAtTime(2800, t + 0.03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      o.connect(g); g.connect(m);
      o.start(t); o.stop(t + 0.05);
    } catch {}
  },

  click: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.18);
      playNoise(ctx, 0.6, 0.002, 0.04, t, m);
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(1600, t);
      o.frequency.exponentialRampToValueAtTime(400, t + 0.025);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      o.connect(g); g.connect(m);
      o.start(t); o.stop(t + 0.05);
    } catch {}
  },

  navigate: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.12);
      playNoise(ctx, 0.3, 0.002, 0.03, t, m);
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(1200, t);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.02);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      o.connect(g); g.connect(m);
      o.start(t); o.stop(t + 0.04);
    } catch {}
  },

  toggle: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.15);
      playNoise(ctx, 0.5, 0.001, 0.02, t, m);
      [0, 0.03].forEach((delay, i) => {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.setValueAtTime(i === 0 ? 1800 : 2200, t + delay);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, t + delay);
        g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.03);
        o.connect(g); g.connect(m);
        o.start(t + delay); o.stop(t + delay + 0.035);
      });
    } catch {}
  },

  success: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.22);
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(freq, t + i * 0.07);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.5, 0.01, 0.05, 0.15, t + i * 0.07);
        o.connect(g); g.connect(m);
        o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.3);
      });
    } catch {}
  },

  error: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.2);
      [0, 0.1, 0.2].forEach((delay, i) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        const startFreq = 400 - i * 80;
        o.frequency.setValueAtTime(startFreq, t + delay);
        o.frequency.exponentialRampToValueAtTime(startFreq * 0.4, t + delay + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, t + delay);
        g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.14);
        o.connect(g); g.connect(m);
        o.start(t + delay); o.stop(t + delay + 0.15);
      });
      playNoise(ctx, 0.3, 0.005, 0.25, t, m);
    } catch {}
  },

  warning: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.18);
      [0, 0.12].forEach((delay) => {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(880, t + delay);
        o.frequency.linearRampToValueAtTime(660, t + delay + 0.08);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.5, 0.005, 0.03, 0.07, t + delay);
        o.connect(g); g.connect(m);
        o.start(t + delay); o.stop(t + delay + 0.13);
      });
    } catch {}
  },

  notification: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.2);
      [0, 0.08].forEach((delay, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(i === 0 ? 1200 : 1600, t + delay);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.6, 0.005, 0.04, 0.12, t + delay);
        o.connect(g); g.connect(m);
        o.start(t + delay); o.stop(t + delay + 0.2);
      });
    } catch {}
  },

  start: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.18);
      const freqs = [220, 330, 440, 660, 880, 1320];
      freqs.forEach((freq, i) => {
        const o = ctx.createOscillator();
        o.type = i < 3 ? "square" : "sine";
        o.frequency.setValueAtTime(freq, t + i * 0.045);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.4, 0.005, 0.04, 0.1, t + i * 0.045);
        o.connect(g); g.connect(m);
        o.start(t + i * 0.045); o.stop(t + i * 0.045 + 0.2);
      });
    } catch {}
  },

  complete: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.22);
      const seq = [523, 659, 784, 1047, 1319, 1047, 784, 1047];
      seq.forEach((freq, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(freq, t + i * 0.08);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.45, 0.01, 0.06, 0.18, t + i * 0.08);
        o.connect(g); g.connect(m);
        o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.35);
      });
    } catch {}
  },

  deposit: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.22);
      playNoise(ctx, 0.3, 0.002, 0.08, t, m);
      [0, 0.05, 0.12].forEach((delay, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        const freq = [1800, 2200, 2600][i];
        o.frequency.setValueAtTime(freq, t + delay);
        o.frequency.exponentialRampToValueAtTime(freq * 1.1, t + delay + 0.05);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.5, 0.003, 0.04, 0.14, t + delay);
        o.connect(g); g.connect(m);
        o.start(t + delay); o.stop(t + delay + 0.22);
      });
    } catch {}
  },

  logout: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.18);
      const freqs = [880, 660, 440, 330, 220];
      freqs.forEach((freq, i) => {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(freq, t + i * 0.065);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.4, 0.005, 0.04, 0.12, t + i * 0.065);
        o.connect(g); g.connect(m);
        o.start(t + i * 0.065); o.stop(t + i * 0.065 + 0.22);
      });
    } catch {}
  },

  live: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.28);
      playNoise(ctx, 0.15, 0.003, 0.06, t, m);
      const chords = [
        { freq: 440, delay: 0 },
        { freq: 554, delay: 0.06 },
        { freq: 659, delay: 0.12 },
        { freq: 880, delay: 0.18 },
        { freq: 1108, delay: 0.22 },
      ];
      chords.forEach(({ freq, delay }) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(freq, t + delay);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.5, 0.005, 0.05, 0.2, t + delay);
        o.connect(g); g.connect(m);
        o.start(t + delay); o.stop(t + delay + 0.35);
      });
      const shimmer = ctx.createOscillator();
      shimmer.type = "sine";
      shimmer.frequency.setValueAtTime(1760, t + 0.25);
      shimmer.frequency.exponentialRampToValueAtTime(2640, t + 0.45);
      const sg = ctx.createGain();
      gainEnv(sg, ctx, 0.3, 0.01, 0.05, 0.18, t + 0.25);
      shimmer.connect(sg); sg.connect(m);
      shimmer.start(t + 0.25); shimmer.stop(t + 0.5);
    } catch {}
  },

  dead: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.18);
      playNoise(ctx, 0.4, 0.002, 0.05, t, m);
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(320, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g); g.connect(m);
      o.start(t); o.stop(t + 0.16);
    } catch {}
  },

  generate: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.15);
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(80, t);
      o.frequency.exponentialRampToValueAtTime(1200, t + 0.18);
      const g = ctx.createGain();
      gainEnv(g, ctx, 0.4, 0.01, 0.08, 0.12, t);
      o.connect(g); g.connect(m);
      o.start(t); o.stop(t + 0.25);
      playNoise(ctx, 0.2, 0.01, 0.15, t + 0.05, m);
    } catch {}
  },

  checkComplete: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.22);
      const seq = [659, 784, 988, 1319];
      seq.forEach((freq, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(freq, t + i * 0.07);
        const g = ctx.createGain();
        gainEnv(g, ctx, 0.45, 0.005, 0.05, 0.2, t + i * 0.07);
        o.connect(g); g.connect(m);
        o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.3);
      });
    } catch {}
  },

  keypress: () => {
    try {
      const ctx = getCtx();
      const t = ctx.currentTime;
      const m = masterGain(ctx, 0.09);
      playNoise(ctx, 0.7, 0.001, 0.02, t, m);
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(3200 + Math.random() * 400, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      o.connect(g); g.connect(m);
      o.start(t); o.stop(t + 0.03);
    } catch {}
  },
};
