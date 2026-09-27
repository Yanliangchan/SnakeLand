"use client";

import { OfflineBanner } from "@/components/OfflineBanner";
import { ReferralCapture } from "@/components/ReferralCapture";
import { SessionProvider } from "./session";
import { SettingsProvider } from "./settings";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // Settings also owns MotionConfig (reduce-motion follows the setting or the OS).
    <SettingsProvider>
      <SessionProvider>
        {children}
        <ReferralCapture />
      </SessionProvider>
      <OfflineBanner />
    </SettingsProvider>
  );
}
