import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GAMES, isGameId } from "@snakeland/shared";
import { GameMount } from "./GameMount";

type Props = { params: Promise<{ game: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params;
  return { title: isGameId(game) ? GAMES[game].name : "Not found" };
}

export default async function PlayPage({ params }: Props) {
  const { game } = await params;
  if (!isGameId(game)) notFound();
  return <GameMount game={game} />;
}
