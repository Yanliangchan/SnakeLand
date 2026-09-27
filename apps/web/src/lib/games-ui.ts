import type { GameId } from "@snakeland/shared";

/** One thin signature colour per game: card borders in the lobby, a hairline on the stage. */
export const GAME_ACCENT: Record<GameId, string> = {
  blackjack: "#2dd4bf",
  mines: "#f5a524",
  plinko: "#a78bfa",
  baccarat: "#38bdf8",
  roulette: "#f0524b",
  crash: "#3ddc84",
  carrier: "#fb923c",
  tower: "#e879f9",
  crossing: "#facc15",
  penalty: "#4ade80",
  hilo: "#f472b6",
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
  carrier: {
    steps: [
      "Set your bet and a flight speed. Faster flights swing harder but land less often.",
      "Boosts add or multiply your multiplier; rockets cut it in half.",
      "Land on the carrier to win the multiplier. Miss it and you splash down.",
    ],
    shortcuts: [
      ["Space / Enter", "Take off"],
      ["1–4", "Pick a speed"],
    ],
  },
  tower: {
    steps: [
      "Choose a difficulty: fewer safe doors means bigger multipliers.",
      "Pick one door on each floor. A safe door lifts you to the next floor.",
      "Cash out any time, or reach the top for the full multiplier.",
    ],
    shortcuts: [
      ["Enter", "Bet / cash out"],
      ["1–4", "Pick a door"],
      ["R", "Random door"],
    ],
  },
  crossing: {
    steps: [
      "Choose how busy the road is. More traffic, bigger jumps in the multiplier.",
      "Hop one lane at a time. Each lane you clear raises the multiplier.",
      "Cash out whenever you like. Get hit and the stake is gone.",
    ],
    shortcuts: [
      ["Space", "Bet / hop a lane"],
      ["C", "Cash out"],
    ],
  },
  penalty: {
    steps: [
      "Choose how much goal the keeper covers. Less open goal, bigger multipliers.",
      "Pick a spot for each kick. Beat the keeper and the multiplier climbs.",
      "Cash out any time, or score all ten for the full multiplier.",
    ],
    shortcuts: [
      ["Enter", "Bet / cash out"],
      ["1–5", "Shoot at a spot"],
      ["R", "Random spot"],
    ],
  },
  hilo: {
    steps: [
      "Bet to draw a card. Guess if the next is higher or lower. Ties win.",
      "Riskier guesses pay more; each guess shows its odds and payout.",
      "Skip cards you don't like. Cash out any time after a correct guess.",
    ],
    shortcuts: [
      ["Enter", "Bet / cash out"],
      ["H / ↑", "Higher or same"],
      ["L / ↓", "Lower or same"],
      ["S", "Skip"],
    ],
  },
};
