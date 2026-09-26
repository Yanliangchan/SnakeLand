"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { FullScreenLoader } from "./FullScreenLoader";
import { useSession } from "@/providers/session";

/** Client-side gate for signed-in pages. The API enforces auth regardless. */
export function RequireSession({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "signed-out") router.replace("/");
  }, [status, router]);
  if (status !== "ready") return <>{fallback ?? <FullScreenLoader />}</>;
  return <>{children}</>;
}
