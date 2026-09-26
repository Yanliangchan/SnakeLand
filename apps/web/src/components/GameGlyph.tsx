import type { GameId } from "@snakeland/shared";

/** Monochrome line glyphs for lobby tiles. */
export function GameGlyph({ game, size = 28 }: { game: GameId; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 28 28",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (game) {
    case "blackjack":
      return (
        <svg {...common}>
          <rect x="4" y="6" width="12" height="17" rx="2" transform="rotate(-8 10 14)" />
          <rect x="12" y="5" width="12" height="17" rx="2" transform="rotate(8 18 13)" />
        </svg>
      );
    case "mines":
      return (
        <svg {...common}>
          {[4, 11, 18].flatMap((x) =>
            [4, 11, 18].map((y) =>
              x === 11 && y === 11 ? (
                <circle key={`${x}${y}`} cx="14" cy="14" r="2.5" fill="currentColor" />
              ) : (
                <rect key={`${x}${y}`} x={x} y={y} width="6" height="6" rx="1.5" />
              ),
            ),
          )}
        </svg>
      );
    case "plinko":
      return (
        <svg {...common}>
          {[
            [14, 5],
            [10, 11],
            [18, 11],
            [6, 17],
            [14, 17],
            [22, 17],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" stroke="none" />
          ))}
          <circle cx="12" cy="23" r="2.5" />
        </svg>
      );
    case "baccarat":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="9" height="14" rx="2" />
          <rect x="16" y="7" width="9" height="14" rx="2" />
          <path d="M14 11v6" />
        </svg>
      );
    case "roulette":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="10" />
          <circle cx="14" cy="14" r="5" />
          <path d="M14 4v5M14 19v5M4 14h5M19 14h5" />
        </svg>
      );
    case "crash":
      return (
        <svg {...common}>
          <path d="M4 23h20" strokeOpacity="0.4" />
          <path d="M4 22c7 0 12-3 17-15" />
          <circle cx="21" cy="7" r="1.8" fill="currentColor" />
        </svg>
      );
    case "carrier":
      return (
        <svg {...common}>
          <path d="M3 21h16l-2 3H6z" />
          <path d="M9 13l4-1 7-5c1.2-.8 2.6.6 1.8 1.8l-5 7-1 4-2-3-3-2z" />
        </svg>
      );
    case "tower":
      return (
        <svg {...common}>
          <rect x="6" y="4" width="16" height="20" rx="1.5" />
          <path d="M6 10.5h16M6 17h16" />
          <rect x="12" y="19" width="4" height="5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "crossing":
      return (
        <svg {...common}>
          <path d="M4 4v20M24 4v20" />
          <path d="M11 5v3M11 12v3M11 19v3M17 5v3M17 12v3M17 19v3" strokeOpacity="0.5" />
        </svg>
      );
  }
}
