"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MeDTO, WalletDTO } from "@snakeland/shared";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Status = "loading" | "signed-out" | "ready";

export interface SessionValue {
  status: Status;
  me: MeDTO | null;
  /** Replace wallet state with an authoritative value returned by the server. */
  setWallet: (wallet: Partial<WalletDTO>) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Retry delay after the n-th failed attempt: 1s, 2s, 4s… capped at 10s. */
const retryDelay = (n: number) => Math.min(10_000, 1000 * 2 ** n);

/**
 * Session + wallet state for the whole app. The server is always the source of
 * truth: balances only ever change from API responses, never optimistic math.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? null;
  const refetchSession = session.refetch;
  const [me, setMe] = useState<MeDTO | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Only a 401 means "signed out". Any other failure (a server waking up, a
  // dropped connection after the tab was in the background) keeps the player
  // signed in and retries, instead of showing the sign-in screen.
  const sessionStatus = (session.error as { status?: number } | null)?.status;
  const sessionUnreachable = !session.data && !!session.error && sessionStatus !== 401;
  const sessionFailures = useRef(0);
  useEffect(() => {
    if (session.data) sessionFailures.current = 0;
  }, [session.data]);
  useEffect(() => {
    if (!sessionUnreachable) return;
    const timer = setTimeout(() => void refetchSession(), retryDelay(sessionFailures.current++));
    return () => clearTimeout(timer);
  }, [sessionUnreachable, session.error, refetchSession]);
  const [meAttempt, setMeAttempt] = useState(0);

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    api<MeDTO>("/v1/me")
      .then((data) => {
        if (!cancelled) {
          setMe(data);
          setLoadedFor(data.user.id);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadedFor(null);
        // The session really ended: let the auth client find out and sign out.
        if (e instanceof ApiError && e.status === 401) void refetchSession();
        else timer = setTimeout(() => setMeAttempt((n) => n + 1), retryDelay(meAttempt));
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, meAttempt, refetchSession]);

  const status: Status =
    session.isPending || sessionUnreachable || (userId && loadedFor !== userId)
      ? "loading"
      : userId && me
        ? "ready"
        : "signed-out";

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

/**
 * Re-provide the session with some fields swapped for a subtree, e.g. an
 * event stack shown (and updated) in place of the wallet balance.
 */
export function SessionOverride({ value, children }: { value: SessionValue; children: React.ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
