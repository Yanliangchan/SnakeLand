"use client";

import { useState } from "react";
import type { AdminStatsDTO } from "@snakeland/shared";
import { Button, Card, Toggle } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chips } from "@/lib/format";
import { useAdminExpired } from "./AdminFrame";

const input = "h-10 w-full rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] outline-none hairline focus:border-fg/40";

/** Actions on every account at once: give everyone chips, or wipe all guests. */
export function BulkActions({ stats, onDone }: { stats: AdminStatsDTO | null; onDone: () => void }) {
  const expired = useAdminExpired();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [includeGuests, setIncludeGuests] = useState(false);
  const [busy, setBusy] = useState<"grant" | "wipe" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const n = Math.floor(Number(amount.replace(/[,\s]/g, "")));
  const amountOk = Number.isSafeInteger(n) && n >= 1 && n <= 1_000_000;
  // Roughly who'll receive it (suspended accounts are skipped by the server).
  const recipients = stats ? stats.players + (includeGuests ? stats.guests : 0) - stats.suspended : null;

  const fail = (e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.status === 401) return expired();
    setMsg({ ok: false, text: e instanceof ApiError ? e.message : fallback });
  };

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountOk) return;
    const who = includeGuests ? "every player and guest" : "every registered player";
    if (!window.confirm(`Give ${chips(n)} chips to ${who}${recipients !== null ? ` (about ${chips(Math.max(0, recipients))})` : ""}?`)) return;
    setBusy("grant");
    setMsg(null);
    try {
      // One id per grant: if this request is retried, nobody is paid twice.
      const r = await adminApi.grantAll({ grantId: crypto.randomUUID(), amount: n, includeGuests, note: note.trim() || undefined });
      setMsg({ ok: true, text: `Gave ${chips(n)} chips to ${chips(r.credited)} accounts${r.skipped ? ` (${r.skipped} skipped at the balance limit)` : ""}.` });
      setAmount("");
      setNote("");
      onDone();
    } catch (err) {
      fail(err, "Couldn't give chips");
    } finally {
      setBusy(null);
    }
  };

  const wipe = async () => {
    const typed = window.prompt(
      `This permanently deletes ${stats ? chips(stats.guests) : "all"} guest accounts, their chips and history. Registered players are not affected.\n\nType WIPE GUESTS to confirm.`,
    );
    if (typed !== "WIPE GUESTS") return;
    setBusy("wipe");
    setMsg(null);
    try {
      const r = await adminApi.wipeGuests();
      setMsg({ ok: true, text: `Wiped ${chips(r.removed)} guest accounts.` });
      onDone();
    } catch (err) {
      fail(err, "Couldn't wipe guests");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mt-3">
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <form onSubmit={grant} className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">Give everyone chips</p>
          <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-center">
            <input
              className={cn(input, "tabular")}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount, e.g. 5000"
              aria-label="Amount for everyone"
            />
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional)" aria-label="Grant note" />
            <Button type="submit" size="sm" loading={busy === "grant"} disabled={!amountOk || busy !== null}>
              Give to all
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-fg-muted">
            <Toggle checked={includeGuests} onChange={setIncludeGuests} label="Include guests" />
            Include guests{recipients !== null && ` · about ${chips(Math.max(0, recipients))} accounts`}
          </label>
        </form>
        <div className="flex flex-col gap-2 lg:items-end">
          <p className="text-[13px] font-medium">Guests</p>
          <Button variant="secondary" size="sm" loading={busy === "wipe"} disabled={busy !== null || stats?.guests === 0} onClick={() => void wipe()}>
            Wipe all guests{stats ? ` (${chips(stats.guests)})` : ""}
          </Button>
        </div>
      </div>
      {msg && <p className={cn("mt-3 text-[13px]", msg.ok ? "text-win" : "text-loss")}>{msg.text}</p>}
    </Card>
  );
}
