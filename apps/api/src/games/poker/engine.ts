import {
  POKER_RAKE,
  POKER_SEATS,
  POKER_TIMING,
  bestHand,
  orderedShoe,
  shuffleShoe,
  type BotStyle,
  type Card,
  type PokerActionKind,
  type PokerPotDTO,
  type PokerStreet,
} from "@snakeland/shared";

/**
 * The whole state of one poker table, stored as JSON on its row and only ever
 * changed under that row's lock. Pure functions here; the service does the
 * locking, money and broadcasting. The deck and seed never leave the server
 * until the hand is over.
 */
export interface SeatState {
  kind: "human" | "bot";
  userId: string | null;
  name: string;
  style: BotStyle | null;
  stack: number;
  /** Humans: the poker_sessions row their buy-in and cash-out hang off. */
  sessionId: string | null;
  /** Stand up once the current hand ends. */
  leaving: boolean;
  /** Missed turns in a row. */
  timeouts: number;
}

export interface Reservation {
  userId: string;
  name: string;
  sessionId: string;
  stack: number;
}

export interface HandPlayer {
  hole: Card[];
  bet: number;
  contributed: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  human: boolean;
  lastAction: { kind: PokerActionKind; amount: number } | null;
  won: number | null;
  handName: string | null;
  shown: boolean;
}

export interface HandState {
  id: string;
  number: number;
  seed: string;
  commit: string;
  deck: Card[];
  deckPos: number;
  button: number;
  board: Card[];
  street: PokerStreet;
  /** Chips collected from finished streets. */
  pot: number;
  currentBet: number;
  /** Size of the last full raise on this street (at least the big blind). */
  minRaise: number;
  toAct: number | null;
  deadline: string | null;
  players: Array<HandPlayer | null>;
  pots: PokerPotDTO[];
  rake: number;
  winners: Array<{ seat: number; amount: number; handName: string | null }>;
  /** The table's big blind (minimum raise and rake cap are measured in it). */
  bb: number;
  /** Bot stacks when the hand started: what the house won or lost is measured from here. */
  botStart: number;
  ended: boolean;
  /** Written to poker_hands (set by the service once the hand is over). */
  recorded?: boolean;
}

export interface TableState {
  seats: Array<SeatState | null>;
  reservations: Array<Reservation | null>;
  button: number;
  handNumber: number;
  hand: HandState | null;
  /** When the dealer should next do something (bot move, next street, next hand). */
  nextAt: string | null;
}

export interface Blinds {
  sb: number;
  bb: number;
}

export class PokerRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const emptyTable = (): TableState => ({
  seats: Array.from({ length: POKER_SEATS }, () => null),
  reservations: Array.from({ length: POKER_SEATS }, () => null),
  button: -1,
  handNumber: 0,
  hand: null,
  nextAt: null,
});

const at = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

/** Seats after `from`, clockwise, wrapping, that match `ok`. */
function nextSeat(from: number, ok: (seat: number) => boolean): number | null {
  for (let i = 1; i <= POKER_SEATS; i++) {
    const s = (from + i) % POKER_SEATS;
    if (ok(s)) return s;
  }
  return null;
}

const canAct = (h: HandState, s: number) => {
  const p = h.players[s];
  return !!p && !p.folded && !p.allIn;
};

/** Seats that would be dealt in if a hand started now. */
export function dealable(t: TableState): number[] {
  return t.seats.flatMap((s, i) => (s && s.stack > 0 && !s.leaving ? [i] : []));
}

/** Put chips in from a seat's stack (all-in if it runs out). */
function put(t: TableState, h: HandState, seat: number, amount: number) {
  const s = t.seats[seat]!;
  const p = h.players[seat]!;
  const chips = Math.min(amount, s.stack);
  s.stack -= chips;
  p.bet += chips;
  p.contributed += chips;
  if (s.stack === 0) p.allIn = true;
  return chips;
}

/**
 * Deal a new hand. The deck is shuffled from `seed` with the hand id as the
 * client seed, so anyone can rebuild it once the seed is revealed.
 */
