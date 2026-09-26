export const GAME_IDS = ["blackjack", "mines", "plinko", "baccarat", "roulette", "crash"] as const;
export type GameId = (typeof GAME_IDS)[number];

export type GameKind = "table" | "instant" | "live";

export interface GameMeta {
  id: GameId;
  name: string;
  tagline: string;
  kind: GameKind;
  /** Table games get a fresh table_id per session and support "next table". */
  usesTables: boolean;
  available: boolean;
}

export const GAMES: Record<GameId, GameMeta> = {
  blackjack: {
    id: "blackjack",
    name: "Blackjack",
    tagline: "Six-deck shoe. Dealer stands on 17.",
    kind: "table",
    usesTables: true,
    available: true,
  },
  mines: {
    id: "mines",
    name: "Mines",
    tagline: "Pick safe tiles. Cash out anytime.",
    kind: "instant",
    usesTables: false,
    available: true,
  },
  plinko: {
    id: "plinko",
    name: "Plinko",
    tagline: "Drop the ball. Watch it land.",
    kind: "instant",
    usesTables: false,
    available: true,
  },
  baccarat: {
    id: "baccarat",
    name: "Baccarat",
    tagline: "Player, banker, or tie.",
    kind: "table",
    usesTables: true,
    available: true,
  },
  roulette: {
    id: "roulette",
    name: "Roulette",
    tagline: "European single zero.",
    kind: "table",
    usesTables: true,
    available: true,
  },
  crash: {
    id: "crash",
    name: "Crash",
    tagline: "Ride the snake. Cash out before it bites.",
    kind: "live",
    usesTables: false,
    available: true,
  },
};

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && (GAME_IDS as readonly string[]).includes(value);
}
