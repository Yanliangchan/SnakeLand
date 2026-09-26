"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Wordmark } from "@/components/AppHeader";
import { FullScreenLoader } from "@/components/FullScreenLoader";
import { Button, Card, Field } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { fadeUp } from "@/lib/motion";

type State = "checking" | "login" | "ready" | "off";

const noop = () => {};
const AdminContext = createContext<{ expired: () => void } | null>(null);

/** Call when an admin request comes back 401 (session ended). Stable across renders. */
export function useAdminExpired() {
  return useContext(AdminContext)?.expired ?? noop;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-sm">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            try {
              await adminApi.login(password);
              setPassword("");
              onDone();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Couldn't sign in");
            } finally {
              setPending(false);
            }
          }}
          className="flex flex-col gap-5"
        >
          <div>
            <Wordmark />
            <h1 className="mt-5 text-[22px] font-semibold">Admin</h1>
            <p className="mt-1 text-[13px] text-fg-muted">Restricted area. Every action is logged.</p>
          </div>
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
          <Button type="submit" loading={pending} disabled={!password}>
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  );
}

export function AdminFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");

  const check = useCallback(() => {
    adminApi
      .session()
      .then(() => setState("ready"))
      .catch((e) => setState(e instanceof ApiError && e.status === 404 ? "off" : "login"));
  }, []);
  useEffect(check, [check]);
  const ctx = useMemo(() => ({ expired: () => setState("login") }), []);

  if (state === "checking") return <FullScreenLoader />;
  if (state === "off") {
    return (
      <main className="grid min-h-dvh place-items-center px-4 text-[13px] text-fg-muted">Not found</main>
    );
  }
  if (state === "login") return <Login onDone={() => setState("ready")} />;

  return (
    <AdminContext.Provider value={ctx}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-20 border-b border-hairline bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-3 sm:px-6">
            <div className="flex items-center gap-3">
              <Wordmark />
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-fg-muted hairline">Admin</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await adminApi.logout().catch(() => {});
                setState("login");
                router.replace("/admin");
              }}
            >
              Sign out
            </Button>
          </div>
        </header>
        <AnimatePresence mode="wait">
          <motion.div key="admin" {...fadeUp}>
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </AdminContext.Provider>
  );
}
