"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  LAB_CATEGORIES,
  LAB_FLAG_RE,
  LAB_TRACK_BONUS_PCT,
  type LabCategory,
  type LabChallengeDTO,
  type LabDifficulty,
  type LabListDTO,
  type LabHintResultDTO,
  type LabSubmitResultDTO,
} from "@snakeland/shared";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState } from "@/components/ErrorState";
import { Segmented } from "@/components/Segmented";
import { CardGridSkeleton } from "@/components/Skeleton";
import { Button, ButtonLink, Card, Sheet } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { expoOut, fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";

const CATEGORY_LABEL: Record<LabCategory, string> = { crypto: "Crypto", web: "Web", forensics: "Forensics", casino: "Casino", misc: "Misc" };
const CATEGORY_COLOUR: Record<LabCategory, string> = { crypto: "#a78bfa", web: "#38bdf8", forensics: "#f5a524", casino: "#3ddc84", misc: "#f472b6" };
const DIFFICULTY_CLASS: Record<LabDifficulty, string> = {
  easy: "text-win",
  medium: "text-[#facc15]",
  hard: "text-[#fb923c]",
  insane: "text-loss",
};

function CategoryIcon({ category }: { category: LabCategory }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, "aria-hidden": true };
  switch (category) {
    case "crypto":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <circle cx="12" cy="16" r="1.3" fill="currentColor" />
        </svg>
      );
    case "web":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
        </svg>
      );
    case "forensics":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l5.5 5.5M8 10.5h5" />
        </svg>
      );
    case "casino":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <circle cx="9" cy="9" r="1.2" fill="currentColor" />
          <circle cx="15" cy="15" r="1.2" fill="currentColor" />
          <circle cx="15" cy="9" r="1.2" fill="currentColor" />
          <circle cx="9" cy="15" r="1.2" fill="currentColor" />
        </svg>
      );
    case "misc":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="18" cy="12" r="1.6" fill="currentColor" />
        </svg>
      );
  }
}

