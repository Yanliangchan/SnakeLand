"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Segmented } from "@/components/Segmented";
import { Avatar, Button, ButtonLink, Card, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";

export function SettingsView() {
  const router = useRouter();
  const { me, signOut } = useSession();
  const { prefs, setPrefs, soundOn, setSoundOn, play, haptic, canVibrate } = useSettings();
  const [signingOut, setSigningOut] = useState(false);
  if (!me) return null;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-12 sm:px-6">
        <motion.h1 {...fadeUp} className="text-[32px] font-semibold">
          Settings
        </motion.h1>

        <Card className="mt-8 flex items-center gap-4">
          <Avatar name={me.user.name} className="size-11 text-[14px]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{me.user.name}</p>
            <p className="truncate text-[13px] text-fg-muted">{me.user.isGuest ? "Guest on this device" : me.user.email}</p>
          </div>
          {me.user.isGuest && (
            <ButtonLink href="/sign-up" size="sm">
              Save progress
            </ButtonLink>
          )}
        </Card>

        <Card className="mt-3 flex items-center justify-between" transition={{ ...fadeUp.transition, delay: 0.05 }}>
          <div>
            <p className="text-[15px] font-medium">Sound</p>
            <p className="mt-0.5 text-[13px] text-fg-muted">Soft clicks, card flips and a chime on wins.</p>
          </div>
          <Toggle
            label="Sound"
            checked={soundOn}
            onChange={(on) => {
              setSoundOn(on);
              if (on) play("click");
            }}
          />
        </Card>

        <Card className="mt-3 flex items-center justify-between" transition={{ ...fadeUp.transition, delay: 0.07 }}>
          <div>
            <p className="text-[15px] font-medium">Haptics</p>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              {canVibrate ? "Light vibrations on chips, cards and wins." : "Not supported on this device or browser."}
            </p>
          </div>
          <Toggle
            label="Haptics"
            checked={prefs.haptics}
            onChange={(on) => {
              setPrefs({ haptics: on });
              if (on) setTimeout(() => haptic("heavy"), 0);
            }}
          />
        </Card>

        <Card className="mt-3" transition={{ ...fadeUp.transition, delay: 0.09 }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-medium">Motion</p>
              <p className="mt-0.5 text-[13px] text-fg-muted">Reduce movement, or follow your device setting.</p>
            </div>
            <Segmented
              value={prefs.motion}
              onChange={(motion) => setPrefs({ motion })}
              options={[
                { value: "system", label: "System" },
                { value: "reduced", label: "Reduced" },
                { value: "full", label: "Full" },
              ]}
            />
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
            <div>
              <p className="text-[15px] font-medium">Fast mode</p>
              <p className="mt-0.5 text-[13px] text-fg-muted">Quicker deals, drops and reveals.</p>
            </div>
            <Toggle label="Fast mode" checked={prefs.fast} onChange={(fast) => setPrefs({ fast })} />
          </div>
        </Card>

        <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.12 }} className="mt-10">
          <Button
            variant="secondary"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              // A guest leaving is gone for good: delete it rather than leave it behind.
              if (me.user.isGuest) await api("/v1/account/leave-guest", { method: "POST", body: {} }).catch(() => {});
              await signOut().catch(() => {});
              router.replace("/");
            }}
          >
            {me.user.isGuest ? "Leave guest session" : "Sign out"}
          </Button>
          {me.user.isGuest && (
            <p className="mt-3 text-[13px] text-fg-muted">Leaving deletes this guest and its chips for good.</p>
          )}
        </motion.div>
      </main>
    </div>
  );
}
