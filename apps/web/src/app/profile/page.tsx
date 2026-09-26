import type { Metadata } from "next";
import { RequireSession } from "@/components/RequireSession";
import { ProfileView } from "./ProfileView";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <RequireSession>
      <ProfileView />
    </RequireSession>
  );
}
