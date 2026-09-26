"use client";

import dynamic from "next/dynamic";
import type { GameId } from "@snakeland/shared";
import { GameLoading } from "@/components/GameLoading";
import { RequireSession } from "@/components/RequireSession";

// Each game is its own chunk: opening Mines never downloads Roulette.
const GAMES = {
  blackjack: dynamic(() => import("@/components/games/blackjack/BlackjackGame").then((m) => m.BlackjackGame), {
    loading: () => <GameLoading game="blackjack" />,
  }),
  mines: dynamic(() => import("@/components/games/mines/MinesGame").then((m) => m.MinesGame), {
    loading: () => <GameLoading game="mines" />,
  }),
  plinko: dynamic(() => import("@/components/games/plinko/PlinkoGame").then((m) => m.PlinkoGame), {
    loading: () => <GameLoading game="plinko" />,
  }),
  baccarat: dynamic(() => import("@/components/games/baccarat/BaccaratGame").then((m) => m.BaccaratGame), {
    loading: () => <GameLoading game="baccarat" />,
  }),
  roulette: dynamic(() => import("@/components/games/roulette/RouletteGame").then((m) => m.RouletteGame), {
    loading: () => <GameLoading game="roulette" />,
  }),
  crash: dynamic(() => import("@/components/games/crash/CrashGame").then((m) => m.CrashGame), {
    loading: () => <GameLoading game="crash" />,
  }),
  carrier: dynamic(() => import("@/components/games/carrier/CarrierGame").then((m) => m.CarrierGame), {
    loading: () => <GameLoading game="carrier" />,
  }),
  tower: dynamic(() => import("@/components/games/ladder/TowerGame").then((m) => m.TowerGame), {
    loading: () => <GameLoading game="tower" />,
  }),
  crossing: dynamic(() => import("@/components/games/ladder/CrossingGame").then((m) => m.CrossingGame), {
    loading: () => <GameLoading game="crossing" />,
  }),
} satisfies Record<GameId, React.ComponentType>;

export function GameMount({ game }: { game: GameId }) {
  const Game = GAMES[game];
  return (
    <RequireSession fallback={<GameLoading game={game} />}>
      <Game />
    </RequireSession>
  );
}
