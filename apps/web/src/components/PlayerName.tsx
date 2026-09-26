import type { NameColour, PlayerTag } from "@snakeland/shared";
import { cn } from "@/lib/cn";

const TITLE_STYLE: Record<string, string> = {
  "Snake King": "text-gold border-gold/40 bg-gold/10",
  "Black Mamba": "text-fg border-hairline-strong bg-black",
  Viper: "text-table-green border-table-green/40 bg-table-green/10",
  "Safety Stores": "text-fg-muted border-loss/30 bg-loss/5",
};

export const NAME_COLOUR: Record<NameColour, string> = {
  gold: "text-gold",
  silver: "text-silver",
  bronze: "text-bronze",
};

export function TitleBadge({ title, className }: { title: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium tracking-normal",
        TITLE_STYLE[title] ?? "border-hairline text-fg-muted",
        className,
      )}
    >
      {title}
    </span>
  );
}

/** A player's name with their earned decorations: all-time name colour, weekly title, Hall of Fame mark. */
export function PlayerName({ tag, className, badges = true }: { tag: PlayerTag; className?: string; badges?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span className={cn("truncate", tag.nameColour && NAME_COLOUR[tag.nameColour])}>{tag.name}</span>
      {badges && tag.title && <TitleBadge title={tag.title} />}
      {badges && !tag.title && tag.hallOfFame && (
        <span className="shrink-0 text-[11px] text-fg-muted" title="Hall of Fame: all-time top 10">
          HoF
        </span>
      )}
    </span>
  );
}
