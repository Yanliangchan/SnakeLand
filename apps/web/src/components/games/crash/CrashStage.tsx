"use client";

import { useEffect, useRef } from "react";
import { CRASH_RATE, crashTimeFor, type CrashBetPublicDTO, type CrashRoundDTO } from "@snakeland/shared";
import { useSettings } from "@/providers/settings";

const SNAKE = { body: "#1b8f4e", bright: "#3ddc84", scale: "#0f5c31", dead: "#d4403a", deadDark: "#7a1f1b" };
const SHAKE_MS = 450;
const TICKS = [1, 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

/** The multiplier the round shows at `now` (server clock), plus the flight time it corresponds to. */
export function liveMultiplier(round: CrashRoundDTO | null, serverNow: number) {
  if (!round) return { m: 1, elapsed: 0 };
  if (round.phase === "crashed" && round.crashX100) return { m: round.crashX100 / 100, elapsed: crashTimeFor(round.crashX100) };
  const elapsed = serverNow - new Date(round.startsAt).getTime();
  if (elapsed <= 0) return { m: 1, elapsed: 0 };
  return { m: Math.exp(CRASH_RATE * elapsed), elapsed };
}

/**
 * The crash graph: a snake slithering up the multiplier curve. Drawn on a
 * canvas with requestAnimationFrame, and only while something moves; a
 * settled screen costs nothing. The big number is written straight into the
 * DOM each frame, so React doesn't re-render 60 times a second.
 */
export function CrashStage({
  round,
  offsetMs,
  bets,
  myCashoutX100,
}: {
  round: CrashRoundDTO | null;
  offsetMs: React.RefObject<number>;
  bets: CrashBetPublicDTO[];
  myCashoutX100: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLParagraphElement>(null);
  const sub = useRef<HTMLParagraphElement>(null);
  const { reducedMotion } = useSettings();
  const props = useRef({ round, bets, myCashoutX100, reducedMotion });
  useEffect(() => {
    props.current = { round, bets, myCashoutX100, reducedMotion };
  });

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    let raf = 0;
    let crashSeenAt = 0;
    let lastRound = "";

    const size = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(r.width * dpr);
      el.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return r;
    };
    let box = size();

    const draw = (clock: number) => {
      const { round, bets, myCashoutX100, reducedMotion } = props.current;
      const now = Date.now() + (offsetMs.current ?? 0);
      const W = box.width;
      const H = box.height;
      ctx.clearRect(0, 0, W, H);
      if (!round) return false;
      if (round.id !== lastRound) {
        lastRound = round.id;
        crashSeenAt = 0;
      }

      const crashed = round.phase === "crashed";
      if (crashed && !crashSeenAt) crashSeenAt = clock;
      const { m, elapsed } = liveMultiplier(round, now);
      const betting = !crashed && elapsed <= 0;

      // --- Text overlay
      if (big.current && sub.current) {
        if (betting) {
          const left = Math.max(0, new Date(round.startsAt).getTime() - now) / 1000;
          big.current.textContent = `${left.toFixed(1)}s`;
          big.current.dataset.tone = "muted";
          sub.current.textContent = "Place your bets";
        } else {
          big.current.textContent = `${m.toFixed(2)}×`;
          big.current.dataset.tone = crashed ? "loss" : myCashoutX100 ? "win" : "fg";
          sub.current.textContent = crashed
            ? "Bitten!"
            : myCashoutX100
              ? `You cashed out at ${(myCashoutX100 / 100).toFixed(2)}×`
              : "";
        }
      }

      // --- Scale
      const pad = { l: 44, r: 20, t: 18, b: 26 };
      const tMax = Math.max(elapsed * 1.08, 10_000);
      const mMax = Math.max(m * 1.18, 2);
      const x = (t: number) => pad.l + (t / tMax) * (W - pad.l - pad.r);
      const y = (v: number) => H - pad.b - ((v - 1) / (mMax - 1)) * (H - pad.t - pad.b);

      // Grid lines at round multipliers.
      ctx.font = "11px Inter Variable, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      const shown = TICKS.filter((t) => t <= mMax);
      const step = Math.ceil(shown.length / 5);
      shown.forEach((t, i) => {
        if (i % step !== 0 && i !== shown.length - 1) return;
        const yy = y(t);
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.l, yy);
        ctx.lineTo(W - pad.r, yy);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillText(`${t}×`, 8, yy);
      });

      // Coiled at the start while betting is open.
      const shake = crashed && !reducedMotion ? Math.max(0, 1 - (clock - crashSeenAt) / SHAKE_MS) : 0;
      const jx = shake ? Math.sin(clock / 18) * 4 * shake : 0;
      const jy = shake ? Math.cos(clock / 23) * 3 * shake : 0;
      const lw = Math.max(6, Math.min(14, W / 70));

      const pts: Array<[number, number]> = [];
      const n = 72;
      for (let i = 0; i <= n; i++) {
        const t = (elapsed * i) / n;
        pts.push([x(t) + jx, y(Math.exp(CRASH_RATE * t)) + jy]);
      }

      if (!betting) {
        // Soft glow under the curve.
        const fill = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
        fill.addColorStop(0, crashed ? "rgba(212,64,58,0.18)" : "rgba(61,220,132,0.18)");
        fill.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.moveTo(pts[0]![0], H - pad.b);
        for (const [px, py] of pts) ctx.lineTo(px, py);
        ctx.lineTo(pts[n]![0], H - pad.b);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();

        // Body.
        const body = ctx.createLinearGradient(pad.l, 0, pts[n]![0], 0);
        body.addColorStop(0, crashed ? SNAKE.deadDark : SNAKE.scale);
        body.addColorStop(1, crashed ? SNAKE.dead : SNAKE.bright);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = body;
        ctx.lineWidth = lw;
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
        // Scales.
        ctx.setLineDash([2, lw * 0.9]);
        ctx.lineDashOffset = crashed || reducedMotion ? 0 : -clock / 40;
        ctx.strokeStyle = crashed ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.28)";
        ctx.lineWidth = lw * 0.45;
        ctx.stroke();
        ctx.setLineDash([]);

        // Cash-out flags along the body.
        const flags = bets.filter((b) => b.cashoutX100 !== null && b.cashoutX100 / 100 <= m).slice(0, 8);
        ctx.font = "600 11px Inter Variable, system-ui, sans-serif";
        for (const b of flags) {
          const v = b.cashoutX100! / 100;
          const fx = x(crashTimeFor(b.cashoutX100!)) + jx;
          const fy = y(v) + jy;
          ctx.fillStyle = b.isMe ? "#fafafa" : "rgba(250,250,250,0.7)";
          ctx.beginPath();
          ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillText(`${b.name.slice(0, 12)} ${v.toFixed(2)}×`, fx + 7, fy - 10);
        }
      }

      // Head.
      const [hx, hy] = pts[n]!;
      const [px, py] = pts[Math.max(0, n - 3)]!;
      const angle = betting ? -Math.PI / 5 : Math.atan2(hy - py, hx - px);
      ctx.save();
      ctx.translate(betting ? pad.l + jx : hx, betting ? H - pad.b + jy : hy);
      ctx.rotate(angle);
      // Tongue flicks while it's alive.
      if (!crashed) {
        const flick = reducedMotion ? 0.6 : Math.max(0, Math.sin(clock / 160));
        if (flick > 0.05) {
          const len = lw * 1.1 * flick;
          ctx.strokeStyle = "#ff4d4d";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(lw * 1.1, 0);
          ctx.lineTo(lw * 1.1 + len, 0);
          ctx.lineTo(lw * 1.1 + len + 4, -3);
          ctx.moveTo(lw * 1.1 + len, 0);
          ctx.lineTo(lw * 1.1 + len + 4, 3);
          ctx.stroke();
        }
      }
      ctx.fillStyle = crashed ? SNAKE.dead : SNAKE.bright;
      ctx.beginPath();
      ctx.ellipse(0, 0, lw * 1.25, lw * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes (crosses once it has crashed).
      for (const side of [-1, 1]) {
        const ex = lw * 0.45;
        const ey = side * lw * 0.38;
        if (crashed) {
          ctx.strokeStyle = "#0a0a0a";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ex - 2.5, ey - 2.5);
          ctx.lineTo(ex + 2.5, ey + 2.5);
          ctx.moveTo(ex + 2.5, ey - 2.5);
          ctx.lineTo(ex - 2.5, ey + 2.5);
          ctx.stroke();
        } else {
          ctx.fillStyle = "#fafafa";
          ctx.beginPath();
          ctx.arc(ex, ey, lw * 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#0a0a0a";
          ctx.beginPath();
          ctx.arc(ex + lw * 0.07, ey, lw * 0.11, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // Keep animating while live, during the shake, and while counting down.
      return !crashed || shake > 0;
    };

    const loop = (clock: number) => {
      raf = draw(clock) ? requestAnimationFrame(loop) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    kick();
    const ro = new ResizeObserver(() => {
      box = size();
      if (!raf) draw(performance.now());
    });
    ro.observe(el);
    const onKick = () => kick();
    el.addEventListener("crash:kick", onKick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("crash:kick", onKick);
    };
  }, [offsetMs]);

  // A new round or phase restarts the animation loop if it had stopped.
  useEffect(() => {
    canvas.current?.dispatchEvent(new Event("crash:kick"));
  }, [round?.id, round?.phase, bets, myCashoutX100]);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center" aria-live="polite">
          <p
            ref={big}
            className="text-[clamp(40px,14cqw,96px)] font-semibold leading-none tracking-[-0.04em] tabular data-[tone=fg]:text-fg data-[tone=loss]:text-loss data-[tone=muted]:text-fg-muted data-[tone=win]:text-win"
          />
          <p ref={sub} className="mt-2 h-5 text-[14px] text-fg-muted" />
        </div>
      </div>
    </div>
  );
}
