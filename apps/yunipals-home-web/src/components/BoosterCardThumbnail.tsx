import { useState } from "react";

import { CardArtworkLoader } from "@/components/CardArtworkLoader";
import { boosterArtworkPreviewUrl } from "@/lib/boosterArtworkPreview";
import { cardArtworkCutoutStyle } from "@/lib/cardArtworkCutout";
import { cn } from "@/lib/utils";

type BoosterCardThumbnailProps = {
  image: string | null;
  alt: string;
  eager?: boolean;
  className?: string;
  cutout?: string;
};

export function BoosterCardThumbnail({
  image,
  alt,
  eager = false,
  className,
  cutout
}: BoosterCardThumbnailProps) {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const preview = boosterArtworkPreviewUrl(image);
  const source = preview && preview !== failedPreview ? preview : image;

  if (!source || image === failedImage)
    return (
      <span
        className={cn(
          "flex aspect-[2/3] h-full w-full items-center justify-center rounded-card bg-lavender/20 p-2 text-center text-xs text-muted",
          className
        )}
        role="img"
        aria-label={`${alt || "Card"} artwork unavailable`}
      >
        Artwork unavailable
      </span>
    );

  return (
    <span
      className={cn("relative block aspect-[2/3] h-full w-full", className)}
    >
      {loadedSource !== source && (
        <span className="absolute inset-0" aria-hidden="true">
          <CardArtworkLoader label={alt || "Card"} />
        </span>
      )}
      <img
        src={source}
        style={cardArtworkCutoutStyle(image, cutout)}
        alt={alt}
        width={520}
        height={780}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        className={cn(
          "card-artwork-cutout relative aspect-[2/3] h-full w-full object-contain",
          loadedSource !== source && "opacity-0"
        )}
        onLoad={() => setLoadedSource(source)}
        onError={() => {
          if (preview && source === preview) setFailedPreview(preview);
          else setFailedImage(image);
        }}
      />
    </span>
  );
}
