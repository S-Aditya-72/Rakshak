// Tiny WebAudio synth so the demo needs no audio assets.

let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Phones only allow audio after a tap; call this from one (e.g. choosing a role) so later alerts can sound. */
export function unlockAudio() {
  try {
    tone(440, 0, 0.01, 'sine', 0.0001);
  } catch {
    /* no WebAudio */
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.07) {
  const c = audio();
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Level 2: soft two-note chime. */
export function playChime() {
  tone(880, 0, 0.5);
  tone(1318.5, 0.13, 0.8);
}

/** Level 3: urgent alternating critical tone. */
export function playCritical() {
  for (let i = 0; i < 4; i++) {
    tone(740, i * 0.36, 0.17, 'square', 0.035);
    tone(554, i * 0.36 + 0.18, 0.17, 'square', 0.035);
  }
}

/** Incoming message: short two-step ping. */
export function playPing() {
  tone(1046.5, 0, 0.12, 'sine', 0.05);
  tone(1568, 0.07, 0.2, 'sine', 0.04);
}

/** Sent message: quick rising whoosh. */
export function playSend() {
  const c = audio();
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(1300, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.035, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.22);
}

/** SOS: ringing, like an incoming call. */
export function playRing() {
  for (let i = 0; i < 3; i++) {
    tone(880, i * 0.9, 0.35, 'sine', 0.06);
    tone(1100, i * 0.9 + 0.05, 0.35, 'sine', 0.04);
  }
}
