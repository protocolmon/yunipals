import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function BoosterOpeningShare({
  hash,
  compact = false,
  linkLabel = "Replay opening"
}: {
  hash: string;
  compact?: boolean;
  linkLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) return null;
  const path = `/boosters?opening=${hash.toLowerCase()}`;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 text-sm",
        !compact && "mt-4"
      )}
    >
      {!compact && (
        <Link
          to={path}
          reloadDocument
          className="font-bold text-grape underline"
        >
          {linkLabel}
        </Link>
      )}
      <button
        type="button"
        className={cn(
          "rounded-full font-bold focus-visible:ring-2 focus-visible:ring-grape",
          compact
            ? "p-2.5 text-muted hover:bg-lavender/40 hover:text-grape"
            : "border border-line px-4 py-2"
        )}
        aria-label={copied ? "Opening link copied" : "Copy opening link"}
        title={copied ? "Link copied" : "Copy opening link"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              new URL(path, window.location.origin).href
            );
            setCopied(true);
            setCopyFailed(false);
          } catch {
            setCopyFailed(true);
          }
        }}
      >
        {compact ? (
          copied ? (
            <Check size={17} aria-hidden="true" />
          ) : (
            <Copy size={17} aria-hidden="true" />
          )
        ) : copied ? (
          "Link copied"
        ) : (
          "Copy opening link"
        )}
      </button>
      {copyFailed && (
        <span role="status" className="text-muted">
          Open “{linkLabel}” and copy its address to share.
        </span>
      )}
    </div>
  );
}
