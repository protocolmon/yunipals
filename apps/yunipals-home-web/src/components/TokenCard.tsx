import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Link } from "react-router-dom";

import { TokenArtwork } from "@/components/TokenArtwork";
import { ChainLogo } from "@/components/ui/ChainLogo";
import { collectionChainDetails } from "@/data/chains";
import type { CollectionToken } from "@/lib/collectionBrowser";
import { formatDecimal, shortAddress } from "@/lib/format";
import { cardFacts, cardName, cardRarityLevel } from "@/lib/tokenCard";
import { cn } from "@/lib/utils";
import { getDisplayedRarity, getTokenAttribute } from "@/lib/yunipalsIndexer";

type TokenCardProps = {
  token: CollectionToken;
  eager?: boolean;
  action?: ReactNode;
  market?: ReactNode;
};

const RAISED = "relative z-10";
const GLASS = "bg-ink/35 text-white ring-1 ring-white/60 backdrop-blur-md";
const WORD = "text-[10px] font-extrabold uppercase tracking-widest";

function Parachute({ className }: { className?: string }) {
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

/** Frosted-glass chain mark over the artwork, top left. */
function ChainMark({ token }: Pick<TokenCardProps, "token">) {
  const chain = collectionChainDetails[token.chain];
  return (
    <span
      title={chain.label}
      className={cn(
        "absolute left-3 top-3 grid h-7 w-7 place-items-center rounded-full",
        GLASS
      )}
    >
      <ChainLogo chainId={token.chain} className="h-3.5 w-3.5" />
      <span className="sr-only">{chain.label}</span>
    </span>
  );
}

function FourPointStar({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-10 -10 20 20"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M0,-10 Q0,0 10,0 Q0,0 0,10 Q0,0 -10,0 Q0,0 0,-10Z" />
    </svg>
  );
}

/** Glitter: three twinkling stars under the chain mark, top left. */
function GlitterMark({ label }: { label: string }) {
  return (
    <span
      title={label}
      className="absolute left-2.5 top-11 block h-8 w-8 text-white drop-shadow-[0_1px_3px_rgba(13,21,38,.55)]"
    >
      <FourPointStar className="motion-safe:animate-card-twinkle absolute left-0 top-1 h-5 w-5" />
      <FourPointStar className="motion-safe:animate-card-twinkle absolute right-0 top-0 h-3 w-3 [animation-delay:-0.7s]" />
      <FourPointStar className="motion-safe:animate-card-twinkle absolute bottom-0 right-1 h-2.5 w-2.5 [animation-delay:-1.4s]" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The id in small type, with a button that copies the whole of it. */
function TokenId({ token }: Pick<TokenCardProps, "token">) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const copied = copyStatus === "copied";
  const { tokenId } = token;
  const solana = token.chain === "solana";

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const Icon = copied ? Check : Copy;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium tabular-nums text-muted [@container_(max-width:158px)]:gap-0.5 [@container_(max-width:158px)]:text-[10px]">
      <span className="relative z-10 select-text truncate" title={tokenId}>
        {solana ? `Mint ${shortAddress(tokenId)}` : `#${tokenId}`}
      </span>
      <button
        type="button"
        aria-label={`Copy ${solana ? "mint address" : "token id"} ${tokenId}`}
        onClick={() => {
          if (!navigator.clipboard?.writeText) {
            setCopyStatus("failed");
            return;
          }
          navigator.clipboard.writeText(tokenId).then(
            () => setCopyStatus("copied"),
            () => setCopyStatus("failed")
          );
        }}
        className={cn(
          RAISED,
          "-my-1 grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-line/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge",
          copied && "text-success"
        )}
      >
        <Icon aria-hidden="true" size={12} />
      </button>
      <span role="status" className="sr-only">
        {copied
          ? "Copied"
          : copyStatus === "failed"
            ? "Could not copy. Select and copy the token ID manually."
            : ""}
      </span>
    </span>
  );
}

const CARD =
  "relative flex flex-col overflow-hidden rounded-card border border-line bg-white [container-type:inline-size]";
/** The text half of the card; its height is reserved for the longest real values. */
const BODY =
  "flex min-h-[156px] flex-1 flex-col p-3 [@container_(min-width:250px)]:min-h-[132px] [@container_(min-width:250px)]:p-4 [@container_(min-width:250px)]:pb-3";
/**
 * One line of name. Long Type names are shown in their short form (see
 * tokenCard.ts); a long name with no short form is cut with an ellipsis.
 */
const NAME =
  "h-[18px] truncate text-[13px] font-extrabold leading-[18px] [@container_(max-width:158px)]:text-xs [@container_(max-width:158px)]:tracking-tight [@container_(min-width:250px)]:h-5 [@container_(min-width:250px)]:text-base [@container_(min-width:250px)]:leading-5";
/** Rarity under the name on a narrow card, beside the id on a wide one. */
const META =
  "mt-0.5 [@container_(min-width:250px)]:flex [@container_(min-width:250px)]:flex-row-reverse [@container_(min-width:250px)]:items-center [@container_(min-width:250px)]:justify-between [@container_(min-width:250px)]:gap-2";
/**
 * Traits as label over value: side by side with a divider on a wide card,
 * one under the other on a narrow one. Values wrap, up to two lines.
 */
const FACTS =
  "mt-auto min-h-[71px] space-y-1 border-t border-line pt-2.5 [@container_(min-width:250px)]:grid [@container_(min-width:250px)]:min-h-[53px] [@container_(min-width:250px)]:auto-cols-fr [@container_(min-width:250px)]:grid-flow-col [@container_(min-width:250px)]:space-y-0 [@container_(min-width:250px)]:divide-x [@container_(min-width:250px)]:divide-line";

/**
 * Special, as a small plate on the artwork's bottom left.
 */
function SpecialPlate() {
  return (
    <span
      className={cn(
        "absolute bottom-2.5 left-2.5 rounded-full bg-white/90 px-2 py-1 text-grape shadow-sm backdrop-blur-md",
        WORD
      )}
    >
      Special
    </span>
  );
}

/**
 * Rarity points with a thin line underneath that grows with the level: one
 * eighth for under 200 points, the full width from 1,000,000.
 */
function Rarity({ points }: { points: string }) {
  const level = cardRarityLevel(points);
  if (level === null) return null;
  return (
    <span
      title={`Rarity level ${level} of 8`}
      className="relative inline-block h-5"
    >
      {formatDecimal(points, Number(points) < 100 ? 1 : 0)}
      <abbr
        title="Rarity points"
        className="ml-1 text-[10px] font-bold text-muted no-underline"
      >
        RP
      </abbr>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink/10"
      >
        <span
          className="block h-full rounded-full bg-ink"
          style={{ width: `${(level / 8) * 100}%` }}
        />
      </span>
      <span className="sr-only">, level {level} of 8</span>
    </span>
  );
}

export function TokenCard({ token, eager, action, market }: TokenCardProps) {
  const name = token.name || "Unknown Yunipal";
  const facts = cardFacts(token);
  const rarity = getDisplayedRarity(token);
  const special = getTokenAttribute(token, "Special") === "Yes";
  const airdrop = getTokenAttribute(token, "Airdrop") === "Yes";
  const glitter = getTokenAttribute(token, "Glitter");
  const hasGlitter =
    typeof glitter === "string" &&
    glitter.trim() !== "" &&
    glitter.toLowerCase() !== "none";
  return (
    <article
      className={cn(
        CARD,
        "group shadow-card transition-shadow duration-300 hover:shadow-cardHover"
      )}
    >
      <div className="relative aspect-square shrink-0 overflow-hidden bg-lavender/25">
        <TokenArtwork
          src={token.image}
          alt={name}
          eager={eager}
          className="transition duration-500 motion-safe:group-hover:scale-105"
        />
        <ChainMark token={token} />
        {hasGlitter && <GlitterMark label={glitter} />}
        {special && <SpecialPlate />}
        {market && (
          <div className="absolute right-0 top-3 z-10 max-w-[calc(100%-46px)] text-white [&>p]:rounded-l-full [&>p]:bg-ink/75 [&>p]:px-2.5 [&>p]:py-1.5 [&>p]:text-[10px] [&>p]:text-white [&>p]:backdrop-blur-md">
            {market}
          </div>
        )}
      </div>
      {action && (
        <div
          className={cn(
            "absolute right-2.5 z-20",
            market ? "top-12" : "top-2.5"
          )}
        >
          {action}
        </div>
      )}
      <div className={BODY}>
        <h3
          className={cn(
            NAME,
            "flex items-center gap-1",
            token.name ? "text-ink" : "text-muted"
          )}
        >
          <Link
            to={`/collection/${token.chain}/${token.tokenId}`}
            title={name}
            aria-label={`View ${token.name || `Yunipal ${token.tokenId}`}`}
            className="min-w-0 truncate after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-badge"
          >
            {cardName(name)}
          </Link>
          {airdrop && (
            <span title="Airdrop" className="shrink-0 text-muted">
              <Parachute className="h-3.5 w-3.5" />
              <span className="sr-only">Airdrop</span>
            </span>
          )}
        </h3>
        <div className={META}>
          <p className="h-[22px] shrink-0 text-sm font-extrabold tabular-nums leading-5 text-ink">
            {rarity !== null && <Rarity points={rarity} />}
          </p>
          <div className="flex h-5 min-w-0 items-center">
            <TokenId key={token.tokenId} token={token} />
          </div>
        </div>
        <dl className={FACTS}>
          {facts.map(([label, value], index) => (
            <div
              key={label}
              className={cn(
                "min-w-0",
                facts.length > 1 &&
                  (index === 0
                    ? "[@container_(min-width:250px)]:pr-3"
                    : "[@container_(min-width:250px)]:pl-3")
              )}
            >
              <dt className="text-[10px] font-bold uppercase leading-[14px] tracking-wider text-muted">
                {label}
              </dt>
              <dd className="break-words text-[11px] font-extrabold tabular-nums leading-[14px] text-ink [@container_(min-width:250px)]:text-xs">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}

const PULSE = "animate-pulse rounded bg-line motion-reduce:animate-none";

/**
 * The placeholder shown while a page of cards loads. It is built from the same
 * blocks as the card, so nothing moves when the cards arrive.
 */
export function TokenCardSkeleton() {
  return (
    <div aria-hidden="true" className={CARD}>
      <div className="aspect-square shrink-0 animate-pulse bg-line/65 motion-reduce:animate-none" />
      <div className={BODY}>
        <div className={cn(PULSE, "h-4 w-24")} />
        <div className={cn(PULSE, "mt-2 h-3 w-20 opacity-70")} />
        <div className={FACTS}>
          <div className={cn(PULSE, "h-3 w-3/4 opacity-60")} />
          <div className={cn(PULSE, "h-3 w-1/2 opacity-60")} />
        </div>
      </div>
    </div>
  );
}
