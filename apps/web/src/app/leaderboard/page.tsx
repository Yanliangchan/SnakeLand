import type { Metadata } from "next";
import { RequireSession } from "@/components/RequireSession";
import { LeaderboardView } from "./LeaderboardView";

export const metadata: Metadata = { title: "Leaderboards" };

export default function LeaderboardPage() {
  return (
    <RequireSession>
      <LeaderboardView />
    </RequireSession>
  );
}
