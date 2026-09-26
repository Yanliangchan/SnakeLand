"use client";

import { useCallback, useSyncExternalStore } from "react";
import { newClientSeed } from "@/lib/fair";

const KEY = "snk:client-seed";
const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;
const listeners = new Set<() => void>();
let memory: string | null | undefined;

function read(): string | null {
  if (memory !== undefined) return memory;
  try {
    const v = window.localStorage.getItem(KEY);
    memory = v && SEED_RE.test(v) ? v : null;
  } catch {
    memory = null;
  }
  return memory;
}

/**
 * The player's side of the fairness scheme. By default every round gets a
 * fresh random client seed; players can pin their own instead.
 */
export function useClientSeed() {
  const custom = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => null,
  );

  const setCustom = useCallback((value: string | null) => {
    const v = value && SEED_RE.test(value) ? value : null;
    memory = v;
    try {
      if (v) window.localStorage.setItem(KEY, v);
      else window.localStorage.removeItem(KEY);
    } catch {
      // Per-tab only when storage is unavailable.
    }
    listeners.forEach((l) => l());
  }, []);

  const next = useCallback(() => read() ?? newClientSeed(), []);
  return { custom, setCustom, next, isValid: (v: string) => SEED_RE.test(v) };
}
