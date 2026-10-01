// Little bits of feedback: synthesized sounds (Web Audio, no files), a phone buzz, and confetti.
// Muting is remembered per device.

let audio;
let muted = (() => { try { return localStorage.getItem('wordrace-muted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(value) {
  muted = value;
  try { localStorage.setItem('wordrace-muted', value ? '1' : '0'); } catch { /* private mode: just not remembered */ }
}

// [frequency Hz, start s, duration s, wave, volume]
const SOUNDS = {
  correct: [[660, 0, 0.12], [880, 0.1, 0.2]],
  wrong: [[196, 0, 0.18, 'square', 0.06], [165, 0.12, 0.2, 'square', 0.06]],
  pop: [[520, 0, 0.08, 'triangle'], [780, 0.06, 0.1, 'triangle']],
  tick: [[1200, 0, 0.04, 'square', 0.03]],
  start: [[392, 0, 0.1], [523, 0.1, 0.1], [659, 0.2, 0.18]],
  win: [[523, 0, 0.15], [659, 0.13, 0.15], [784, 0.26, 0.15], [1047, 0.39, 0.4]],
};

export function play(name) {
  if (muted || !SOUNDS[name]) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime;
    for (const [freq, start, dur, type = 'sine', vol = 0.12] of SOUNDS[name]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.02);
    }
  } catch { /* no audio available: stay silent */ }
}

export function buzz(pattern = 40) {
  if (muted) return;
  try { navigator.vibrate?.(pattern); } catch { /* not supported (iPhone, desktop) */ }
}

const CONFETTI_COLORS = ['#ffcb3d', '#ff5fa2', '#3ddc97', '#5b8cff', '#a855f7', '#ff9f1c'];

// A burst of CSS-animated pieces from the top of the screen; they clean themselves up.
export function confetti(count = 60) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3200);
}
