import type { GameId } from "@snakeland/shared";

/** One thin signature colour per game: card borders in the lobby, a hairline on the stage. */
export const GAME_ACCENT: Record<GameId, string> = {
  blackjack: "#2dd4bf",
  mines: "#f5a524",
  plinko: "#a78bfa",
  baccarat: "#38bdf8",
  roulette: "#f0524b",
  crash: "#3ddc84",
};

export interface GameHelp {
  /** The short first-visit tour: one line per step. */
  steps: string[];
  shortcuts: Array<[keys: string, action: string]>;
}

export const GAME_HELP: Record<GameId, GameHelp> = {
  blackjack: {
    steps: [
      "Tap chips to build your bet, then deal.",
      "Hit, stand, double or split. The dealer stands on all 17s.",
      "Blackjack pays 3:2. Insurance is offered when the dealer shows an ace.",
    ],
    shortcuts: [
      ["Enter", "Deal"],
      ["H", "Hit"],
      ["S", "Stand"],
      ["D", "Double"],
      ["P", "Split"],
      ["I / N", "Take / decline insurance"],
    ],
  },
  mines: {
    steps: [
      "Pick a board size and how many mines hide in it.",
      "Every safe tile raises the multiplier. More mines, faster growth.",
      "Cash out whenever you like. Hit a mine and the stake is gone.",
    ],
    shortcuts: [
      ["Enter", "Bet / cash out"],
      ["R", "Reveal a random tile"],
    ],
  },
  plinko: {
    steps: [
      "Choose a risk level and the number of rows.",
      "Drop the ball. The slot it lands in sets your payout.",
      "Turn on Auto to keep dropping at your current bet.",
    ],
    shortcuts: [["Space / Enter", "Drop a ball"]],
  },
  baccarat: {
    steps: [
      "Select a chip, then tap Player, Banker, Tie or a pair.",
      "Closest to 9 wins. Banker pays 0.95:1, Tie pays 8:1.",
      "Deal and the cards draw by the classic rules.",
    ],
    shortcuts: [
      ["Enter", "Deal"],
      ["P / B / T", "Bet on Player / Banker / Tie"],
      ["C", "Clear bets"],
    ],
  },
  roulette: {
    steps: [
      "Three live wheels spin on a timer. Everyone at a wheel sees the same spin.",
      "Select a chip and tap the table while bets are open.",
      "Single zero. Every bet pays 36 ÷ numbers covered.",
    ],
    shortcuts: [
      ["R", "Repeat last bets"],
      ["C", "Clear bets"],
      ["N", "Next wheel"],
    ],
  },
  crash: {
    steps: [
      "Bet before takeoff, or queue your bet for the next round.",
      "The snake climbs and the multiplier grows. Cash out before it bites.",
      "Set an auto cash-out to lock in a target automatically.",
    ],
    shortcuts: [
      ["Space / Enter", "Bet · cash out · queue"],
      ["A", "Toggle auto cash-out"],
    ],
  },
};
