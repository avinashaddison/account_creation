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
  click: () => playTone(1200, 0.05, "square", 0.04),

  hover: () => playTone(1800, 0.03, "sine", 0.02),

  success: () => {
    playChord([
      { freq: 800, delay: 0 },
      { freq: 1000, delay: 60 },
      { freq: 1200, delay: 120 },
      { freq: 1600, delay: 180 },
    ], 0.2, "sine", 0.08);
  },

  error: () => {
    playChord([
      { freq: 300, delay: 0 },
      { freq: 200, delay: 80 },
      { freq: 150, delay: 160 },
    ], 0.3, "sawtooth", 0.05);
  },

  warning: () => {
    playChord([
      { freq: 800, delay: 0 },
      { freq: 600, delay: 100 },
    ], 0.15, "triangle", 0.06);
  },

  navigate: () => playTone(900, 0.04, "square", 0.03),

  start: () => {
    playChord([
      { freq: 600, delay: 0 },
      { freq: 800, delay: 50 },
      { freq: 1000, delay: 100 },
      { freq: 1400, delay: 160 },
    ], 0.15, "square", 0.05);
  },

  complete: () => {
    playChord([
      { freq: 800, delay: 0 },
      { freq: 1000, delay: 80 },
      { freq: 1200, delay: 160 },
      { freq: 1600, delay: 240 },
      { freq: 2000, delay: 320 },
    ], 0.3, "sine", 0.08);
  },

  notification: () => {
    playChord([
      { freq: 1200, delay: 0 },
      { freq: 1500, delay: 60 },
    ], 0.1, "sine", 0.06);
  },

  toggle: () => playTone(1400, 0.04, "square", 0.03),

  deposit: () => {
    playChord([
      { freq: 900, delay: 0 },
      { freq: 1100, delay: 60 },
      { freq: 1400, delay: 120 },
      { freq: 1800, delay: 180 },
    ], 0.2, "sine", 0.07);
  },

  logout: () => {
    playChord([
      { freq: 1000, delay: 0 },
      { freq: 700, delay: 80 },
      { freq: 400, delay: 160 },
    ], 0.2, "triangle", 0.05);
  },
};
