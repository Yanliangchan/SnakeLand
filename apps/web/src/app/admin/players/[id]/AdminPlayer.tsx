"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GAMES, MAX_BALANCE, isGameId, type AdminBalanceMode, type AdminPlayerDetailDTO } from "@snakeland/shared";
import { PlayerName } from "@/components/PlayerName";
import { Segmented } from "@/components/Segmented";
import { Avatar, Button, Card } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chips, dateShort, dateTime, signedChips } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import { useAdminExpired } from "../../AdminFrame";

const inputCls =
  "h-10 w-full min-w-0 rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] outline-none hairline placeholder:text-fg-disabled focus:border-hairline-strong";

const TX_LABEL: Record<string, string> = {
  signup_bonus: "Welcome chips",
  daily_claim: "Daily chips",
  bet: "Bet",
  payout: "Payout",
  refund: "Refund",
  guest_merge: "Guest merge",
  admin_adjust: "Admin",
  lab_reward: "Lab",
};

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("h-fit", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{title}</p>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <span className="text-fg-muted">{k}</span>
      <span className="truncate text-right tabular">{v}</span>
    </div>
  );
}

/** One-click top-ups for players who've run dry. Logged like any balance change. */
const CHARITY_AMOUNTS = [5_000, 10_000] as const;

export function AdminPlayer({ id }: { id: string }) {
  const router = useRouter();
  const expired = useAdminExpired();
  const [data, setData] = useState<AdminPlayerDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const [mode, setMode] = useState<AdminBalanceMode>("adjust");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [deleteName, setDeleteName] = useState("");

  const load = useCallback(
    () =>
      adminApi
        .player(id)
        .then((d) => {
          setData(d);
          setName(d.profile.user.name);
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) expired();
          else setError(e instanceof ApiError && e.status === 404 ? "Player not found" : "Couldn't load player");
        }),
    [id, expired],
  );
  useEffect(() => {
    load();
  }, [load]);

  /** Runs an admin action, then reloads. Dangerous actions need a second click. */
  async function run(key: string, action: () => Promise<unknown>, done: string, needsConfirm = false): Promise<boolean> {
    if (needsConfirm && confirm !== key) {
      setConfirm(key);
      return false;
    }
    setConfirm(null);
    setBusy(key);
    setError(null);
    try {
      await action();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) expired();
      else setError(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  if (!data) {
    return <main className="px-4 py-24 text-center text-[13px] text-fg-muted">{error ?? "Loading…"}</main>;
  }

  const p = data.profile;
  const suspended = data.suspendedAt !== null;
  const parsed = Number(amount.replace(/[,\s]/g, ""));
  const amountOk =
    amount.trim() !== "" &&
    Number.isSafeInteger(parsed) &&
    (mode === "set" ? parsed >= 0 && parsed <= MAX_BALANCE : parsed !== 0 && Math.abs(parsed) <= MAX_BALANCE);
  const preview = amountOk ? (mode === "set" ? parsed : p.balance + parsed) : null;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-3 pb-16 pt-6 sm:px-6">
      <Link href="/admin/players" className="text-[13px] text-fg-muted hover:text-fg">
        ← All players
      </Link>

      <Card className="mt-3 flex flex-wrap items-center gap-4">
        <Avatar name={p.user.name} className="size-12 text-[16px]" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold">
            <PlayerName tag={p.user} />
            {p.user.isGuest && <span className="rounded-full px-2 text-[11px] font-normal text-fg-muted hairline">Guest</span>}
            {suspended && <span className="rounded-full border border-loss/40 px-2 text-[11px] font-normal text-loss">Suspended</span>}
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-fg-muted">
            {p.user.email ?? "No email"} · <span className="select-all">{p.user.id}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Balance</p>
          <p className="text-[26px] font-semibold tabular">{chips(p.balance)}</p>
        </div>
      </Card>

      <AnimatePresence>
        {(notice || error) && (
          <motion.p
            {...fadeUp}
            role="status"
            className={cn("mt-3 rounded-[12px] px-4 py-2.5 text-[13px] hairline", error ? "text-loss" : "text-win")}
          >
            {error ?? notice}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Section title="Balance">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-fg-muted">Charity top-up</span>
            {CHARITY_AMOUNTS.map((n) => (
              <Button
                key={n}
                variant="secondary"
                size="sm"
                loading={busy === `charity-${n}`}
                onClick={() =>
                  void run(
                    `charity-${n}`,
                    () => adminApi.balance(id, { mode: "adjust", amount: n, note: "Charity top-up" }),
                    `Charity top-up: +${chips(n)}`,
                    true,
                  )
                }
              >
                {confirm === `charity-${n}` ? "Confirm?" : `+${chips(n)}`}
              </Button>
            ))}
          </div>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "adjust", label: "Add / remove" },
              { value: "set", label: "Set exact" },
            ]}
          />
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!amountOk) return;
              void run(
                "balance",
                () => adminApi.balance(id, { mode, amount: parsed, note: note.trim() || undefined }),
                "Balance updated",
                true,
              ).then((ok) => {
                if (!ok) return;
                setAmount("");
                setNote("");
              });
            }}
          >
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setConfirm(null);
              }}
              placeholder={mode === "set" ? "New balance, e.g. 5000" : "Amount, e.g. 1000 or -500"}
              aria-label="Amount"
              className={inputCls}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Note"
              maxLength={200}
              className={inputCls}
            />
            <p className="h-5 text-[12px] text-fg-muted tabular">
              {preview !== null && (preview < 0 ? <span className="text-loss">Balance can’t go below 0</span> : `${chips(p.balance)} → ${chips(preview)}`)}
            </p>
            <Button type="submit" size="sm" loading={busy === "balance"} disabled={!amountOk || (preview ?? 0) < 0}>
              {confirm === "balance" ? "Click again to confirm" : "Apply"}
            </Button>
          </form>
        </Section>

        <Section title="Account">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("rename", () => adminApi.rename(id, name), "Renamed");
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} aria-label="Display name" className={inputCls} />
            <Button type="submit" variant="secondary" size="sm" loading={busy === "rename"} disabled={!name.trim() || name === p.user.name}>
              Rename
            </Button>
          </form>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" loading={busy === "claim"} onClick={() => run("claim", () => adminApi.resetClaim(id), "Daily claim is ready again")}>
              Reset daily claim
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={busy === "signout"}
              onClick={() => run("signout", () => adminApi.signOut(id), "Signed out everywhere", true)}
            >
              {confirm === "signout" ? "Confirm" : "Sign out everywhere"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={suspended ? "" : "text-loss"}
              loading={busy === "suspend"}
              onClick={() => run("suspend", () => adminApi.suspend(id, !suspended), suspended ? "Unsuspended" : "Suspended", !suspended)}
            >
              {suspended ? "Unsuspend" : confirm === "suspend" ? "Confirm suspend" : "Suspend"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={busy === "mute"}
              onClick={() => run("mute", () => adminApi.chatMute(id, !data.chatMutedAt), data.chatMutedAt ? "Chat unmuted" : "Chat muted", false)}
            >
              {data.chatMutedAt ? "Unmute chat" : "Mute chat"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="text-loss"
              onClick={() => {
                setConfirm(confirm === "delete" ? null : "delete");
                setDeleteName("");
              }}
            >
              {confirm === "delete" ? "Keep player" : "Delete player"}
            </Button>
          </div>
          <AnimatePresence>
            {confirm === "delete" && (
              <motion.form
                {...fadeUp}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (deleteName.trim() !== p.user.name) return;
                  void run(
                    "delete",
                    async () => {
                      await adminApi.deletePlayer(id);
                      router.replace("/admin/players");
                    },
                    "Player deleted",
                  );
                }}
                className="mt-3 rounded-[12px] border border-loss/30 bg-loss/5 p-3"
              >
                <p className="text-[13px] leading-relaxed">
                  This permanently deletes <span className="font-semibold">{p.user.name}</span>: account, sign-ins, chips,
                  ledger and game history. It can’t be undone.
                </p>
                <p className="mt-2 text-[12px] text-fg-muted">Type the player’s name to confirm.</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={deleteName}
                    onChange={(e) => setDeleteName(e.target.value)}
                    placeholder={p.user.name}
                    aria-label="Type the player's name to confirm"
                    autoFocus
                    className={inputCls}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="shrink-0 whitespace-nowrap bg-loss text-fg hover:bg-loss/90"
                    loading={busy === "delete"}
                    disabled={deleteName.trim() !== p.user.name}
                  >
                    Delete forever
                  </Button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
          <div className="mt-4 divide-y divide-hairline border-t border-hairline">
            <Row k="Joined" v={dateShort(p.user.joinedAt)} />
            <Row k="Last seen" v={data.lastSeenAt ? dateTime(data.lastSeenAt) : "—"} />
            <Row k="Active sessions" v={data.activeSessions} />
            <Row k="Next daily claim" v={p.perks.nextDailyClaimAt ? dateTime(p.perks.nextDailyClaimAt) : "Ready"} />
            {suspended && <Row k="Suspended" v={dateTime(data.suspendedAt!)} />}
          </div>
        </Section>

        <Section title="Stats">
          <div className="divide-y divide-hairline">
            <Row k="This week" v={`${signedChips(p.stats.weeklyProfit)}${p.stats.weeklyRank ? ` · #${p.stats.weeklyRank}` : ""}`} />
            <Row k="All time" v={`${signedChips(p.stats.allTimeProfit)}${p.stats.allTimeRank ? ` · #${p.stats.allTimeRank}` : ""}`} />
            <Row k="Wagered" v={chips(p.stats.totalWagered)} />
            <Row k="Biggest win" v={chips(p.stats.biggestWin)} />
            <Row k="Rounds" v={chips(p.stats.roundsPlayed)} />
            <Row k="Favourite" v={p.stats.favouriteGame && isGameId(p.stats.favouriteGame) ? GAMES[p.stats.favouriteGame].name : "—"} />
            <Row k="Weekly title" v={p.user.title ?? "—"} />
            <Row k="Next claim pays" v={chips(p.perks.nextClaim.amount)} />
          </div>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Section title="Recent transactions">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">
                <tr>
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Game</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                  <th className="py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 text-fg-muted">{dateTime(t.createdAt)}</td>
                    <td className="py-2">{TX_LABEL[t.type] ?? t.type}</td>
                    <td className="py-2 text-fg-muted">{t.game ? GAMES[t.game].name : "—"}</td>
                    <td className={cn("py-2 text-right tabular", t.amount > 0 ? "text-win" : "text-fg-muted")}>{signedChips(t.amount)}</td>
                    <td className="py-2 text-right tabular">{chips(t.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Admin log">
          {data.audit.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No admin actions yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {data.audit.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <span>
                    {a.action.replace(/_/g, " ")}
                    {a.detail && typeof a.detail.delta === "number" && (
                      <span className="text-fg-muted"> · {signedChips(a.detail.delta)}</span>
                    )}
                    {a.detail && typeof a.detail.note === "string" && <span className="block text-[12px] text-fg-muted">{a.detail.note}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-fg-muted">{dateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}
