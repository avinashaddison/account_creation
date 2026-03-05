const audioCtx = () => {
  if (!(window as any).__audioCtx) {
    (window as any).__audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return (window as any).__audioCtx as AudioContext;
};

function playTone(freq: number, duration: number, type: OscillatorType = "sine", volume = 0.15) {
  try {
    const ctx = audioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

function playChord(notes: { freq: number; delay: number }[], duration: number, type: OscillatorType = "sine", volume = 0.1) {
  notes.forEach(({ freq, delay }) => {
    setTimeout(() => playTone(freq, duration, type, volume), delay);
  });
}

export const sounds = {
  click: () => playTone(800, 0.08, "square", 0.06),

  hover: () => playTone(1200, 0.04, "sine", 0.03),

  success: () => {
    playChord([
      { freq: 523, delay: 0 },
      { freq: 659, delay: 80 },
      { freq: 784, delay: 160 },
      { freq: 1047, delay: 240 },
    ], 0.3, "sine", 0.1);
  },

  error: () => {
    playChord([
      { freq: 400, delay: 0 },
      { freq: 300, delay: 100 },
      { freq: 200, delay: 200 },
    ], 0.25, "sawtooth", 0.06);
  },

  warning: () => {
    playChord([
      { freq: 600, delay: 0 },
      { freq: 450, delay: 120 },
    ], 0.2, "triangle", 0.08);
  },

  navigate: () => playTone(600, 0.06, "sine", 0.05),

  start: () => {
    playChord([
      { freq: 440, delay: 0 },
      { freq: 554, delay: 60 },
      { freq: 659, delay: 120 },
      { freq: 880, delay: 200 },
    ], 0.2, "square", 0.06);
  },

  complete: () => {
    playChord([
      { freq: 523, delay: 0 },
      { freq: 659, delay: 100 },
      { freq: 784, delay: 200 },
      { freq: 1047, delay: 300 },
      { freq: 1319, delay: 400 },
    ], 0.4, "sine", 0.12);
  },

  notification: () => {
    playChord([
      { freq: 880, delay: 0 },
      { freq: 1100, delay: 80 },
    ], 0.15, "sine", 0.08);
  },

  toggle: () => playTone(1000, 0.05, "square", 0.04),

  deposit: () => {
    playChord([
      { freq: 700, delay: 0 },
      { freq: 900, delay: 80 },
      { freq: 1100, delay: 160 },
      { freq: 1400, delay: 240 },
    ], 0.3, "sine", 0.1);
  },

  logout: () => {
    playChord([
      { freq: 800, delay: 0 },
      { freq: 600, delay: 100 },
      { freq: 400, delay: 200 },
    ], 0.2, "triangle", 0.06);
  },
};
