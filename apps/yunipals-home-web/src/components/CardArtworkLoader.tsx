import { Sparkles } from "lucide-react";

export function CardArtworkLoader({ label }: { label: string }) {
  return (
    <div
      className="card-artwork-loader flex aspect-[2/3] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-card bg-lavender/30 p-3 text-grape"
      role="status"
      aria-label={`Loading artwork for ${label}`}
    >
      <div className="card-artwork-loader-deck" aria-hidden="true">
        <span className="card-artwork-loader-back" />
        <span className="card-artwork-loader-face">
          <img src="/images/yunipals-logo.webp" width={64} height={64} alt="" />
        </span>
        <Sparkles className="card-artwork-loader-spark h-5 w-5" />
      </div>
      <span className="text-center text-xs font-semibold">
        Loading your pal…
      </span>
    </div>
  );
}
