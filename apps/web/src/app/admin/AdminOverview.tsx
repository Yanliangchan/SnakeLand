"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAMES, isGameId, type AdminDayDTO, type AdminOverviewDTO, type TransactionType } from "@snakeland/shared";
import { ErrorState } from "@/components/ErrorState";
import { Card } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chips, dateTime, signedChips } from "@/lib/format";
import { GAME_ACCENT } from "@/lib/games-ui";
import { useAdminExpired } from "./AdminFrame";

const FLOW_LABEL: Partial<Record<TransactionType, string>> = {
  signup_bonus: "Welcome chips",
  daily_claim: "Daily claims",
  bonus_spin: "Bonus wheel",
  referral: "Invite bonuses",
  lab_reward: "Lab rewards",
  lab_track: "Lab track bonuses",
  rain: "Chat rain",
  admin_adjust: "Admin adjustments",
  guest_merge: "Guest carry-over",
  event_entry: "Event buy-ins",
  event_prize: "Event prizes",
  event_refund: "Event refunds",
};

const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${+(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${+(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${+(a / 1e3).toFixed(1)}K` : a.toLocaleString();
  return n < 0 ? `−${s}` : s;
};
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "win" | "loss" }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-surface px-4 py-3 hairline">
      <p className="text-[12px] text-fg-muted">{label}</p>
      <p className={cn("mt-1 text-[24px] font-semibold leading-tight tabular", tone === "win" && "text-win", tone === "loss" && "text-loss")}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-fg-muted">{sub}</p>}
    </div>
  );
}

/**
 * One series over the last 14 days. Bars grow from a zero baseline; with
 * `signed`, losses hang below it. Hovering (or focusing) a day shows its value.
 */
function DayBars({
  title,
  days,
  pick,
  signed = false,
  format = compact,
}: {
  title: string;
  days: AdminDayDTO[];
  pick: (d: AdminDayDTO) => number;
  signed?: boolean;
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map(pick);
  const max = Math.max(1, ...values.map((v) => (signed ? Math.abs(v) : v)));
  const W = 280;
  const H = 96;
  const base = signed ? H / 2 : H;
  const scale = signed ? H / 2 - 2 : H - 2;
  const slot = W / values.length;
  const bw = Math.max(2, slot - 2); // 2px gap between bars
  const total = values.reduce((a, b) => a + b, 0);
  const shown = hover === null ? null : days[hover]!;

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-[12px] text-fg-muted tabular">
          {shown ? (
            <>
              {dayLabel(shown.day)} · <span className="font-semibold text-fg">{signed ? signedChips(values[hover!]!) : format(values[hover!]!)}</span>
            </>
          ) : (
            <>
              14 days · <span className="font-semibold text-fg">{signed ? signedChips(total) : format(total)}</span>
            </>
          )}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-24 w-full overflow-visible" role="img" aria-label={`${title}, last 14 days`} onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => {
          const h = Math.max(v === 0 ? 0 : 2, (Math.abs(v) / max) * scale);
          const x = i * slot + 1;
          const up = !signed || v >= 0;
          const y = up ? base - h : base;
          const r = Math.min(4, h, bw / 2);
          // Rounded at the data end only; square on the baseline.
          const d = up
            ? `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${base} Z`
            : `M${x},${base} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + bw - r} Q${x + bw},${y + h} ${x + bw},${y + h - r} V${base} Z`;
          const fill = signed ? (up ? "var(--color-win)" : "var(--color-loss)") : "var(--color-fg-muted)";
          return (
            <g key={days[i]!.day}>
              {h > 0 && <path d={d} fill={fill} opacity={hover === null || hover === i ? 1 : 0.45} />}
              {/* Full-height hit target, wider than the bar. */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                tabIndex={0}
                aria-label={`${dayLabel(days[i]!.day)}: ${format(v)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--color-hairline-strong, rgba(255,255,255,0.15))" strokeWidth={1} />
      </svg>
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-muted">
        <span>{days[0] && dayLabel(days[0].day)}</span>
        <span>Today</span>
      </div>
    </Card>
  );
}

function NetList({ title, rows, tone }: { title: string; rows: AdminOverviewDTO["winners24h"]; tone: "win" | "loss" }) {
  return (
    <Card>
      <p className="text-[13px] font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-fg-muted">Nobody yet.</p>
      ) : (
        <ol className="mt-2 divide-y divide-hairline text-[13px]">
          {rows.map((r, i) => (
            <li key={r.userId} className="flex items-center gap-3 py-2">
              <span className="w-4 text-fg-muted tabular">{i + 1}</span>
              <Link href={`/admin/players/${r.userId}`} className="min-w-0 flex-1 truncate hover:underline">
                {r.name}
              </Link>
              <span className={cn("font-semibold tabular", tone === "win" ? "text-win" : "text-loss")}>{signedChips(r.net)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const roomName = (room: string) => (room === "crash" ? "Crash" : room.startsWith("roulette:") ? `Roulette ${room.slice(-1)}` : room);

export function AdminOverview() {
  const expired = useAdminExpired();
  const [data, setData] = useState<AdminOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      adminApi
        .overview()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 401) expired();
          else setError("Couldn't load the overview");
        });
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [reload, expired]);

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-[1440px] px-3 pt-6 sm:px-6">
        {error ? <ErrorState title={error} onRetry={() => setReload((n) => n + 1)} /> : <p className="py-24 text-center text-[13px] text-fg-muted">Loading…</p>}
      </main>
    );
  }

  const t = data.totals;
  const watching = data.liveRooms.reduce((s, r) => s + r.viewers, 0);
  const created = data.flows.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const houseNet7d = data.games.reduce((s, g) => s + g.houseNet, 0);

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-3 pb-16 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[24px] font-semibold">Overview</h1>
          <p className="mt-1 text-[13px] text-fg-muted">Last 24 hours unless noted. Updated {dateTime(data.generatedAt)}; refreshes every minute.</p>
        </div>
        <button onClick={() => setReload((n) => n + 1)} className="rounded-full px-3 py-1 text-[12px] text-fg-muted hairline hover:text-fg">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Players" value={chips(t.players)} sub={`${chips(t.guests)} guests`} />
        <Tile label="Active" value={chips(t.active24h)} sub={`${watching} in live rooms now`} />
        <Tile label="New sign-ups" value={chips(t.signups24h)} sub={`${chips(t.signups7d)} this week`} />
        <Tile label="Chips in circulation" value={compact(t.chipsInPlay)} />
        <Tile label="Wagered" value={compact(t.wagered24h)} sub={`${chips(t.rounds24h)} rounds`} />
        <Tile label="House result" value={signedChips(t.houseNet24h)} tone={t.houseNet24h >= 0 ? "win" : "loss"} sub="bets − payouts" />
        <Tile label="House result, 7 days" value={signedChips(houseNet7d)} tone={houseNet7d >= 0 ? "win" : "loss"} />
        <Tile label="Live events" value={String(data.liveEvents)} sub={data.liveEvents ? "running now" : "none running"} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DayBars title="Sign-ups" days={data.days} pick={(d) => d.signups} format={(n) => n.toLocaleString()} />
        <DayBars title="Active players" days={data.days} pick={(d) => d.active} format={(n) => n.toLocaleString()} />
        <DayBars title="Wagered" days={data.days} pick={(d) => d.wagered} />
        <DayBars title="House result" days={data.days} pick={(d) => d.houseNet} signed />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card padded={false} className="overflow-hidden">
          <p className="px-4 pt-4 text-[13px] font-medium">Games · last 7 days</p>
          {data.games.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-fg-muted">No rounds played this week.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[520px] text-[13px]">
                <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Game</th>
                    <th className="px-2 py-2 text-right font-medium">Rounds</th>
                    <th className="px-2 py-2 text-right font-medium">Players</th>
                    <th className="px-2 py-2 text-right font-medium">Wagered</th>
                    <th className="px-2 py-2 text-right font-medium">House</th>
                    <th className="px-4 py-2 text-right font-medium">Edge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {data.games.map((g) => (
                    <tr key={g.game}>
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          <span className="size-2 rounded-full" style={{ background: isGameId(g.game) ? GAME_ACCENT[g.game] : "var(--color-fg-muted)" }} />
                          {isGameId(g.game) ? GAMES[g.game].name : g.game}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular">{chips(g.rounds)}</td>
                      <td className="px-2 py-2 text-right tabular">{chips(g.players)}</td>
                      <td className="px-2 py-2 text-right tabular">{compact(g.wagered)}</td>
                      <td className={cn("px-2 py-2 text-right tabular", g.houseNet >= 0 ? "text-win" : "text-loss")}>{signedChips(g.houseNet)}</td>
                      <td className="px-4 py-2 text-right text-fg-muted tabular">
                        {g.wagered ? `${((g.houseNet / g.wagered) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <p className="text-[13px] font-medium">Chips in and out · last 7 days</p>
          <p className="mt-0.5 text-[12px] text-fg-muted">Outside of game play. {compact(created)} chips handed out.</p>
          {data.flows.length === 0 ? (
            <p className="mt-3 text-[13px] text-fg-muted">Nothing yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline text-[13px]">
              {data.flows.map((f) => (
                <li key={f.type} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-fg-muted">{FLOW_LABEL[f.type] ?? f.type}</span>
                  <span className={cn("tabular", f.amount < 0 && "text-loss")}>{signedChips(f.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <NetList title="Biggest winners · 24h" rows={data.winners24h} tone="win" />
        <NetList title="Biggest losers · 24h" rows={data.losers24h} tone="loss" />
        <Card>
          <p className="text-[13px] font-medium">Live rooms now</p>
          {data.liveRooms.length === 0 ? (
            <p className="mt-3 text-[13px] text-fg-muted">Nobody watching.</p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline text-[13px]">
              {data.liveRooms.map((r) => (
                <li key={r.room} className="flex justify-between py-2">
                  <span className="text-fg-muted">{roomName(r.room)}</span>
                  <span className="tabular">{r.viewers}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <p className="text-[13px] font-medium">Recent admin actions</p>
          {data.audit.length === 0 ? (
            <p className="mt-3 text-[13px] text-fg-muted">None yet.</p>
          ) : (
            <ul className="mt-2 max-h-64 divide-y divide-hairline overflow-y-auto text-[13px]">
              {data.audit.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    {a.targetUserId ? (
                      <Link href={`/admin/players/${a.targetUserId}`} className="hover:underline">
                        {a.action.replace(/_/g, " ")}
                      </Link>
                    ) : (
                      a.action.replace(/_/g, " ")
                    )}
                  </span>
                  <span className="shrink-0 text-[12px] text-fg-muted">{dateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
