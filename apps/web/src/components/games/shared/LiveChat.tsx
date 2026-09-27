"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LENGTH, type ChatHistoryDTO, type ChatMessageDTO, type LiveRoom } from "@snakeland/shared";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { expoOut, tap, tapTransition } from "@/lib/motion";
import { onLiveChat } from "@/lib/live-socket";
import { useSession } from "@/providers/session";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Stable per-name colour so people are easy to follow. */
const NAME_HUES = ["#2dd4bf", "#f5a524", "#a78bfa", "#38bdf8", "#f472b6", "#4ade80", "#fb923c", "#facc15"];
function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_HUES[h % NAME_HUES.length]!;
}

/**
 * Room chat for live games. The header button shows unread messages; the
 * panel slides in from the right (bottom on phones). Guests can read; posting
 * needs an account.
 */
export function LiveChat({ room }: { room: LiveRoom }) {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ChatHistoryDTO | null>(null);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // History for this room, then live messages from the game socket.
  useEffect(() => {
    let cancelled = false;
    api<ChatHistoryDTO>(`/v1/live/chat/${encodeURIComponent(room)}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setUnread(0);
      })
      .catch(() => {});
    const off = onLiveChat((m) => {
      setData((d) => (d ? { ...d, messages: d.messages.some((x) => x.id === m.id) ? d.messages : [...d.messages, m].slice(-50) } : d));
      if (!openRef.current) setUnread((n) => Math.min(n + 1, 99));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [room]);

  useEffect(() => {
    if (open) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [open, data?.messages.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    try {
      const { message } = await api<{ message: ChatMessageDTO }>(`/v1/live/chat/${encodeURIComponent(room)}`, {
        method: "POST",
        body: { text: value },
      });
      setText("");
      setData((d) => (d && !d.messages.some((x) => x.id === message.id) ? { ...d, messages: [...d.messages, message].slice(-50) } : d));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <motion.button
        whileTap={tap}
        transition={tapTransition}
        onClick={() => {
          setOpen((o) => !o);
          setUnread(0);
        }}
        aria-label={unread ? `Chat, ${unread} new` : "Chat"}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-[var(--radius-ui)] text-fg-muted transition-colors hairline hover:text-fg"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <path d="M4 5h16v11H9l-5 4V5Z" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-loss px-1 text-[10px] font-semibold text-white tabular">
            {unread}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.aside
            key="chat"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: expoOut }}
            aria-label="Room chat"
            className="fixed inset-x-2 bottom-2 z-40 flex h-[min(70dvh,560px)] flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[0_12px_48px_rgba(0,0,0,0.6)] hairline sm:inset-x-auto sm:right-4 sm:top-20 sm:bottom-4 sm:h-auto sm:w-[340px]"
          >
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <p className="text-[14px] font-semibold">Room chat</p>
              <button onClick={() => setOpen(false)} aria-label="Close chat" className="text-fg-muted hover:text-fg">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div ref={list} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3" aria-live="polite">
              {!data ? (
                <p className="m-auto text-[13px] text-fg-muted">Loading…</p>
              ) : data.messages.length === 0 ? (
                <p className="m-auto max-w-[220px] text-center text-[13px] text-fg-muted">Quiet in here. Say hi to the table.</p>
              ) : (
                data.messages.map((m) => (
                  <div key={m.id} className="text-[13px] leading-snug">
                    <span className="font-semibold" style={{ color: hue(m.userId) }}>
                      {m.name}
                      {m.userId === me?.user.id && <span className="font-normal text-fg-muted"> (you)</span>}
                    </span>
                    <span className="ml-1.5 text-[10px] text-fg-disabled tabular">{timeFmt.format(new Date(m.at))}</span>
                    <p className="break-words text-fg">{m.text}</p>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-hairline p-3">
              {data && !data.canPost ? (
                <p className="text-center text-[13px] text-fg-muted">
                  {data.reason === "muted" ? (
                    "You've been muted in chat."
                  ) : (
                    <>
                      <Link href="/sign-up" className="text-fg underline underline-offset-4">
                        Create a free account
                      </Link>{" "}
                      to chat.
                    </>
                  )}
                </p>
              ) : (
                <form onSubmit={send} className="flex gap-2">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={CHAT_MAX_LENGTH}
                    placeholder="Message"
                    aria-label="Message"
                    className="h-10 min-w-0 flex-1 rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] outline-none hairline focus:border-fg/40"
                  />
                  <button
                    type="submit"
                    disabled={!text.trim() || sending}
                    className={cn(
                      "h-10 rounded-[var(--radius-ui)] bg-fg px-4 text-[13px] font-semibold text-bg transition-opacity",
                      (!text.trim() || sending) && "opacity-40",
                    )}
                  >
                    Send
                  </button>
                </form>
              )}
              {error && (
                <p role="alert" className="mt-1.5 text-[12px] text-loss">
                  {error}
                </p>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
