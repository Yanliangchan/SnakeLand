"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { REFERRAL_CODE_RE } from "@snakeland/shared";
import { engagementApi } from "@/lib/engagement-api";
import { chips } from "@/lib/format";
import { expoOut } from "@/lib/motion";
import { useSession } from "@/providers/session";

const KEY = "snk:ref";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/**
 * Remembers a `?ref=` invite code from the URL and redeems it once the visitor
 * has a registered account. Any refusal (expired, self, already used) just
 * drops the code: there's nothing for the player to fix.
 */
export function ReferralCapture() {
  const { status, me, refresh } = useSession();
  const [toast, setToast] = useState<number | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref || !REFERRAL_CODE_RE.test(ref)) return;
    try {
      localStorage.setItem(KEY, ref);
    } catch {}
    const url = new URL(window.location.href);
    url.searchParams.delete("ref");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  const registered = status === "ready" && me && !me.user.isGuest ? me.user.id : null;
  useEffect(() => {
    if (!registered || tried.current) return;
    const code = read();
    if (!code) return;
    tried.current = true;
    if (code === registered) return clear();
    engagementApi
      .redeemReferral(code)
      .then((r) => {
        clear();
        if (r.ok) {
          setToast(r.reward);
          void refresh();
          setTimeout(() => setToast(null), 5000);
        }
      })
      .catch(() => clear());
  }, [registered, refresh]);

  return (
    <AnimatePresence>
      {toast !== null && (
        <motion.div
          role="status"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.3, ease: expoOut }}
          className="fixed inset-x-0 top-0 z-[60] flex justify-center p-2"
        >
          <span className="rounded-full bg-elevated px-4 py-1.5 text-[13px] shadow-lg shadow-black/40 hairline">
            Invite bonus: <span className="font-semibold text-win">+{chips(toast)}</span> chips
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
