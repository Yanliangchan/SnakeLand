"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { playSound, type SoundName } from "@/lib/sound";

const KEY = "snk:sound";
const listeners = new Set<() => void>();

function readSound(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function writeSound(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this tab.
  }
  memory = on;
  listeners.forEach((l) => l());
}

let memory: boolean | null = null;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => (memory ??= readSound());
const getServerSnapshot = () => false;

interface SettingsValue {
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** Plays a UI sound if the user has sound enabled (muted by default). */
  play: (name: SoundName) => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const soundOn = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const play = useCallback((name: SoundName) => {
    if (getSnapshot()) playSound(name);
  }, []);
  const value = useMemo(() => ({ soundOn, setSoundOn: writeSound, play }), [soundOn, play]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
