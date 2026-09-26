"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AdminPlayerRowDTO, AdminStatsDTO } from "@snakeland/shared";
import { Segmented } from "@/components/Segmented";
import { Button, Card } from "@/components/ui";
import { adminApi, type PlayerFilter } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chips, dateShort, signedChips, timeLeft } from "@/lib/format";
import { useAdminExpired } from "./AdminFrame";

function ago(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  return `${timeLeft(new Date(Date.now() + ms))} ago`;
}

export function AdminPlayers() {
  const expired = useAdminExpired();
  const [stats, setStats] = useState<AdminStatsDTO | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlayerFilter>("all");
  const [rows, setRows] = useState<AdminPlayerRowDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${query}|${filter}`;
  const loading = loadedKey !== key || loadingMore;
  const [error, setError] = useState<string | null>(null);

  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) expired();
    else setError(e instanceof Error ? e.message : "Something went wrong");
  };

  useEffect(() => {
    adminApi.stats().then(setStats).catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce typing into the search box.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .players({ q: query || undefined, filter })
      .then((page) => {
        if (cancelled) return;
        setRows(page.items);
        setTotal(page.total);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((e) => !cancelled && onError(e))
      .finally(() => !cancelled && setLoadedKey(`${query}|${filter}`));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await adminApi.players({ q: query || undefined, filter, cursor });
      setRows((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      onError(e);
    } finally {
      setLoadingMore(false);
    }
  }

  const tiles: Array<[string, string]> = stats
    ? [
        ["Players", chips(stats.players)],
        ["Guests", chips(stats.guests)],
        ["Active today", chips(stats.activeToday)],
        ["Suspended", chips(stats.suspended)],
        ["Chips in play", chips(stats.chipsInPlay)],
      ]
    : [];

  return (
    <main className="mx-auto w-full max-w-[1440px] px-3 pb-16 pt-6 sm:px-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
        {tiles.map(([label, value]) => (
          <Card key={label} className="p-4 sm:p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{label}</p>
            <p className="mt-1 text-[20px] font-semibold tabular">{value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or id"
          aria-label="Search players"
          maxLength={100}
          className="h-10 min-w-0 flex-1 rounded-[var(--radius-ui)] bg-surface px-3.5 text-[14px] outline-none hairline placeholder:text-fg-disabled focus:border-hairline-strong sm:max-w-sm"
        />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "players", label: "Players" },
            { value: "guests", label: "Guests" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
        <span className="text-[13px] text-fg-muted tabular">{chips(total)} found</span>
      </div>

      {error && <p className="mt-4 text-[13px] text-loss">{error}</p>}

      <Card padded={false} className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">
            <tr className="border-b border-hairline">
              <th className="px-4 py-3 font-medium">Player</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
              <th className="px-4 py-3 text-right font-medium">This week</th>
              <th className="px-4 py-3 text-right font-medium">All time</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-elevated/60">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/players/${encodeURIComponent(r.id)}`} className="flex flex-col">
                    <span className="flex items-center gap-2 font-medium">
                      {r.name}
                      {r.isGuest && <span className="rounded-full px-1.5 text-[10px] text-fg-muted hairline">Guest</span>}
                      {r.suspended && <span className="rounded-full border border-loss/40 px-1.5 text-[10px] text-loss">Suspended</span>}
                    </span>
                    <span className="text-[12px] text-fg-muted">{r.email ?? r.id}</span>
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right tabular">{chips(r.balance)}</td>
                <td className={cn("px-4 py-2.5 text-right tabular", r.weeklyProfit > 0 ? "text-win" : r.weeklyProfit < 0 && "text-loss")}>
                  {signedChips(r.weeklyProfit)}
                </td>
                <td className={cn("px-4 py-2.5 text-right tabular", r.allTimeProfit > 0 ? "text-win" : r.allTimeProfit < 0 && "text-loss")}>
                  {signedChips(r.allTimeProfit)}
                </td>
                <td className="px-4 py-2.5 text-fg-muted">{dateShort(r.joinedAt)}</td>
                <td className="px-4 py-2.5 text-fg-muted" suppressHydrationWarning>
                  {ago(r.lastSeenAt)}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-fg-muted">
                  No players match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" loading={loading} onClick={more}>
            Load more
          </Button>
        </div>
      )}
    </main>
  );
}
