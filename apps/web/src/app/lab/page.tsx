import type { Metadata } from "next";
import { RequireSession } from "@/components/RequireSession";
import { LabView } from "./LabView";

export const metadata: Metadata = { title: "The Lab" };

export default function LabPage() {
  return (
    <RequireSession>
      <LabView />
    </RequireSession>
  );
}
