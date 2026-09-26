/**
 * Board geometry in SVG user units (width 1000). Row i has i + 3 pegs; the
 * last row's R + 2 pegs frame R + 1 buckets. A ball that has gone right r
 * times after i rows sits at x = centre + (r - i/2) * spacing.
 */
export const WIDTH = 1000;

export function geometry(rows: number) {
  const s = WIDTH / (rows + 2);
  const rowH = s * 0.86;
  const top = s * 0.9;
  const pegR = s * 0.085;
  const ballR = s * 0.2;
  const bucketY = top + (rows - 1) * rowH + rowH * 0.62;
  const bucketH = s * 0.62;
  const height = bucketY + bucketH + s * 0.2;
  const cx = WIDTH / 2;

  const pegs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < i + 3; j++) pegs.push({ x: cx + (j - (i + 2) / 2) * s, y: top + i * rowH });
  }
  const buckets = Array.from({ length: rows + 1 }, (_, k) => ({ x: cx + (k - rows / 2) * s, w: s * 0.9 }));

  /** Keyframes: fall onto the first peg, then per row bounce up and across onto the next. */
  function path(bits: readonly (0 | 1)[]) {
    const xs: number[] = [cx];
    const ys: number[] = [top - s * 1.1];
    let r = 0;
    for (let i = 0; i < rows; i++) {
      const hitX = cx + (r - i / 2) * s;
      const hitY = top + i * rowH - pegR - ballR;
      xs.push(hitX);
      ys.push(hitY);
      r += bits[i]!;
      const nextX = cx + (r - (i + 1) / 2) * s;
      xs.push((hitX + nextX) / 2);
      ys.push(hitY - s * 0.3);
    }
    xs.push(cx + (r - rows / 2) * s);
    ys.push(bucketY + bucketH * 0.35);
    return { xs, ys };
  }

  return { s, rowH, top, pegR, ballR, bucketY, bucketH, height, pegs, buckets, path };
}

/** Compact bucket label: 1010 → "1K", 13 → "13", 0.5 → "0.5". */
export function bucketLabel(x100: number): string {
  const x = x100 / 100;
  if (x >= 1000) return `${Math.round(x / 100) / 10}K`;
  if (x >= 10) return String(Math.round(x));
  return String(Math.round(x * 10) / 10);
}
