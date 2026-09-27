import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GAMES, isGameId } from "@snakeland/shared";
import { GameMount } from "./GameMount";

type Props = { params: Promise<{ game: string }>; searchParams: Promise<{ event?: string | string[] }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params;
  return { title: isGameId(game) ? GAMES[game].name : "Not found" };
}

export default async function PlayPage({ params, searchParams }: Props) {
  const { game } = await params;
  if (!isGameId(game)) notFound();
  const { event } = await searchParams;
  const eventId = typeof event === "string" && UUID_RE.test(event) ? event : null;
  // Keyed so switching between wallet and event play remounts the game cleanly.
  return <GameMount key={eventId ?? "wallet"} game={game} eventId={eventId} />;
}
