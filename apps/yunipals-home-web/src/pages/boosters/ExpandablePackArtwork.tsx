import { useState } from "react";
import { Expand } from "lucide-react";
import { CardLightbox } from "@/components/CardLightbox";
import { cn } from "@/lib/utils";

export function ExpandablePackArtwork({
  image,
  label,
  alt,
  priority = false
}: {
  image: string;
  label: string;
  alt: string;
  priority?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`View ${label} larger`}
        aria-haspopup="dialog"
        onClick={() => setExpanded(true)}
        className="group relative block w-56 max-w-full cursor-zoom-in rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape sm:w-72"
      >
        <img
          src={image}
          alt={alt}
          width={1024}
          height={1536}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          draggable={false}
          className={cn(
            "aspect-[2/3] w-full rounded-lg object-contain drop-shadow-xl",
            priority && "motion-safe:animate-float"
          )}
        />
        <span className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/30 bg-ink/90 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors group-hover:bg-ink">
          <Expand size={16} aria-hidden="true" />
          View larger
        </span>
      </button>
      {expanded && (
        <CardLightbox
          artwork={{ image, name: label }}
          label={label}
          subject="pack"
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