export function startHand(t: TableState, blinds: Blinds, ids: { handId: string; seed: string; commit: string }, now: Date) {
  const seats = dealable(t);
  if (seats.length < 2) throw new PokerRuleError("NOT_ENOUGH_PLAYERS", "Need two players");
  const isIn = (s: number) => seats.includes(s);
  const button = nextSeat(t.button, isIn)!;
  const headsUp = seats.length === 2;
  const sbSeat = headsUp ? button : nextSeat(button, isIn)!;
  const bbSeat = nextSeat(sbSeat, isIn)!;

  const deck = shuffleShoe(orderedShoe(1), ids.seed, ids.handId) as Card[];
  const h: HandState = {
    id: ids.handId,
    number: t.handNumber + 1,
    seed: ids.seed,
    commit: ids.commit,
    deck,
    deckPos: 0,
    button,
    board: [],
    street: "preflop",
    pot: 0,
    currentBet: blinds.bb,
    minRaise: blinds.bb,
    toAct: null,
    deadline: null,
    players: Array.from({ length: POKER_SEATS }, () => null),
    pots: [],
    rake: 0,
    winners: [],
    bb: blinds.bb,
    botStart: 0,
    ended: false,
  };
  for (const s of seats) {
    const seat = t.seats[s]!;
    seat.leaving = false;
    h.players[s] = {
      hole: [],
      bet: 0,
      contributed: 0,
      folded: false,
      allIn: false,
      acted: false,
      human: seat.kind === "human",
      lastAction: null,
      won: null,
      handName: null,
      shown: false,
    };
    if (seat.kind === "bot") h.botStart += seat.stack;
  }
  t.button = button;
  t.handNumber = h.number;
  t.hand = h;

  // Blinds go in without an action label (the chips in front of the seat say it).
  put(t, h, sbSeat, blinds.sb);
  put(t, h, bbSeat, blinds.bb);

  // Two cards each, one at a time, starting left of the button.
  for (let round = 0; round < 2; round++) {
    let s: number | null = button;
    for (let k = 0; k < seats.length; k++) {
      s = nextSeat(s!, isIn);
      h.players[s!]!.hole.push(h.deck[h.deckPos++]!);
    }
  }

  // Preflop the player after the big blind acts first (heads-up: the button/small blind).
  const first = nextSeat(bbSeat, (s) => canAct(h, s));
  setTurn(t, h, first, now);
  // Everyone all-in from the blinds: nothing to decide.
  if (roundDone(h)) endRound(t, h, now);
  return h;
}

function roundDone(h: HandState): boolean {
  const actors = h.players.flatMap((p, s) => (p && !p.folded && !p.allIn ? [s] : []));
  if (actors.length === 0) return true;
  if (actors.length === 1) {
    // One player left with chips: done once they've matched the bet.
    return h.players[actors[0]!]!.bet >= h.currentBet;
  }
  return actors.every((s) => h.players[s]!.acted && h.players[s]!.bet === h.currentBet);
}

function setTurn(t: TableState, h: HandState, seat: number | null, now: Date) {
  h.toAct = seat;
  if (seat === null) {
    h.deadline = null;
    return;
  }
  const human = t.seats[seat]!.kind === "human";
  h.deadline = human ? at(now, POKER_TIMING.actionMs) : null;
  // Bots act after a short "think"; humans have until the deadline, unless
  // they've asked to leave, in which case the dealer folds them straight away.
  t.nextAt = human ? (t.seats[seat]!.leaving ? now.toISOString() : h.deadline) : at(now, botDelay());
}

const botDelay = () => POKER_TIMING.botMinMs + Math.floor(Math.random() * (POKER_TIMING.botMaxMs - POKER_TIMING.botMinMs));

/** The betting round is over: pause, then the dealer deals the next street. */
function endRound(t: TableState, h: HandState, now: Date) {
  h.toAct = null;
  h.deadline = null;
  const stillIn = h.players.filter((p) => p && !p.folded).length;
  if (stillIn <= 1) return finish(t, h, now);
  t.nextAt = at(now, POKER_TIMING.streetMs);
}

/** Pull this street's bets into the pot. */
function collect(h: HandState) {
  for (const p of h.players) {
    if (!p) continue;
    h.pot += p.bet;
    p.bet = 0;
    p.acted = false;
  }
  h.currentBet = 0;
}

/**
 * Called by the dealer once the street pause is over: deal the next street,
 * or go to showdown after the river.
 */
