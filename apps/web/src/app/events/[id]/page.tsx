import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RequireSession } from "@/components/RequireSession";
import { EventDetailView } from "./EventDetailView";

export const metadata: Metadata = { title: "Event" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  return (
    <RequireSession>
      <EventDetailView id={id} />
    </RequireSession>
  );
}
