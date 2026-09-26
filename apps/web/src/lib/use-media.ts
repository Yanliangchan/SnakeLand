"use client";

import { useSyncExternalStore } from "react";

/** Media query as state; `fallback` is used during SSR. */
export function useMedia(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}
