import type { Metadata } from "next";
import { RequireSession } from "@/components/RequireSession";
import { SettingsView } from "./SettingsView";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <RequireSession>
      <SettingsView />
    </RequireSession>
  );
}
