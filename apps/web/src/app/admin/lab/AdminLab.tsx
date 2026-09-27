"use client";

import { useEffect, useState } from "react";
import {
  LAB_CATEGORIES,
  LAB_DIFFICULTIES,
  LAB_PLACEHOLDERS,
  LAB_REWARDS,
  type AdminLabChallengeDTO,
  type AdminLabChallengeInput,
  type LabCategory,
  type LabDifficulty,
  type LabFlagMode,
} from "@snakeland/shared";
import { ErrorState } from "@/components/ErrorState";
import { Button, Card, Toggle } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAdminExpired } from "../AdminFrame";

const blank = (): AdminLabChallengeInput => ({
  slug: "",
  title: "",
  category: "crypto",
  difficulty: "easy",
  description: "",
  hint: null,
  reward: LAB_REWARDS.easy,
  flagMode: "static",
  flag: "",
  files: [],
  published: false,
  sortOrder: 1000,
});

const input = "h-10 w-full rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] outline-none hairline focus:border-fg/40";
const area = "w-full rounded-[var(--radius-ui)] bg-bg px-3 py-2 text-[14px] outline-none hairline focus:border-fg/40";

function Label({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-fg-muted">{text}</span>
      {children}
    </label>
  );
}

function Editor({
  initial,
  id,
  hasStaticFlag,
  onDone,
  onCancel,
}: {
  initial: AdminLabChallengeInput;
  id: string | null;
  hasStaticFlag: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const expired = useAdminExpired();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = <K extends keyof AdminLabChallengeInput>(k: K, value: AdminLabChallengeInput[K]) => setV((s) => ({ ...s, [k]: value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = { ...v, hint: v.hint?.trim() ? v.hint : null, flag: v.flag?.trim() || undefined };
    try {
      if (id) await adminApi.labUpdate(id, body);
      else await adminApi.labCreate(body);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return expired();
      setError(err instanceof ApiError ? err.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">{id ? `Edit ${initial.title}` : "New challenge"}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Title">
            <input className={input} value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={80} required />
          </Label>
          <Label text="Slug (URL name)">
            <input
              className={cn(input, "font-mono")}
              value={v.slug}
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              maxLength={48}
              required
            />
          </Label>
          <Label text="Category">
            <select className={input} value={v.category} onChange={(e) => set("category", e.target.value as LabCategory)}>
              {LAB_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Difficulty">
            <select
              className={input}
              value={v.difficulty}
              onChange={(e) => {
                const d = e.target.value as LabDifficulty;
                setV((s) => ({ ...s, difficulty: d, reward: LAB_REWARDS[d] }));
              }}
            >
              {LAB_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Reward (chips)">
            <input
              className={cn(input, "tabular")}
              type="number"
              min={1}
              max={100000}
              value={v.reward}
              onChange={(e) => set("reward", Math.max(1, Math.floor(Number(e.target.value) || 0)))}
            />
          </Label>
          <Label text="Sort order (low first)">
            <input
              className={cn(input, "tabular")}
              type="number"
              min={0}
              value={v.sortOrder}
              onChange={(e) => set("sortOrder", Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
          </Label>
        </div>
        <Label text="Description">
          <textarea className={area} rows={5} value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} required />
        </Label>
        <Label text="Hint (optional)">
          <input className={input} value={v.hint ?? ""} onChange={(e) => set("hint", e.target.value)} maxLength={500} />
        </Label>

        <div className="flex flex-col gap-2 rounded-[var(--radius-ui)] p-3 hairline">
          <div className="flex flex-wrap gap-2 text-[13px]">
            {(["static", "per_player"] as LabFlagMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set("flagMode", m)}
                className={cn("rounded-full px-3 py-1", v.flagMode === m ? "bg-fg text-bg" : "text-fg-muted hairline")}
              >
                {m === "static" ? "One flag for everyone" : "Unique flag per player"}
              </button>
            ))}
          </div>
          {v.flagMode === "static" ? (
            <Label text={hasStaticFlag ? "Flag (leave empty to keep the current one; it's stored hashed)" : "Flag, e.g. snk{my_flag}"}>
              <input
                className={cn(input, "font-mono")}
                value={v.flag ?? ""}
                onChange={(e) => set("flag", e.target.value)}
                placeholder={hasStaticFlag ? "••••••••" : "snk{...}"}
                autoComplete="off"
              />
            </Label>
          ) : (
            <p className="text-[12px] leading-relaxed text-fg-muted">
              Files are templates. Each player sees their own flag wherever you put a placeholder:{" "}
              {LAB_PLACEHOLDERS.map((p) => (
                <code key={p} className="mr-1 rounded bg-elevated px-1 py-0.5 font-mono text-[11px] text-fg">
                  {p}
                </code>
              ))}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-fg-muted">Files ({v.files.length}/5)</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={v.files.length >= 5}
              onClick={() => set("files", [...v.files, { name: `file${v.files.length + 1}.txt`, content: "" }])}
            >
              Add file
            </Button>
          </div>
          {v.files.map((f, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-[var(--radius-ui)] p-3 hairline">
              <div className="flex gap-2">
                <input
                  className={cn(input, "font-mono")}
                  value={f.name}
                  onChange={(e) =>
                    set(
                      "files",
                      v.files.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9._-]/g, "_") } : x)),
                    )
                  }
                  maxLength={64}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => set("files", v.files.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
              <textarea
                className={cn(area, "font-mono text-[12px]")}
                rows={4}
                value={f.content}
                onChange={(e) => set("files", v.files.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))}
                maxLength={100000}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[13px]">
            <Toggle checked={v.published} onChange={(on) => set("published", on)} label="Published" />
            {v.published ? "Published" : "Draft"}
          </span>
          <div className="flex items-center gap-3">
            {error && (
              <p role="alert" className="text-[13px] text-loss">
                {error}
              </p>
            )}
            <Button type="submit" loading={pending}>
              {id ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

export function AdminLab() {
  const expired = useAdminExpired();
  const [items, setItems] = useState<AdminLabChallengeDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<AdminLabChallengeDTO | "new" | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .lab()
      .then((r) => !cancelled && setItems(r.challenges))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) expired();
        else setError("Couldn't load challenges");
      });
    return () => {
      cancelled = true;
    };
  }, [reload, expired]);

  const refresh = () => {
    setEditing(null);
    setReload((n) => n + 1);
  };

  const remove = async (c: AdminLabChallengeDTO) => {
    if (!window.confirm(`Delete "${c.title}"? This can't be undone.`)) return;
    try {
      await adminApi.labDelete(c.id);
      refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return expired();
      window.alert(e instanceof ApiError ? e.message : "Couldn't delete");
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold">The Lab</h1>
          <p className="mt-1 text-[13px] text-fg-muted">Challenges, rewards and flags. Each solve pays once per player.</p>
        </div>
        {!editing && <Button onClick={() => setEditing("new")}>New challenge</Button>}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {editing && (
          <Editor
            key={editing === "new" ? "new" : editing.id}
            id={editing === "new" ? null : editing.id}
            hasStaticFlag={editing !== "new" && editing.hasStaticFlag}
            initial={editing === "new" ? blank() : { ...editing, flag: "" }}
            onDone={refresh}
            onCancel={() => setEditing(null)}
          />
        )}
        {!items ? (
          error ? (
            <ErrorState title={error} onRetry={() => setReload((n) => n + 1)} />
          ) : (
            <p className="py-16 text-center text-[13px] text-fg-muted">Loading…</p>
          )
        ) : (
          <Card padded={false} className="overflow-hidden">
            <ul className="divide-y divide-hairline">
              {items.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[14px] font-medium">
                      {c.title}
                      {!c.published && <span className="rounded-full px-2 py-0.5 text-[10px] text-fg-muted hairline">Draft</span>}
                    </p>
                    <p className="text-[12px] text-fg-muted">
                      <span className="font-mono">{c.slug}</span> · {c.category} · {c.difficulty} · {c.reward.toLocaleString()} chips ·{" "}
                      {c.flagMode === "per_player" ? "per-player flag" : "static flag"} · {c.solves} solves
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(c)} disabled={c.solves > 0} title={c.solves > 0 ? "Solved challenges can only be unpublished" : undefined}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
