"use client";

import { MotionConfig } from "framer-motion";
import { SessionProvider } from "./session";
import { SettingsProvider } from "./settings";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // Respect the OS "reduce motion" setting: transforms are skipped, opacity kept.
    <MotionConfig reducedMotion="user">
      <SettingsProvider>
        <SessionProvider>{children}</SessionProvider>
      </SettingsProvider>
    </MotionConfig>
  );
}
