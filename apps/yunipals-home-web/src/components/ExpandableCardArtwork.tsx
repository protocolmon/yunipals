import { useState } from "react";
import { Expand } from "lucide-react";
import { CardLightbox } from "@/components/CardLightbox";
import { cn } from "@/lib/utils";

/** Static card artwork that opens the shared large tilt view. */
export function ExpandableCardArtwork({
  image,
  label,
  className
}: {
  image: string;
  label: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`View ${label} larger`}
        aria-haspopup="dialog"
        onClick={() => setExpanded(true)}
        className={cn(
          "group relative block cursor-zoom-in rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape",
          className
        )}
      >
        <img
          src={image}
          alt={label}
          width={1024}
          height={1536}
          className="aspect-[2/3] w-full rounded-2xl object-contain"
        />
        <span className="absolute right-2 top-2 rounded-full bg-white/90 p-2 text-grape shadow-sm group-hover:bg-white">
          <Expand size={16} aria-hidden="true" />
        </span>
      </button>
      {expanded && (
        <CardLightbox
          artwork={{ image, name: label }}
          label={label}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
