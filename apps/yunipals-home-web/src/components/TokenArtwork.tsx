import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type TokenArtworkProps = {
  src: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
};

export function TokenArtwork({
  src,
  alt,
  className,
  eager
}: TokenArtworkProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-lavender/55 to-sky/55 text-ink/40",
          className
        )}
        role="img"
        aria-label={`${alt} artwork unavailable`}
      >
        <ImageOff aria-hidden="true" size={28} />
        <span className="text-xs font-bold uppercase tracking-wide">
          Metadata pending
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}
