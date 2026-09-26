import { baccaratPoints, baccaratTotal, rankOf, type BaccaratWinner, type Card } from "@snakeland/shared";

export interface BaccaratCard {
  code: Card;
  seq: number;
}

export interface BaccaratHand {
  player: BaccaratCard[];
  banker: BaccaratCard[];
  playerTotal: number;
  bankerTotal: number;
  winner: BaccaratWinner;
  natural: boolean;
  playerPair: boolean;
  bankerPair: boolean;
}

/** Does the banker draw, given its total and the player's third card (null if the player stood)? */
export function bankerDraws(bankerTotal: number, playerThird: Card | null): boolean {
  if (playerThird === null) return bankerTotal <= 5;
  const p = baccaratPoints(playerThird);
  switch (bankerTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return p !== 8;
    case 4:
      return p >= 2 && p <= 7;
    case 5:
      return p >= 4 && p <= 7;
    case 6:
      return p === 6 || p === 7;
    default:
      return false;
  }
}

/** Deal one coup by the standard tableau. Order: P, B, P, B, then third cards. */
export function dealCoup(draw: () => Card): BaccaratHand {
  let seq = 0;
  const take = (): BaccaratCard => ({ code: draw(), seq: seq++ });
  const player = [take()];
  const banker = [take()];
  player.push(take());
  banker.push(take());

  const codes = (h: BaccaratCard[]) => h.map((c) => c.code);
  let pt = baccaratTotal(codes(player));
  let bt = baccaratTotal(codes(banker));
  const natural = pt >= 8 || bt >= 8;

  if (!natural) {
    let playerThird: Card | null = null;
    if (pt <= 5) {
      const c = take();
      player.push(c);
      playerThird = c.code;
      pt = baccaratTotal(codes(player));
    }
    if (bankerDraws(bt, playerThird)) {
      banker.push(take());
      bt = baccaratTotal(codes(banker));
    }
  }

  return {
    player,
    banker,
    playerTotal: pt,
    bankerTotal: bt,
    winner: pt > bt ? "player" : bt > pt ? "banker" : "tie",
    natural,
    playerPair: rankOf(player[0]!.code) === rankOf(player[1]!.code),
    bankerPair: rankOf(banker[0]!.code) === rankOf(banker[1]!.code),
  };
}
