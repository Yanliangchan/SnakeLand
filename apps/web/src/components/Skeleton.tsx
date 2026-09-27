import { cn } from "@/lib/cn";

/** A shimmering placeholder block. Use several to mirror the final layout while it loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-[shimmer_1.4s_ease-in-out_infinite] rounded-[8px] bg-elevated", className)} />;
}

/** A grid of challenge/game card skeletons. */
export function CardGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-4 hairline">
          <div className="flex items-center justify-between">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="mt-1 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** A stack of list-row skeletons (leaderboard, history). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
