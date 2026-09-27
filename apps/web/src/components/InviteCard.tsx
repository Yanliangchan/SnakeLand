"use client";

import { useEffect, useState } from "react";
import type { ReferralStateDTO } from "@snakeland/shared";
import { Button, Card } from "@/components/ui";
import { engagementApi } from "@/lib/engagement-api";
import { chips } from "@/lib/format";

/** Invite link + tally. Both sides get chips when a friend signs up through it. */
export function InviteCard() {
  const [state, setState] = useState<ReferralStateDTO | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    engagementApi
      .referral()
      .then((s) => !cancelled && setState(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;
  const link = `${window.location.origin}/?ref=${encodeURIComponent(state.code)}`;

  const copy = async () => {
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "snakeland", text: "Play free casino games with me on snakeland", url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <Card className="mt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Invite friends</p>
          <p className="mt-1 text-[13px] text-fg-muted">
            You and your friend each get <span className="font-semibold text-fg">{chips(state.reward)}</span> chips when they sign up with your
            link.
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-[18px] font-semibold tabular">{state.referred}</p>
            <p className="text-[11px] text-fg-muted">invited</p>
          </div>
          <div>
            <p className="text-[18px] font-semibold tabular text-win">+{chips(state.earned)}</p>
            <p className="text-[11px] text-fg-muted">earned</p>
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          readOnly
          value={link}
          aria-label="Your invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate rounded-[10px] bg-bg/60 px-3 py-2 text-[13px] text-fg-muted hairline"
        />
        <Button size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </Card>
  );
}