export function nextStreet(t: TableState, now: Date) {
  const h = t.hand;
  if (!h || h.ended || h.toAct !== null) return;
  collect(h);
  h.minRaise = h.bb;
  if (h.street === "river") return finish(t, h, now);
  h.deckPos++; // burn
  const n = h.street === "preflop" ? 3 : 1;
  for (let i = 0; i < n; i++) h.board.push(h.deck[h.deckPos++]!);
  h.street = h.street === "preflop" ? "flop" : h.street === "flop" ? "turn" : "river";
  for (const p of h.players) if (p) p.lastAction = null;

  // With fewer than two players able to bet, just run the board out.
  const actors = h.players.filter((p) => p && !p.folded && !p.allIn).length;
  if (actors < 2) return endRound(t, h, now);
  setTurn(
    t,
    h,
    nextSeat(h.button, (s) => canAct(h, s)),
    now,
  );
}

export interface ActionInput {
  kind: PokerActionKind;
  /** For bet/raise: the total this street to raise to. */
  to?: number;
}

/** Apply a player's (or bot's) move. Throws PokerRuleError on anything illegal. */
export function act(t: TableState, seat: number, input: ActionInput, now: Date) {
  const h = t.hand;
  if (!h || h.ended || h.toAct !== seat) throw new PokerRuleError("NOT_YOUR_TURN", "It isn't your turn");
  const p = h.players[seat]!;
  const s = t.seats[seat]!;
  const toCall = h.currentBet - p.bet;
  let kind = input.kind;

  if (kind === "allin") {
    const to = p.bet + s.stack;
    kind = to > h.currentBet ? (h.currentBet === 0 ? "bet" : "raise") : "call";
    input = { kind, to };
  }

  switch (kind) {
    case "fold":
      p.folded = true;
      p.lastAction = { kind: "fold", amount: 0 };
      break;
    case "check":
      if (toCall > 0) throw new PokerRuleError("CANT_CHECK", "There's a bet to call");
      p.lastAction = { kind: "check", amount: 0 };
      break;
    case "call": {
      if (toCall <= 0) throw new PokerRuleError("NOTHING_TO_CALL", "Nothing to call");
      put(t, h, seat, toCall);
      p.lastAction = { kind: p.allIn && p.bet < h.currentBet ? "allin" : "call", amount: p.bet };
      break;
    }
    case "bet":
    case "raise": {
      const to = input.to;
      if (to === undefined || !Number.isSafeInteger(to)) throw new PokerRuleError("BAD_AMOUNT", "Choose an amount");
      const max = p.bet + s.stack;
      if (to <= h.currentBet) throw new PokerRuleError("BAD_AMOUNT", "A raise must be more than the current bet");
      if (to > max) throw new PokerRuleError("BAD_AMOUNT", "You don't have that many chips");
      const raiseBy = to - h.currentBet;
      // Less than a full raise is only allowed all-in.
      if (raiseBy < h.minRaise && to < max) {
        throw new PokerRuleError("BAD_AMOUNT", `The minimum is ${h.currentBet + h.minRaise}`);
      }
      const opening = h.currentBet === 0;
      put(t, h, seat, to - p.bet);
      if (raiseBy >= h.minRaise) {
        h.minRaise = raiseBy;
        // A full raise reopens the betting for everyone else.
        for (const [i, q] of h.players.entries()) if (q && i !== seat) q.acted = false;
      }
      h.currentBet = to;
      p.lastAction = { kind: p.allIn ? "allin" : opening ? "bet" : "raise", amount: to };
      break;
    }
    default:
      throw new PokerRuleError("BAD_ACTION", "Unknown action");
  }
  p.acted = true;
  if (s.kind === "human") s.timeouts = 0;

  const stillIn = h.players.filter((q) => q && !q.folded).length;
  if (stillIn <= 1 || roundDone(h)) return endRound(t, h, now);
  setTurn(
    t,
    h,
    nextSeat(seat, (x) => canAct(h, x)),
    now,
  );
}

/** A human ran out of time: check if possible, otherwise fold. */
export function timeOut(t: TableState, now: Date) {
  const h = t.hand;
  if (!h || h.toAct === null) return;
  const seat = h.toAct;
  const p = h.players[seat]!;
  const s = t.seats[seat]!;
  // act() clears the count for a real move; a timeout adds to it instead.
  const missed = s.timeouts + 1;
  act(t, seat, { kind: p.bet >= h.currentBet ? "check" : "fold" }, now);
  s.timeouts = missed;
  if (s.timeouts >= POKER_TIMING.maxTimeouts) s.leaving = true;
}

/**
 * Split the chips into the main pot and side pots by how much each player
 * put in. A layer only one player reached is their own uncalled bet.
 */