function ChallengeSheet({
  challenge,
  canPlay,
  onClose,
  onSolved,
  onHint,
}: {
  challenge: LabChallengeDTO | null;
  canPlay: boolean;
  onClose: () => void;
  onSolved: (slug: string, r: LabSubmitResultDTO) => void;
  onHint: (slug: string, index: number, r: LabHintResultDTO) => void;
}) {
  const [flag, setFlag] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [openingHint, setOpeningHint] = useState<number | null>(null);
  const { play } = useSettings();
  const c = challenge;

  const unlockHint = async (index: number) => {
    if (!c || openingHint !== null) return;
    setOpeningHint(index);
    try {
      const r = await api<LabHintResultDTO>(`/v1/lab/challenges/${encodeURIComponent(c.slug)}/hints/${index}`, { method: "POST", body: {} });
      onHint(c.slug, index, r);
    } catch {
      // Leave the hint locked; the reward is unchanged.
    } finally {
      setOpeningHint(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!c || pending) return;
    const value = flag.trim();
    if (!LAB_FLAG_RE.test(value)) return setStatus({ kind: "err", text: "Flags look like snk{...}" });
    setPending(true);
    setStatus(null);
    try {
      const r = await api<LabSubmitResultDTO>(`/v1/lab/challenges/${encodeURIComponent(c.slug)}/submit`, {
        method: "POST",
        body: { flag: value },
      });
      if (!r.correct) {
        play("lose");
        setStatus({ kind: "err", text: "Not quite. Keep digging." });
      } else {
        play("bigwin");
        setStatus({
          kind: "ok",
          text: r.reward
            ? `Solved! +${r.reward.toLocaleString()} chips` +
              (r.trackBonus ? ` · Track "${r.trackBonus.track}" complete: +${r.trackBonus.amount.toLocaleString()} bonus` : "")
            : "Correct. You've already been paid for this one.",
        });
        setFlag("");
        onSolved(c.slug, r);
      }
    } catch (err) {
      setStatus({
        kind: "err",
        text: err instanceof ApiError && err.status === 429 ? "Too many tries. Wait a minute." : err instanceof ApiError ? err.message : "Something went wrong",
      });
    } finally {
      setPending(false);
    }
  };

  const close = () => {
    setFlag("");
    setStatus(null);
    onClose();
  };

  return (
    <Sheet open={!!c} onClose={close} label={c?.title ?? "Challenge"} title={c?.title}>
      {c && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 hairline" style={{ color: CATEGORY_COLOUR[c.category] }}>
              <CategoryIcon category={c.category} />
              {CATEGORY_LABEL[c.category]}
            </span>
            <span className={cn("rounded-full px-2.5 py-1 font-medium capitalize hairline", DIFFICULTY_CLASS[c.difficulty])}>{c.difficulty}</span>
            <span className="rounded-full px-2.5 py-1 font-semibold tabular hairline">
              {c.effectiveReward.toLocaleString()}
              {c.effectiveReward < c.reward && <span className="font-normal text-fg-muted"> of {c.reward.toLocaleString()}</span>} chips
            </span>
            <span className="text-fg-muted">
              {c.solves} {c.solves === 1 ? "solve" : "solves"}
            </span>
          </div>
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-fg">{c.description}</p>

          {c.files.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">Files</p>
              <div className="flex flex-wrap gap-2">
                {c.files.map((f, i) =>
                  canPlay ? (
                    <a
                      key={f.name}
                      href={`/v1/lab/challenges/${encodeURIComponent(c.slug)}/files/${i}`}
                      download={f.name}
                      className="flex items-center gap-2 rounded-[var(--radius-ui)] px-3 py-2 font-mono text-[13px] transition-colors hairline hover:bg-elevated"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
                      </svg>
                      {f.name}
                    </a>
                  ) : (
                    <span key={f.name} className="rounded-[var(--radius-ui)] px-3 py-2 font-mono text-[13px] text-fg-disabled hairline">
                      {f.name}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}

          {c.hints.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">Hints</p>
              {c.hints.map((h, i) => {
                const prevOpen = i === 0 || c.hints[i - 1]!.text !== null;
                const open = h.text !== null;
                return open ? (
                  <motion.p key={i} {...fadeUp} className="rounded-[var(--radius-ui)] bg-elevated px-3 py-2 text-[13px] text-fg-muted">
                    <span className="font-medium text-fg">Hint {i + 1} · </span>
                    {h.text}
                  </motion.p>
                ) : (
                  <button
                    key={i}
                    disabled={!canPlay || !prevOpen || c.solved || openingHint !== null}
                    onClick={() => void unlockHint(i)}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-ui)] px-3 py-2 text-left text-[13px] transition-colors hairline enabled:hover:bg-elevated disabled:opacity-50"
                  >
                    <span>
                      Hint {i + 1}
                      {!prevOpen && !c.solved && <span className="text-fg-muted"> · open the previous one first</span>}
                    </span>
                    <span className="shrink-0 text-fg-muted">−{h.penalty}% reward</span>
                  </button>
                );
              })}
            </div>
          )}

          {!canPlay ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-ui)] p-4 text-center hairline">
              <p className="text-[14px]">The Lab is for registered players.</p>
              <p className="text-[13px] text-fg-muted">Create a free account to download files and claim rewards. Your guest chips come with you.</p>
              <ButtonLink href="/sign-up" className="mt-1">
                Create account
              </ButtonLink>
            </div>
          ) : c.solved && status?.kind !== "ok" ? (
            <p className="rounded-[var(--radius-ui)] bg-win/10 px-3 py-2.5 text-center text-[14px] font-medium text-win">Solved ✓</p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-2">
              <label htmlFor="lab-flag" className="text-[13px] text-fg-muted">
                Flag
              </label>
              <div className="flex gap-2">
                <input
                  id="lab-flag"
                  value={flag}
                  onChange={(e) => setFlag(e.target.value)}
                  placeholder="snk{...}"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={200}
                  className="h-11 min-w-0 flex-1 rounded-[var(--radius-ui)] bg-bg px-3 font-mono text-[14px] outline-none hairline focus:border-fg/40"
                />
                <Button type="submit" loading={pending} disabled={!flag.trim()}>
                  Submit
                </Button>
              </div>
              <AnimatePresence>
                {status && (
                  <motion.p {...fadeUp} role="status" className={cn("text-[13px]", status.kind === "ok" ? "text-win" : "text-loss")}>
                    {status.text}
                  </motion.p>
                )}
              </AnimatePresence>
            </form>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function LabView() {
  const { setWallet } = useSession();
  const [data, setData] = useState<LabListDTO | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<LabCategory | "all">("all");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [track, setTrack] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<LabListDTO>("/v1/lab/challenges")
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(false);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const onSolved = (slug: string, r: LabSubmitResultDTO) => {
    if (r.balance !== null) setWallet({ balance: r.balance });
    setData((d) =>
      d && {
        ...d,
        earned: d.earned + (r.reward ?? 0) + (r.trackBonus?.amount ?? 0),
        challenges: d.challenges.map((c) =>
          c.slug === slug ? { ...c, solved: true, solves: c.solves + (r.reward ? 1 : 0), hints: c.hints.map((h) => h) } : c,
        ),
      },
    );
  };

  const onHint = (slug: string, index: number, r: LabHintResultDTO) => {
    setData((d) =>
      d && {
        ...d,
        challenges: d.challenges.map((c) =>
          c.slug === slug
            ? { ...c, effectiveReward: r.effectiveReward, hints: c.hints.map((h, i) => (i === index ? { ...h, text: r.text } : h)) }
            : c,
        ),
      },
    );
  };

  const shown = data?.challenges.filter((c) => (filter === "all" || c.category === filter) && (!track || c.track === track)) ?? [];
  // Tracks group challenges; finishing every one pays a bonus on top.
  const tracks = [...new Set(data?.challenges.flatMap((c) => (c.track ? [c.track] : [])) ?? [])].map((name) => {
    const items = data!.challenges.filter((c) => c.track === name);
    return {
      name,
      total: items.length,
      done: items.filter((c) => c.solved).length,
      bonus: Math.floor((items.reduce((sum, c) => sum + c.reward, 0) * LAB_TRACK_BONUS_PCT) / 100),
    };
  });
  const solved = data?.challenges.filter((c) => c.solved).length ?? 0;
  const open = data?.challenges.find((c) => c.slug === openSlug) ?? null;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6 sm:px-6 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <motion.div {...fadeUp}>
            <h1 className="flex items-center gap-2.5 text-[32px] font-semibold leading-none">
              <span className="font-mono text-[26px] text-win" aria-hidden>
                &gt;_
              </span>
              The Lab
            </h1>
            <p className="mt-2 max-w-md text-[13px] text-fg-muted">
              Capture-the-flag puzzles: crack ciphers, poke at web pages, dig through logs. Every flag is unique to you and pays chips once.
            </p>
          </motion.div>
          {data && (
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-[22px] font-semibold tabular">
                  {solved}
                  <span className="text-fg-muted">/{data.challenges.length}</span>
                </p>
                <p className="text-[12px] text-fg-muted">solved</p>
              </div>
              <div>
                <p className="text-[22px] font-semibold text-win tabular">{data.earned.toLocaleString()}</p>
                <p className="text-[12px] text-fg-muted">chips earned</p>
              </div>
            </div>
          )}
        </div>

        {data && !data.canPlay && (
          <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px]">
              Look around freely. <span className="text-fg-muted">To download files and claim rewards, create a free account.</span>
            </p>
            <ButtonLink href="/sign-up" size="sm">
              Create account
            </ButtonLink>
          </Card>
        )}

        {tracks.length > 0 && (
          <div className="mt-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Tracks</p>
            <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
              {tracks.map((t) => {
                const complete = t.done === t.total;
                const active = track === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setTrack(active ? null : t.name)}
                    aria-pressed={active}
                    className={cn(
                      "flex min-w-[190px] flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-3.5 text-left transition-colors hairline hover:bg-elevated",
                      active && "border-fg/50 bg-elevated",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[14px] font-semibold">{t.name}</span>
                      <span className={cn("text-[12px] tabular", complete ? "text-win" : "text-fg-muted")}>
                        {t.done}/{t.total}
                      </span>
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-elevated">
                      <span className={cn("block h-full rounded-full", complete ? "bg-win" : "bg-gold")} style={{ width: `${(t.done / t.total) * 100}%` }} />
                    </span>
                    <span className="text-[12px] text-fg-muted">
                      {complete ? "Complete · bonus paid" : `Finish for +${t.bonus.toLocaleString()} bonus`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 overflow-x-auto">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[{ value: "all" as const, label: "All" }, ...LAB_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]}
          />
        </div>

        <div className="mt-4">
          {!data ? (
            error ? (
              <ErrorState title="Couldn’t load the Lab" onRetry={() => setReload((n) => n + 1)} />
            ) : (
              <CardGridSkeleton count={9} />
            )
          ) : shown.length === 0 ? (
            <EmptyState title="Nothing here yet" message="New challenges drop from time to time." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((c, i) => (
                <motion.button
                  key={c.slug}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: expoOut, delay: Math.min(i, 8) * 0.03 }}
                  onClick={() => setOpenSlug(c.slug)}
                  className={cn(
                    "group relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-card)] bg-surface p-4 text-left transition-colors hairline hover:bg-elevated",
                    c.solved && "opacity-80",
                  )}
                  style={{ borderColor: `color-mix(in srgb, ${CATEGORY_COLOUR[c.category]} 35%, transparent)` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12px]" style={{ color: CATEGORY_COLOUR[c.category] }}>
                      <CategoryIcon category={c.category} />
                      {CATEGORY_LABEL[c.category]}
                    </span>
                    {c.solved ? (
                      <span className="rounded-full bg-win/15 px-2 py-0.5 text-[11px] font-semibold text-win">Solved</span>
                    ) : (
                      <span className={cn("text-[12px] font-medium capitalize", DIFFICULTY_CLASS[c.difficulty])}>{c.difficulty}</span>
                    )}
                  </div>
                  <p className="text-[17px] font-semibold leading-tight">{c.title}</p>
                  <p className="line-clamp-2 text-[13px] text-fg-muted">{c.description}</p>
                  <div className="mt-auto flex items-center justify-between pt-1 text-[12px]">
                    <span className="font-semibold tabular">{c.effectiveReward.toLocaleString()} chips</span>
                    <span className="text-fg-muted tabular">
                      {c.solves} {c.solves === 1 ? "solve" : "solves"}
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </main>
      <ChallengeSheet challenge={open} canPlay={data?.canPlay ?? false} onClose={() => setOpenSlug(null)} onSolved={onSolved} onHint={onHint} />
    </div>
  );
}
