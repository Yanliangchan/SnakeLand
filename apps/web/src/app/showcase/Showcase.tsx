"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useRef, useState } from "react";
import { Wordmark } from "@/components/AppHeader";
import {
  BalanceCounter,
  Button,
  Card,
  Chip,
  CHIP_VALUES,
  PlayingCard,
  WinCelebration,
  type ChipValue,
} from "@/components/ui";
import type { Card as CardCode } from "@snakeland/shared";
import { tableSwitch } from "@/lib/motion";
import { useSettings } from "@/providers/settings";

const DEMO_CARDS: CardCode[] = ["AS", "KH", "7D", "TC"];

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-5">
      <p className="text-[13px] text-fg-muted">
        <span className="tabular">{n}.</span> {title}
      </p>
      {children}
    </Card>
  );
}

export function Showcase() {
  const { play } = useSettings();
  const [balance, setBalance] = useState(10_000);
  const [dealt, setDealt] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [table, setTable] = useState(1);
  const [result, setResult] = useState<{ id: number; multiplier: number } | null>(null);

  // Chip placement: the tray chip's id moves to the felt, and the tray gets a fresh id.
  const seq = useRef(0);
  const [tray, setTray] = useState(
    () => Object.fromEntries(CHIP_VALUES.map((v) => [v, `${v}-init`])) as Record<ChipValue, string>,
  );
  const [felt, setFelt] = useState<Array<{ id: string; value: ChipValue }>>([]);

  function placeChip(value: ChipValue) {
    play("click");
    setFelt((f) => [...f, { id: tray[value], value }]);
    setTray((t) => ({ ...t, [value]: `${value}-${seq.current++}` }));
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <span className="text-[13px] text-fg-muted">Design system · dev only</span>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pb-24 pt-6 sm:px-6">
        <Section n={1} title="Button press">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
          </div>
        </Section>

        <Section n={2} title="Balance counter">
          <p className="text-[40px] font-semibold tracking-[-0.03em]">
            <BalanceCounter value={balance} />
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setBalance((b) => Math.max(0, b - 1_250))}>
              −1,250
            </Button>
            <Button variant="secondary" onClick={() => setBalance((b) => b + 48_730)}>
              +48,730
            </Button>
          </div>
        </Section>

        <Section n={3} title="Card deal">
          <div className="flex min-h-[112px] gap-2">
            <AnimatePresence>
              {DEMO_CARDS.slice(0, dealt).map((c, i) => (
                <PlayingCard key={c} card={i === 3 && !revealed ? null : c} i={i} />
              ))}
            </AnimatePresence>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => {
                play("flip");
                setDealt(DEMO_CARDS.length);
              }}
            >
              Deal
            </Button>
            <Button variant="secondary" disabled={dealt === 0} onClick={() => setRevealed((r) => !r)}>
              Flip hole card
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDealt(0);
                setRevealed(false);
              }}
            >
              Clear
            </Button>
          </div>
        </Section>

        <Section n={4} title="Chip placement (shared layoutId)">
          <LayoutGroup>
            <div className="grid min-h-[120px] place-items-center rounded-[var(--radius-ui)] bg-bg hairline">
              <div className="flex flex-wrap justify-center gap-1.5 p-4">
                {felt.map((c) => (
                  <Chip key={c.id} chipId={c.id} value={c.value} size={36} />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {CHIP_VALUES.map((v) => (
                <Chip key={tray[v]} chipId={tray[v]} value={v} onClick={() => placeChip(v)} />
              ))}
              <Button variant="ghost" size="sm" onClick={() => setFelt([])}>
                Clear
              </Button>
            </div>
          </LayoutGroup>
        </Section>

        <Section n={5} title="Table switch">
          <div className="h-24 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={table}
                {...tableSwitch}
                className="grid h-full place-items-center rounded-[var(--radius-ui)] bg-bg hairline"
              >
                <span className="text-[15px] font-medium tabular">Table {table}</span>
              </motion.div>
            </AnimatePresence>
          </div>
          <div>
            <Button variant="secondary" onClick={() => setTable((t) => t + 1)}>
              Next table
            </Button>
          </div>
        </Section>

        <Section n={6} title="Win celebration (only above 2×)">
          <WinCelebration trigger={result?.id ?? null} multiplier={result?.multiplier ?? 0} className="w-fit">
            <AnimatePresence mode="wait">
              <motion.p
                key={result?.id ?? "none"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`text-[32px] font-semibold tabular ${result ? "text-win" : "text-fg-disabled"}`}
              >
                {result ? `${result.multiplier.toFixed(2)}×` : "—"}
              </motion.p>
            </AnimatePresence>
          </WinCelebration>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setResult((r) => ({ id: (r?.id ?? 0) + 1, multiplier: 1.5 }))}>
              Small win 1.5×
            </Button>
            <Button onClick={() => setResult((r) => ({ id: (r?.id ?? 0) + 1, multiplier: 5 }))}>Big win 5×</Button>
          </div>
        </Section>
      </main>
    </div>
  );
}
