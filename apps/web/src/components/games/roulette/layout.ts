import { ROULETTE_BETS, pocketColor } from "@snakeland/shared";

/**
 * Betting board geometry in abstract units. Horizontal layout is 14 × 5:
 * zero at x=0, numbers in 12 columns × 3 rows, "2:1" at x=13, dozens on
 * row 3 and even-money bets on row 4. The vertical (phone) layout is the
 * same board turned: (x, y, w, h) → (5 − y − h, x, h, w).
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardItem extends Rect {
  betId: string;
  kind: "cell" | "hot";
  label?: string;
  tone?: "red" | "black" | "zero" | "plain";
}

const HOT = 0.36;
const pos = (n: number) => ({ c: Math.floor((n - 1) / 3), r: (n - 1) % 3 });
const hot = (betId: string, px: number, py: number): BoardItem => ({
  betId,
  kind: "hot",
  x: px - HOT / 2,
  y: py - HOT / 2,
  w: HOT,
  h: HOT,
});
const idOf = (kind: string, nums: number[]) => {
  const id = `${kind}:${[...nums].sort((a, b) => a - b).join("-")}`;
  if (!ROULETTE_BETS.has(id)) throw new Error(`layout references unknown bet ${id}`);
  return id;
};

function horizontal(): BoardItem[] {
  const items: BoardItem[] = [];
  items.push({ betId: "straight:0", kind: "cell", x: 0, y: 0, w: 1, h: 3, label: "0", tone: "zero" });
  for (let n = 1; n <= 36; n++) {
    const { c, r } = pos(n);
    items.push({ betId: `straight:${n}`, kind: "cell", x: 1 + c, y: 2 - r, w: 1, h: 1, label: String(n), tone: pocketColor(n) as "red" | "black" });
  }
  for (const k of [1, 2, 3]) items.push({ betId: `column:${k}`, kind: "cell", x: 13, y: 3 - k, w: 1, h: 1, label: "2:1", tone: "plain" });
  const dozens = ["1st 12", "2nd 12", "3rd 12"];
  dozens.forEach((label, i) => items.push({ betId: `dozen:${i + 1}`, kind: "cell", x: 1 + i * 4, y: 3, w: 4, h: 1, label, tone: "plain" }));
  const outside: Array<[string, string]> = [["low", "1–18"], ["even", "Even"], ["red", "Red"], ["black", "Black"], ["odd", "Odd"], ["high", "19–36"]];
  outside.forEach(([id, label], i) => items.push({ betId: id, kind: "cell", x: 1 + i * 2, y: 4, w: 2, h: 1, label, tone: "plain" }));

  // Inside-bet hotspots on the borders and corners between numbers.
  for (let n = 1; n <= 36; n++) {
    const { c, r } = pos(n);
    if (r < 2) items.push(hot(idOf("split", [n, n + 1]), 1.5 + c, 2 - r)); // shared horizontal edge
    if (c < 11) items.push(hot(idOf("split", [n, n + 3]), 2 + c, 2.5 - r)); // shared vertical edge
    if (c < 11 && r < 2) items.push(hot(idOf("corner", [n, n + 1, n + 3, n + 4]), 2 + c, 2 - r));
  }
  for (let c = 0; c < 12; c++) {
    const b = c * 3 + 1;
    items.push(hot(idOf("street", [b, b + 1, b + 2]), 1.5 + c, 3));
    if (c < 11) items.push(hot(idOf("line", [b, b + 1, b + 2, b + 3, b + 4, b + 5]), 2 + c, 3));
  }
  for (const n of [1, 2, 3]) items.push(hot(idOf("split", [0, n]), 1, 2.5 - (n - 1)));
  items.push(hot(idOf("trio", [0, 1, 2]), 1, 2));
  items.push(hot(idOf("trio", [0, 2, 3]), 1, 1));
  items.push(hot(idOf("first-four", [0, 1, 2, 3]), 1, 3));
  return items;
}

export const HORIZONTAL = { width: 14, height: 5, items: horizontal() };
export const VERTICAL = {
  width: 5,
  height: 14,
  items: HORIZONTAL.items.map((it) => ({ ...it, x: 5 - it.y - it.h, y: it.x, w: it.h, h: it.w })),
};
