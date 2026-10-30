import type { ArenaKind } from "@/lib/arenaDeployment";
import { cn } from "@/lib/utils";

export function ArenaArtwork({
  kind,
  className
}: {
  kind: ArenaKind;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={
        kind === "anime"
          ? "Anime Yuniturtle and Yunichick facing off on an island arena"
          : "Cinematic Yunipals facing off beside an island waterfall"
      }
      className={cn(
        "relative aspect-video overflow-hidden bg-sky/30",
        className
      )}
    >
      <img
        src={`/images/arena/${kind === "anime" ? "anime-background" : "video-preview"}.webp`}
        alt=""
        width={1200}
        height={675}
        className="h-full w-full object-cover"
      />
      {kind === "anime" && (
        <>
          <img
            src="/images/arena/anime-turtle.webp"
            alt=""
            width={666}
            height={600}
            className="absolute bottom-8 left-4 h-3/4 w-1/2 object-contain drop-shadow-lg"
          />
          <img
            src="/images/arena/anime-chick.webp"
            alt=""
            width={455}
            height={600}
            className="absolute bottom-8 right-4 h-4/5 w-2/5 -scale-x-100 object-contain drop-shadow-lg"
          />
        </>
      )}
    </div>
  );
}
