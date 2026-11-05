import { useState } from "react";

import { boosterArtworkPreviewUrl } from "@/lib/boosterArtworkPreview";
import { cn } from "@/lib/utils";

type BoosterCardThumbnailProps = {
  image: string | null;
  alt: string;
  eager?: boolean;
  className?: string;
};

export function BoosterCardThumbnail({
  image,
  alt,
  eager = false,
  className
}: BoosterCardThumbnailProps) {
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
    <img
      src={source}
      alt={alt}
      width={520}
      height={780}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={cn("aspect-[2/3] h-full w-full object-contain", className)}
      onError={() => {
        if (preview && source === preview) setFailedPreview(preview);
        else setFailedImage(image);
      }}
    />
  );
}
