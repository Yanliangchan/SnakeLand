"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Sheet } from "@/components/ui";

const KEY = "snk:welcomed";

const STEPS = [
  { icon: "🪙", title: "1,000 free chips, daily", body: "Virtual chips only — no real money, ever. Claim 1,000 more every day, and top the leaderboards for bonus claims." },
  { icon: "🎲", title: "Eleven games, all provably fair", body: "Blackjack, Mines, Crash, Roulette and more. Every result is verifiable — tap “Fair” in any game to check it." },
  { icon: ">_", title: "The Lab pays you to hack", body: "Capture-the-flag puzzles — crypto, web, forensics — that pay chips. Start easy, work up to Insane." },
];

/** A one-time welcome for a player's first visit. Gated by localStorage. */
export function WelcomeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      // Deferred to the client after mount so SSR and hydration match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      // No storage (private mode): just don't show it.
    }
  }, []);

  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  return (
    <Sheet open={open} onClose={close} label="Welcome to snakeland" title="Welcome to snakeland">
      <div className="flex flex-col gap-4">
        {STEPS.map((s) => (
          <div key={s.title} className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-elevated text-[18px] font-mono">{s.icon}</span>
            <div>
              <p className="text-[15px] font-semibold">{s.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">{s.body}</p>
            </div>
          </div>
        ))}
        <div className="mt-1 flex gap-2">
          <Button className="flex-1" onClick={close}>
            Let’s play
          </Button>
          <Link href="/lab" onClick={close} className="grid place-items-center rounded-[var(--radius-ui)] px-4 text-[14px] font-medium text-fg-muted transition-colors hairline hover:text-fg">
            The Lab
          </Link>
        </div>
      </div>
    </Sheet>
  );
}
