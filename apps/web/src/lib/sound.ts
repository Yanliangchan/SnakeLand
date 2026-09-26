/**
 * Tiny synthesized UI sounds (no audio files to load). Deliberately quiet.
 * Nothing plays until the user unmutes, and the AudioContext is only created
 * on the first sound after that, satisfying browser autoplay rules.
 */
export type SoundName = "click" | "flip" | "chime";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, freq: number, start: number, duration: number, gain: number, type: OscillatorType) {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function noise(ac: AudioContext, start: number, duration: number, gain: number, cutoff: number) {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * duration), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = cutoff;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(start);
}

export function playSound(name: SoundName) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  switch (name) {
    case "click":
      tone(ac, 1800, t, 0.04, 0.035, "triangle");
      break;
    case "flip":
      noise(ac, t, 0.06, 0.08, 3200);
      break;
    case "chime":
      tone(ac, 880, t, 0.5, 0.05, "sine");
      tone(ac, 1318.5, t + 0.08, 0.6, 0.04, "sine");
      break;
  }
}
