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
          {/* Match the 215px/260px idle poses on a 720px stage. Feet share
              the full backdrop's platform baseline, clear of the front moat. */}
          <img
            src="/images/arena/anime-turtle.webp"
            alt=""
            width={666}
            height={600}
            className="absolute bottom-[34%] left-[30%] h-[30%] w-auto max-w-none -translate-x-1/2 drop-shadow-lg"
          />
          <img
            src="/images/arena/anime-chick.webp"
            alt=""
            width={455}
            height={600}
            className="absolute bottom-[34%] left-[70%] h-[36%] w-auto max-w-none -translate-x-1/2 -scale-x-100 drop-shadow-lg"
          />
        </>
      )}
    </div>
  );
}
