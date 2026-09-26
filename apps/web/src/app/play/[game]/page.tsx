import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GAMES, isGameId } from "@snakeland/shared";
import { BaccaratGame } from "@/components/games/baccarat/BaccaratGame";
import { BlackjackGame } from "@/components/games/blackjack/BlackjackGame";
import { MinesGame } from "@/components/games/mines/MinesGame";
import { PlinkoGame } from "@/components/games/plinko/PlinkoGame";
import { RouletteGame } from "@/components/games/roulette/RouletteGame";
import { RequireSession } from "@/components/RequireSession";
import { GamePreview } from "./GamePreview";

type Props = { params: Promise<{ game: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params;
  return { title: isGameId(game) ? GAMES[game].name : "Not found" };
}

export default async function PlayPage({ params }: Props) {
  const { game } = await params;
  if (!isGameId(game)) notFound();
  return (
    <RequireSession>
      {game === "blackjack" ? (
        <BlackjackGame />
      ) : game === "mines" ? (
        <MinesGame />
      ) : game === "plinko" ? (
        <PlinkoGame />
      ) : game === "baccarat" ? (
        <BaccaratGame />
      ) : game === "roulette" ? (
        <RouletteGame />
      ) : (
        <GamePreview game={game} initialTableId={randomUUID()} />
      )}
    </RequireSession>
  );
}
