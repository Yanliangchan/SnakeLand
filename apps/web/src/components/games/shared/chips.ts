import { CHIP_VALUES, type ChipValue } from "@/components/ui";

export interface SlipChip {
  id: string;
  value: ChipValue;
}

let counter = 0;
export const chipId = (value: ChipValue) => `${value}-${++counter}`;

/** Greedy decomposition of an amount into tray denominations (largest first). */
export function chipsFor(amount: number): SlipChip[] {
  const out: SlipChip[] = [];
  let rest = amount;
  for (const v of [...CHIP_VALUES].reverse()) {
    while (rest >= v) {
      out.push({ id: chipId(v), value: v });
      rest -= v;
    }
  }
  return out;
}

export const sum = (chips: SlipChip[]) => chips.reduce((s, c) => s + c.value, 0);

/** Keep the felt stack readable: past this many chips, re-stack into larger denominations. */
export const MAX_STACK = 10;
