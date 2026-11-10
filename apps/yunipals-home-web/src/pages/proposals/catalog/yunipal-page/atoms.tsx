import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";
import { formatAbsolute, formatRelative } from "./dates";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Section heading used down the page. */
export const HEADING = "mt-7 font-display text-xl";

/** Small capital label, as on trait names. */
export const LABEL =
  "text-[10px] font-bold uppercase tracking-wider text-muted";

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const Icon = copied ? Check : Copy;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false)
          );
        }}
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-75 transition-colors hover:bg-line/70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge",
          copied && "text-success opacity-100"
        )}
      >
        <Icon aria-hidden="true" size={13} />
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

/**
 * An account on one line with its copy button: its ENS name when it has one,
 * otherwise the shortened address. The button always copies the address. With
 * `linked`, the name opens that collector's page.
 */
export function Address({
  value,
  name,
  linked = false
}: {
  value: string;
  name?: string;
  linked?: boolean;
}) {
  const text = name ?? shortAddress(value);
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {linked ? (
        <Link
          to={`/collector/${value}`}
          title={name ? value : undefined}
          className="rounded underline decoration-ink/25 underline-offset-[3px] hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge"
        >
          {text}
        </Link>
      ) : (
        <span title={name ? value : undefined}>{text}</span>
      )}
      <CopyButton value={value} label={`Copy address ${value}`} />
    </span>
  );
}

/**
 * A date in words; a click switches it to relative time and back. With
 * `steady` it always takes the room of the longer of the two, so switching
 * never resizes what is around it (for table cells).
 */
export function DateToggle({
  timestamp,
  withTime = false,
  steady = false
}: {
  timestamp: number;
  withTime?: boolean;
  steady?: boolean;
}) {
  const [relative, setRelative] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={relative}
      title={relative ? "Show the date" : "Show how long ago"}
      onClick={() => setRelative((value) => !value)}
      className={cn(
        "rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge",
        steady && "grid items-center"
      )}
    >
      {steady ? (
        <>
          <span
            aria-hidden={relative}
            className={cn("col-start-1 row-start-1", relative && "invisible")}
          >
            {formatAbsolute(timestamp, withTime)}
          </span>
          <span
            aria-hidden={!relative}
            className={cn("col-start-1 row-start-1", !relative && "invisible")}
          >
            {formatRelative(timestamp)}
          </span>
        </>
      ) : relative ? (
        formatRelative(timestamp)
      ) : (
        formatAbsolute(timestamp, withTime)
      )}
    </button>
  );
}

export function Parachute({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        stroke="none"
        d="M2 11.5C2 5.8 6.5 1.5 12 1.5s10 4.3 10 10q-3.3-3.2-6.7 0q-3.3-3.2-6.6 0q-3.4-3.2-6.7 0Z"
      />
      <path fill="none" d="M3 11.5l7.8 7M21 11.5l-7.8 7M12 10.5v8" />
      <rect x="9.5" y="18" width="5" height="4.5" rx="1.2" stroke="none" />
    </svg>
  );
}
