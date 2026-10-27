import { useState } from "react";
import { Link } from "react-router-dom";

export function BoosterOpeningShare({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) return null;
  const path = `/boosters?opening=${hash.toLowerCase()}`;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <Link to={path} reloadDocument className="font-bold text-grape underline">
        Replay opening
      </Link>
      <button
        type="button"
        className="rounded-full border border-line px-4 py-2 font-bold focus-visible:ring-2 focus-visible:ring-grape"
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
        {copied ? "Link copied" : "Copy opening link"}
      </button>
      {copyFailed && (
        <span role="status" className="text-muted">
          Open Replay opening and copy its address to share.
        </span>
      )}
    </div>
  );
}
