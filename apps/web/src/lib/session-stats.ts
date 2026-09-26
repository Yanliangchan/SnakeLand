"use client";

import { useSyncExternalStore } from "react";
import type { GameId } from "@snakeland/shared";

/** Per-game results for this browser session (cleared when the tab closes). */
export interface SessionStats {
  rounds: number;
  wagered: number;
  net: number;
  wins: number;
  /** Best payout multiplier this session (payout / stake). */
  best: number;
}

const EMPTY: SessionStats = { rounds: 0, wagered: 0, net: 0, wins: 0, best: 0 };
const KEY = (g: GameId) => `snk:session:${g}`;
const cache = new Map<GameId, SessionStats>();
const listeners = new Set<() => void>();

function read(game: GameId): SessionStats {
  const hit = cache.get(game);
  if (hit) return hit;
  let value = EMPTY;
  try {
    const raw = window.sessionStorage.getItem(KEY(game));
    if (raw) value = { ...EMPTY, ...(JSON.parse(raw) as Partial<SessionStats>) };
  } catch {
    // sessionStorage unavailable: keep stats in memory only.
  }
  cache.set(game, value);
  return value;
}

/** Record one settled round: what was staked and what came back. */
export function recordRound(game: GameId, staked: number, payout: number) {
  if (staked <= 0) return;
  const prev = read(game);
  const next: SessionStats = {
    rounds: prev.rounds + 1,
    wagered: prev.wagered + staked,
    net: prev.net + payout - staked,
    wins: prev.wins + (payout > staked ? 1 : 0),
    best: Math.max(prev.best, payout / staked),
  };
  cache.set(game, next);
  try {
    window.sessionStorage.setItem(KEY(game), JSON.stringify(next));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function resetSessionStats(game: GameId) {
  cache.set(game, EMPTY);
  try {
    window.sessionStorage.removeItem(KEY(game));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSessionStats(game: GameId): SessionStats {
  return useSyncExternalStore(
    subscribe,
    () => read(game),
    () => EMPTY,
  );
}
