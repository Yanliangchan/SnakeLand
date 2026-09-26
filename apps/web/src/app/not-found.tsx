import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">404</p>
        <h1 className="mt-3 text-[28px] font-semibold">This table doesn’t exist.</h1>
        <p className="mt-2 text-[14px] text-fg-muted">The page moved, or the link is wrong.</p>
        <div className="mt-8">
          <ButtonLink href="/" variant="secondary">
            Back to lobby
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
