"use client";

import { useEffect, useState } from "react";
import type { PushPrefsDTO } from "@snakeland/shared";
import { ButtonLink, Card, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { fadeUp } from "@/lib/motion";
import { currentPush, disablePush, enablePush, pushConfig, pushSupported } from "@/lib/push";

type State = { kind: "loading" } | { kind: "unavailable"; why: string } | { kind: "ready"; publicKey: string; on: boolean; prefs: PushPrefsDTO };

/** Opt-in per device: daily chips ready, and weekly title won or lost. */
export function NotificationsCard({ isGuest }: { isGuest: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<State> => {
      if (isGuest) return { kind: "unavailable", why: "guest" };
      if (!pushSupported()) return { kind: "unavailable", why: "Not supported in this browser. On iPhone, add Snakeland to your Home Screen first." };
      const config = await pushConfig();
      if (!config.enabled || !config.publicKey) return { kind: "unavailable", why: "Notifications aren't set up on this server yet." };
      const current = await currentPush().catch(() => null);
      return { kind: "ready", publicKey: config.publicKey, on: !!current, prefs: current?.prefs ?? { daily: true, titles: true } };
    })()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState({ kind: "unavailable", why: "Couldn't check notification settings." }));
    return () => {
      cancelled = true;
    };
  }, [isGuest]);

  const apply = async (on: boolean, prefs: PushPrefsDTO) => {
    if (state.kind !== "ready" || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (on && (prefs.daily || prefs.titles)) {
        await enablePush(state.publicKey, prefs);
        setState({ ...state, on: true, prefs });
      } else {
        await disablePush();
        setState({ ...state, on: false, prefs: on ? prefs : state.prefs });
      }
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't update notifications");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-3" transition={{ ...fadeUp.transition, delay: 0.1 }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium">Notifications</p>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {state.kind === "unavailable"
              ? state.why === "guest"
                ? "Create an account to get notified on this device."
                : state.why
              : "On this device only. Never more than a few a day."}
          </p>
        </div>
        {state.kind === "ready" && (
          <Toggle label="Notifications" checked={state.on} onChange={(on) => void apply(on, state.prefs)} />
        )}
        {state.kind === "unavailable" && state.why === "guest" && (
          <ButtonLink href="/sign-up" size="sm">
            Sign up
          </ButtonLink>
        )}
      </div>
      {state.kind === "ready" && state.on && (
        <div className="mt-4 flex flex-col gap-3 border-t border-hairline pt-4">
          {(
            [
              ["daily", "Daily chips ready", "When your next daily claim unlocks."],
              ["titles", "Weekly titles", "When you win or lose a title on this week's board."],
            ] as const
          ).map(([key, label, sub]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px]">{label}</p>
                <p className="text-[12px] text-fg-muted">{sub}</p>
              </div>
              <Toggle label={label} checked={state.prefs[key]} onChange={(v) => void apply(true, { ...state.prefs, [key]: v })} />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-loss">
          {error}
        </p>
      )}
    </Card>
  );
}
