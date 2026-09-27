"use client";

import { useEffect, useState } from "react";
import { ANNOUNCEMENT_LEVELS, CRASH_ROOM, LIVE_ROOMS, ROULETTE_WHEELS, type AdminAnnouncementDTO, type AnnouncementLevel, type LiveRoom } from "@snakeland/shared";
import { ErrorState } from "@/components/ErrorState";
import { Button, Card, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { adminEngagementApi } from "@/lib/engagement-api";
import { chips, dateShort } from "@/lib/format";
import { useAdminExpired } from "../AdminFrame";

const input = "h-10 w-full rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] outline-none hairline focus:border-fg/40";

const roomName = (r: LiveRoom) =>
  r === CRASH_ROOM ? "Crash" : `Roulette · ${ROULETTE_WHEELS.find((w) => `roulette:${w.id}` === r)?.name ?? r}`;

const LEVEL_TONE: Record<AnnouncementLevel, string> = {
  info: "text-fg",
  success: "text-win",
  warn: "text-gold",
};

function Rain() {
  const expired = useAdminExpired();
  const [room, setRoom] = useState<LiveRoom>(LIVE_ROOMS[0]);
  const [amount, setAmount] = useState("5000");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Math.floor(Number(amount));
    if (!window.confirm(`Rain ${chips(n)} chips on ${roomName(room)}?`)) return;
    setPending(true);
    setMsg(null);
    try {
      const r = await adminEngagementApi.rain(room, n);
      setMsg({ ok: true, text: `Sent ${chips(r.each)} each to ${r.recipients} player${r.recipients === 1 ? "" : "s"}.` });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return expired();
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Couldn't make it rain" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <p className="text-[15px] font-semibold">Chat rain</p>
      <p className="mt-1 text-[13px] text-fg-muted">Split a pot evenly between everyone who’s chatted recently in a room.</p>
      <form onSubmit={go} className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-fg-muted">Room</span>
          <select className={input} value={room} onChange={(e) => setRoom(e.target.value as LiveRoom)}>
            {LIVE_ROOMS.map((r) => (
              <option key={r} value={r}>
                {roomName(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-fg-muted">Total chips</span>
          <input
            className={cn(input, "tabular")}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
        <Button type="submit" loading={pending} disabled={!amount || Number(amount) < 10}>
          Make it rain
        </Button>
      </form>
      {msg && <p className={cn("mt-2 text-[13px]", msg.ok ? "text-win" : "text-loss")}>{msg.text}</p>}
    </Card>
  );
}

function Announcements() {
  const expired = useAdminExpired();
  const [items, setItems] = useState<AdminAnnouncementDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [body, setBody] = useState("");
  const [level, setLevel] = useState<AnnouncementLevel>("info");
  const [href, setHref] = useState("");
  const [active, setActive] = useState(true);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminEngagementApi
      .announcements()
      .then((r) => !cancelled && setItems(r.announcements))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) expired();
        else setError("Couldn't load announcements");
      });
    return () => {
      cancelled = true;
    };
  }, [reload, expired]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setReload((n) => n + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) expired();
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    try {
      await adminEngagementApi.createAnnouncement({ body: body.trim(), level, href: href.trim() || null, active });
      setBody("");
      setHref("");
      setReload((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return expired();
      setFormError(err instanceof ApiError ? err.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <p className="text-[15px] font-semibold">Announcement banner</p>
      <p className="mt-1 text-[13px] text-fg-muted">Shown across the top of the lobby. Only one is live at a time; publishing a new one replaces it.</p>
      <form onSubmit={create} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-fg-muted">Message ({280 - body.length} left)</span>
          <input className={input} value={body} onChange={(e) => setBody(e.target.value)} maxLength={280} required />
        </label>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-fg-muted">Style</span>
            <select className={input} value={level} onChange={(e) => setLevel(e.target.value as AnnouncementLevel)}>
              {ANNOUNCEMENT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-fg-muted">Link (optional: /path or https://)</span>
            <input className={input} value={href} onChange={(e) => setHref(e.target.value)} maxLength={300} placeholder="/lab" />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <Toggle checked={active} onChange={setActive} label="Publish now" />
            Publish now
          </label>
          <Button type="submit" loading={pending} disabled={!body.trim()}>
            Save
          </Button>
        </div>
        {formError && <p className="text-[13px] text-loss">{formError}</p>}
      </form>

      <div className="mt-5 border-t border-hairline pt-4">
        {!items ? (
          error ? (
            <ErrorState title={error} onRetry={() => setReload((n) => n + 1)} />
          ) : (
            <p className="py-6 text-center text-[13px] text-fg-muted">Loading…</p>
          )
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-fg-muted">No announcements yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[14px]", LEVEL_TONE[a.level])}>{a.body}</p>
                  <p className="text-[12px] text-fg-muted">
                    {a.active ? <span className="text-win">Live</span> : "Off"} · {a.level} · {dateShort(a.createdAt)}
                    {a.href && ` · ${a.href}`}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => act(() => adminEngagementApi.setAnnouncementActive(a.id, !a.active))}>
                  {a.active ? "Take down" : "Publish"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.confirm("Delete this announcement?") && act(() => adminEngagementApi.deleteAnnouncement(a.id))}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function AdminEngage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pb-16 pt-6 sm:px-6">
      <div>
        <h1 className="text-[24px] font-semibold">Engage</h1>
        <p className="mt-1 text-[13px] text-fg-muted">Rain chips on a chat room and manage the lobby banner. Every action is logged.</p>
      </div>
      <Rain />
      <Announcements />
    </main>
  );
}
