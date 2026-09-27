import type { Metadata } from "next";
import { RequireSession } from "@/components/RequireSession";
import { EventsView } from "./EventsView";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return (
    <RequireSession>
      <EventsView />
    </RequireSession>
  );
}
