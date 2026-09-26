import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GAMES, isGameId } from "@snakeland/shared";
import { BlackjackGame } from "@/components/games/blackjack/BlackjackGame";
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
      {game === "blackjack" ? <BlackjackGame /> : <GamePreview game={game} initialTableId={randomUUID()} />}
    </RequireSession>
  );
}
