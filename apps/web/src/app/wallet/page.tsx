import type { Metadata } from "next";
import { RequireSession } from "@/components/RequireSession";
import { WalletView } from "./WalletView";

export const metadata: Metadata = { title: "Wallet" };

export default function WalletPage() {
  return (
    <RequireSession>
      <WalletView />
    </RequireSession>
  );
}