export function buildPots(h: HandState): Array<PokerPotDTO & { refund: boolean; humans: number }> {
  const levels = [...new Set(h.players.flatMap((p) => (p && p.contributed > 0 ? [p.contributed] : [])))].sort((a, b) => a - b);
  const out: Array<PokerPotDTO & { refund: boolean; humans: number }> = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    let humans = 0;
    const seats: number[] = [];
    for (const [s, p] of h.players.entries()) {
      if (!p || p.contributed <= prev) continue;
      amount += Math.min(p.contributed, level) - prev;
      if (p.human) humans++;
      if (!p.folded && p.contributed >= level) seats.push(s);
    }
    prev = level;
    if (amount === 0) continue;
    const last = out[out.length - 1];
    // Same contenders as the layer below: one pot, not two.
    if (last && last.seats.join() === seats.join()) {
      last.amount += amount;
      last.humans = Math.max(last.humans, humans);
      continue;
    }
    out.push({ amount, seats, refund: seats.length === 1 && h.players.filter((p) => p && p.contributed >= level).length === 1, humans });
  }
  return out;
}

/** Showdown (or everyone else folded): pay the pots, take the rake, reveal the seed. */
function finish(t: TableState, h: HandState, now: Date) {
  collect(h);
  const contenders = h.players.flatMap((p, s) => (p && !p.folded ? [s] : []));
  const showdown = contenders.length > 1;

  // Run out the board if players went all-in before the river.
  if (showdown) {
    while (h.board.length < 5) {
      h.deckPos++;
      h.board.push(h.deck[h.deckPos++]!);
    }
  }
  const scores = new Map<number, ReturnType<typeof bestHand>>();
  if (showdown) {
    for (const s of contenders) {
      const sc = bestHand([...h.players[s]!.hole, ...h.board]);
      scores.set(s, sc);
      h.players[s]!.handName = sc.name;
      h.players[s]!.shown = true;
    }
  }

  const sawFlop = h.board.length >= 3;
  let rakeLeft = POKER_RAKE.capBB * h.bb;
  const won = new Map<number, number>();
  const pots = buildPots(h);
  h.pots = pots.map(({ amount, seats }) => ({ amount, seats }));

  for (const pot of pots) {
    let amount = pot.amount;
    const winners = pot.seats.length === 1 ? pot.seats : bestOf(pot.seats, scores);
    const humanWinner = winners.some((s) => h.players[s]!.human);
    // Rake only when a real player wins chips another real player put in, after the flop.
    if (!pot.refund && sawFlop && pot.humans >= 2 && humanWinner && rakeLeft > 0) {
      const r = Math.min(rakeLeft, Math.floor((amount * POKER_RAKE.percent) / 100));
      amount -= r;
      rakeLeft -= r;
      h.rake += r;
    }
    const share = Math.floor(amount / winners.length);
    let odd = amount - share * winners.length;
    // Odd chips go to the first winner left of the button.
    const ordered = [...winners].sort((a, b) => ((a - h.button + POKER_SEATS) % POKER_SEATS) - ((b - h.button + POKER_SEATS) % POKER_SEATS));
    for (const s of ordered) {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      won.set(s, (won.get(s) ?? 0) + share + extra);
    }
  }

  for (const [s, amount] of won) {
    t.seats[s]!.stack += amount;
    h.players[s]!.won = amount;
  }
  h.winners = [...won.entries()]
    .filter(([s]) => {
      const p = h.players[s]!;
      return (p.won ?? 0) > 0;
    })
    .map(([seat, amount]) => ({ seat, amount, handName: h.players[seat]!.handName }));
  h.pot = 0;
  h.street = "showdown";
  h.toAct = null;
  h.deadline = null;
  h.ended = true;
  t.nextAt = at(now, showdown ? POKER_TIMING.showdownMs : POKER_TIMING.showdownMs / 2);
}

function bestOf(seats: number[], scores: Map<number, { score: number }>): number[] {
  const top = Math.max(...seats.map((s) => scores.get(s)!.score));
  return seats.filter((s) => scores.get(s)!.score === top);
}

/** House chips in play at the end of a hand, minus what the bots started with: the house's result. */
export function botResult(t: TableState, h: HandState): number {
  let now = 0;
  for (const [s, p] of h.players.entries()) if (p && !p.human && t.seats[s]) now += t.seats[s]!.stack;
  return now - h.botStart;
}
