"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { MeDTO, WalletDTO } from "@snakeland/shared";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Status = "loading" | "signed-out" | "ready";

interface SessionValue {
  status: Status;
  me: MeDTO | null;
  /** Replace wallet state with an authoritative value returned by the server. */
  setWallet: (wallet: Partial<WalletDTO>) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Session + wallet state for the whole app. The server is always the source of
 * truth: balances only ever change from API responses, never optimistic math.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? null;
  const [me, setMe] = useState<MeDTO | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<MeDTO>("/v1/me");
      setMe(data);
      setLoadedFor(data.user.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setLoadedFor(null);
      } else {
        throw e;
      }
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api<MeDTO>("/v1/me")
      .then((data) => {
        if (!cancelled) {
          setMe(data);
          setLoadedFor(data.user.id);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadedFor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const status: Status =
    session.isPending || (userId && loadedFor !== userId) ? "loading" : userId && me ? "ready" : "signed-out";

  const setWallet = useCallback((wallet: Partial<WalletDTO>) => {
    setMe((prev) => (prev ? { ...prev, wallet: { ...prev.wallet, ...wallet } } : prev));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authClient.signOut();
    } finally {
      setMe(null);
      setLoadedFor(null);
    }
  }, []);

  const value = useMemo(
    () => ({ status, me: userId ? me : null, setWallet, refresh: load, signOut }),
    [status, me, userId, setWallet, load, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
