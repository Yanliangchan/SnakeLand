import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="text-[64px] font-semibold tracking-[-0.04em] tabular">404</p>
        <p className="mt-2 text-[15px] text-fg-muted">This table doesn’t exist.</p>
        <div className="mt-8">
          <ButtonLink href="/" variant="secondary">
            Back to lobby
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
