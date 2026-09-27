/**
 * Synthesized sounds (no audio files to download). Nothing plays until the
 * user turns sound on, and the AudioContext is only created on the first
 * sound after that, satisfying browser autoplay rules. Everything runs
 * through one master gain (the volume setting) and a soft room echo.
 */
export type SoundName = "click" | "chip" | "flip" | "pop" | "whoosh" | "tick" | "coin" | "chime" | "win" | "bigwin" | "lose";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let room: GainNode | null = null;
let volume = 0.7;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    master.connect(comp).connect(ctx.destination);
    // A short feedback delay: gives wins a bit of space without a reverb impulse file.
    room = ctx.createGain();
    room.gain.value = 0.18;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.11;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2800;
    room.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(master);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

function out(wet: boolean): AudioNode[] {
  return wet && room ? [master!, room] : [master!];
}

function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  duration: number,
  gain: number,
  type: OscillatorType,
  opts: { to?: number; wet?: boolean; attack?: number } = {},
) {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, start + duration);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + (opts.attack ?? 0.005));
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  for (const n of out(opts.wet ?? false)) amp.connect(n);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(ac: AudioContext, start: number, duration: number, gain: number, freq: number, q = 1, type: BiquadFilterType = "bandpass") {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ac.sampleRate) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(filter).connect(amp).connect(master!);
  src.start(start, Math.random() * 0.5, duration + 0.02);
}

const NOTES = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5, G6: 1568 };

export function playSound(name: SoundName) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  switch (name) {
    case "click":
      tone(ac, 1900, t, 0.035, 0.05, "triangle");
      break;
    case "chip":
      // Two clay chips knocking: a bright tick and a short body.
      noise(ac, t, 0.03, 0.25, 4200, 3);
      tone(ac, 2300, t, 0.05, 0.05, "sine", { to: 1700 });
      noise(ac, t + 0.028, 0.025, 0.12, 3600, 3);
      break;
    case "flip":
      noise(ac, t, 0.07, 0.16, 2600, 0.8);
      tone(ac, 420, t + 0.01, 0.05, 0.03, "sine", { to: 260 });
      break;
    case "pop":
      tone(ac, 520, t, 0.09, 0.09, "sine", { to: 1100 });
      noise(ac, t, 0.02, 0.06, 5000, 2);
      break;
    case "whoosh":
      noise(ac, t, 0.5, 0.2, 700, 0.7, "lowpass");
      tone(ac, 180, t, 0.45, 0.04, "sawtooth", { to: 520, attack: 0.15 });
      break;
    case "tick":
      tone(ac, 3200, t, 0.018, 0.035, "square");
      break;
    case "coin":
      tone(ac, 1567.98, t, 0.12, 0.05, "square", { wet: true });
      tone(ac, 2093, t + 0.07, 0.35, 0.05, "square", { wet: true });
      break;
    case "chime":
      tone(ac, NOTES.E6, t, 0.5, 0.05, "sine", { wet: true });
      tone(ac, NOTES.G6, t + 0.08, 0.6, 0.04, "sine", { wet: true });
      break;
    case "win":
      [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6].forEach((f, i) => {
        tone(ac, f, t + i * 0.07, 0.45, 0.05, "triangle", { wet: true });
        tone(ac, f * 2, t + i * 0.07, 0.25, 0.012, "sine", { wet: true });
      });
      break;
    case "bigwin":
      [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6, NOTES.E6, NOTES.G6].forEach((f, i) =>
        tone(ac, f, t + i * 0.06, 0.6, 0.05, "triangle", { wet: true }),
      );
      [NOTES.C6, NOTES.E6, NOTES.G6].forEach((f) => tone(ac, f, t + 0.4, 1.2, 0.035, "sine", { wet: true, attack: 0.03 }));
      for (let i = 0; i < 6; i++) noise(ac, t + 0.4 + i * 0.09, 0.05, 0.05, 7000 + i * 400, 4);
      break;
    case "lose":
      tone(ac, 196, t, 0.35, 0.07, "triangle", { to: 98 });
      noise(ac, t, 0.12, 0.08, 300, 0.7, "lowpass");
      break;
  }
}
