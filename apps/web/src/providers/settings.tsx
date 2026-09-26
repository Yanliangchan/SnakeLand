"use client";

import { MotionConfig } from "framer-motion";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { playSound, type SoundName } from "@/lib/sound";

export type MotionPref = "system" | "reduced" | "full";

export interface Prefs {
  sound: boolean;
  haptics: boolean;
  motion: MotionPref;
  /** Shorter animations for players who want pace. */
  fast: boolean;
}

const KEY = "snk:prefs";
const LEGACY_SOUND_KEY = "snk:sound";
const DEFAULTS: Prefs = { sound: false, haptics: true, motion: "system", fast: false };
const listeners = new Set<() => void>();
let memory: Prefs | null = null;

function read(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
    return { ...DEFAULTS, sound: window.localStorage.getItem(LEGACY_SOUND_KEY) === "on" };
  } catch {
    return DEFAULTS;
  }
}

function write(patch: Partial<Prefs>) {
  memory = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage can be unavailable (private mode); the change still applies to this tab.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => (memory ??= read());
const getServerSnapshot = () => DEFAULTS;

// OS "reduce motion", tracked live.
const mq = () => (typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)"));
const subscribeOs = (l: () => void) => {
  const m = mq();
  m?.addEventListener("change", l);
  return () => m?.removeEventListener("change", l);
};
const noopSubscribe = () => () => {};
const getOs = () => mq()?.matches ?? false;

/** Vibration patterns (ms). Ignored where the Vibration API is missing (e.g. iOS Safari). */
const HAPTIC: Record<SoundName | "lose" | "heavy", number | number[]> = {
  click: 8,
  flip: 5,
  chime: [18, 40, 28],
  lose: 45,
  heavy: 30,
};
export type HapticName = keyof typeof HAPTIC;

function vibrate(name: HapticName) {
  try {
    navigator.vibrate?.(HAPTIC[name]);
  } catch {
    // Some browsers throw when vibration isn't allowed yet (no user gesture).
  }
}

interface SettingsValue {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** Effective reduce-motion (the setting, or the OS when set to "system"). */
  reducedMotion: boolean;
  /** Animation time multiplier: 0.5 in fast mode, else 1. */
  speed: number;
  /** A UI sound (if sound is on) plus its matching vibration (if haptics are on). */
  play: (name: SoundName) => void;
  haptic: (name: HapticName) => void;
  /** Whether this device can vibrate at all. */
  canVibrate: boolean;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const osReduced = useSyncExternalStore(subscribeOs, getOs, () => false);
  const canVibrate = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.vibrate === "function",
    () => false,
  );
  const reducedMotion = prefs.motion === "reduced" || (prefs.motion === "system" && osReduced);

  const play = useCallback((name: SoundName) => {
    const p = getSnapshot();
    if (p.sound) playSound(name);
    if (p.haptics) vibrate(name);
  }, []);
  const haptic = useCallback((name: HapticName) => {
    if (getSnapshot().haptics) vibrate(name);
  }, []);

  const value = useMemo<SettingsValue>(
    () => ({
      prefs,
      setPrefs: write,
      soundOn: prefs.sound,
      setSoundOn: (on) => write({ sound: on }),
      reducedMotion,
      speed: prefs.fast ? 0.5 : 1,
      play,
      haptic,
      canVibrate,
    }),
    [prefs, reducedMotion, play, haptic, canVibrate],
  );

  return (
    <SettingsContext.Provider value={value}>
      <MotionConfig reducedMotion={prefs.motion === "system" ? "user" : prefs.motion === "reduced" ? "always" : "never"}>
        {children}
      </MotionConfig>
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
