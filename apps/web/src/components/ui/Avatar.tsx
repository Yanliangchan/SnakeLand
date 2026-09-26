import { cn } from "@/lib/cn";

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 place-items-center rounded-full bg-elevated text-[12px] font-medium text-fg hairline",
        className,
      )}
    >
      {initials}
    </span>
  );
}
