"use client";

import { Button, ButtonLink } from "@/components/ui";

/** Anything that throws while rendering lands here instead of a blank screen. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">Something broke</p>
        <h1 className="mt-3 text-[28px] font-semibold">That didn’t go to plan.</h1>
        <p className="mt-2 text-[14px] text-fg-muted">Your chips are safe: balances only change on the server. Try again or head back to the lobby.</p>
        <div className="mt-8 flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/" variant="secondary">
            Lobby
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
