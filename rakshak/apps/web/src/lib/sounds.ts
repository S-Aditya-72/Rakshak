// Tiny WebAudio synth so the demo needs no audio assets.

let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
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
