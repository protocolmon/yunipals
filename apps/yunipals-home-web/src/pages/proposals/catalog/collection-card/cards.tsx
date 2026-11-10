import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  ImageOff,
  Loader2,
  ShoppingBag
} from "lucide-react";
import { Link } from "react-router-dom";

import { ChainLogo } from "@/components/ui/ChainLogo";
import { collectionChainDetails } from "@/data/chains";
import { formatDecimal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SampleToken } from "./samples";
import { rarityLevel } from "./rarity";
import { cardName } from "./shortNames";
import type { CardMarket, CardVisibility } from "./states";
import "./collection-card.css";

type CardProps = {
  token: SampleToken;
  /** What the marketplace knows; left out where it is not set up. */
  market?: CardMarket;
  /** The owner's hide or show button on the collector page. */
  visibility?: CardVisibility;
};

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge";
/** Sits above the link that covers the whole card. */
const RAISED = "relative z-10";

const GLASS = "bg-white/25 text-white ring-1 ring-white/60 backdrop-blur-md";
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
function ChainMark({ token }: Pick<CardProps, "token">) {
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
      <FourPointStar className="cc-twinkle absolute left-0 top-1 h-5 w-5" />
      <FourPointStar className="cc-twinkle absolute right-0 top-0 h-3 w-3 [animation-delay:-0.7s]" />
      <FourPointStar className="cc-twinkle absolute bottom-0 right-1 h-2.5 w-2.5 [animation-delay:-1.4s]" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The id in small type, with a button that copies the whole of it. */
function TokenId({ token }: Pick<CardProps, "token">) {
  const [copied, setCopied] = useState(false);
  const { tokenId } = token;
  const solana = token.chain === "solana";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const Icon = copied ? Check : Copy;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium tabular-nums text-muted [@container_(max-width:158px)]:gap-0.5 [@container_(max-width:158px)]:text-[10px]">
      <span className="truncate" title={tokenId}>
        {solana
          ? `Mint ${tokenId.slice(0, 4)}…${tokenId.slice(-4)}`
          : `#${tokenId}`}
      </span>
      <button
        type="button"
        aria-label={`Copy ${solana ? "mint address" : "token id"} ${tokenId}`}
        onClick={() => {
          navigator.clipboard.writeText(tokenId).then(
            () => setCopied(true),
            () => setCopied(false)
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
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}

/** Rarity as a whole number; one decimal below a hundred points. */
function formatRarity(points: number) {
  return formatDecimal(points, points < 100 ? 1 : 0);
}

function Artwork({ token, name }: { token: SampleToken; name: string }) {
  if (!token.image) {
    return (
      <div
        role="img"
        aria-label={`${name} artwork is not available yet`}
        className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-lavender/55 to-sky/55 text-ink/40"
      >
        <ImageOff aria-hidden="true" size={26} />
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Artwork pending
        </span>
      </div>
    );
  }
  return (
    <img
      src={token.image}
      alt={name}
      loading="lazy"
      width={640}
      height={640}
      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
    />
  );
}

/** The owner's button over the artwork that hides or shows the Yunipal. */
function VisibilityButton({
  state,
  name,
  lowered
}: {
  state: CardVisibility;
  name: string;
  lowered: boolean;
}) {
  const Icon = state === "busy" ? Loader2 : state === "show" ? Eye : EyeOff;
  return (
    <button
      type="button"
      disabled={state === "busy"}
      aria-label={
        state === "busy"
          ? `Saving ${name}`
          : `${state === "show" ? "Show" : "Hide"} ${name}`
      }
      className={cn(
        lowered ? "top-12" : "top-3",
        "absolute right-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-line bg-white/95 text-ink shadow-sm transition hover:bg-white hover:text-badge disabled:cursor-wait disabled:opacity-60",
        FOCUS
      )}
    >
      <Icon
        aria-hidden="true"
        size={15}
        className={cn(
          state === "busy" && "animate-spin motion-reduce:animate-none"
        )}
      />
    </button>
  );
}

const MARKET_NOTE: Record<
  Exclude<CardMarket["status"], "listed" | "unlisted">,
  string
> = {
  purchased: "Purchased",
  updating: "Updating…",
  unavailable: "Price unavailable"
};

/** The short note for a card that is not listed, if it needs one. */
function marketNote(market: CardMarket | undefined) {
  if (!market || market.status === "listed" || market.status === "unlisted")
    return null;
  return MARKET_NOTE[market.status];
}

type Listed = Extract<CardMarket, { status: "listed" }>;

const PLATE =
  "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-extrabold tabular-nums shadow-sm";

/**
 * Purchased, updating or unavailable. It takes the price tag's place and
 * shape, top right, in the frosted glass of the chain mark, so it reads as
 * part of the card rather than a sticker on it.
 */
function StatusTag({ market }: { market: CardMarket }) {
  const note = marketNote(market);
  if (!note) return null;
  const Icon =
    market.status === "purchased"
      ? Check
      : market.status === "updating"
        ? Loader2
        : null;
  return (
    <span
      className={cn(
        "absolute right-0 top-3 flex h-7 max-w-[calc(100%-46px)] items-center gap-1.5 rounded-l-full pl-2.5 pr-3 [text-shadow:0_1px_2px_rgba(13,21,38,.35)]",
        GLASS,
        "ring-0",
        WORD
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          size={12}
          strokeWidth={3}
          className={cn(
            "shrink-0",
            market.status === "updating" &&
              "animate-spin motion-reduce:animate-none"
          )}
        />
      )}
      {market.status === "unavailable" ? (
        <>
          <span className="truncate [@container_(max-width:249px)]:hidden">
            {note}
          </span>
          <span className="hidden truncate [@container_(max-width:249px)]:inline">
            No price
          </span>
        </>
      ) : (
        <span className="truncate">{note}</span>
      )}
    </span>
  );
}

/**
 * The price tag on the artwork's top right corner, with the Buy button inside
 * it where the viewer can buy. It sits on the artwork, so a listed card is
 * exactly the size of an unlisted one.
 */
/** Prices of ten thousand and more in short form: 1250000 → 1.25M. */
function compactPrice(price: string) {
  const value = Number(price.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 10_000) return price;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumSignificantDigits: 3
  }).format(value);
}

/**
 * The price tag on the artwork's top right corner. Where the viewer can buy,
 * the whole tag is the Buy button. It sits on the artwork, so a listed card is
 * exactly the size of an unlisted one, and it leaves the top left corner to
 * the chain mark.
 */
function PriceTag({ market, name }: { market: Listed; name: string }) {
  const [listing, ...others] = market.listings;
  const more = others
    .map((other) => `${other.price} ${other.currency}`)
    .join(", ");
  const buy = market.mode === "buy";
  const Tag = buy ? "button" : "div";
  return (
    <Tag
      {...(buy
        ? {
            type: "button" as const,
            "aria-label": `Buy ${name} for ${listing.price} ${listing.currency}`
          }
        : {})}
      className={cn(
        PLATE,
        "absolute right-0 top-3 z-10 max-w-[calc(100%-46px)] rounded-r-none bg-ink pl-3 pr-3 text-white [@container_(max-width:249px)]:gap-1 [@container_(max-width:249px)]:pl-2.5 [@container_(max-width:249px)]:pr-2",
        buy && cn("transition-colors hover:bg-grape", FOCUS)
      )}
    >
      <span className="truncate" title={`${listing.price} ${listing.currency}`}>
        {compactPrice(listing.price)}
        <span className="ml-1 text-[10px] font-bold text-white/70 [@container_(max-width:249px)]:ml-0.5 [@container_(max-width:249px)]:text-[9px]">
          {listing.currency}
        </span>
      </span>
      {listing.opensea && (
        <img
          src="/images/opensea/logomark-blue.svg"
          alt="Listing from OpenSea"
          title="Listing from OpenSea"
          width={14}
          height={14}
          className="h-3.5 w-3.5 shrink-0 rounded-full bg-white [@container_(max-width:249px)]:h-3 [@container_(max-width:249px)]:w-3"
        />
      )}
      {others.length > 0 && (
        <span
          title={`Also listed for ${more}`}
          className="hidden shrink-0 text-[10px] font-bold text-white/70 [@container_(min-width:250px)]:inline"
        >
          +{others.length}
          <span className="sr-only"> more: {more}</span>
        </span>
      )}
      {market.mode === "own" && (
        <span className="shrink-0 text-[10px] font-bold uppercase text-white/70 [@container_(max-width:249px)]:sr-only">
          Yours
        </span>
      )}
      {buy && (
        <span className="flex shrink-0 items-center gap-1 border-l border-white/25 pl-2 text-[11px] font-bold [@container_(max-width:249px)]:pl-1.5">
          <span className="[@container_(max-width:249px)]:sr-only">Buy</span>
          <ArrowRight aria-hidden="true" size={12} />
        </span>
      )}
    </Tag>
  );
}

const CARD =
  "relative flex flex-col overflow-hidden rounded-card border border-line bg-white [container-type:inline-size]";
/** The text half of the card; its height is reserved for the longest real values. */
const BODY =
  "flex min-h-[156px] flex-1 flex-col p-3 [@container_(min-width:250px)]:min-h-[132px] [@container_(min-width:250px)]:p-4 [@container_(min-width:250px)]:pb-3";
/**
 * One line of name. Long Type names are shown in their short form (see
 * shortNames.ts); a long name with no short form is cut with an ellipsis.
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
function Rarity({ points }: { points: number }) {
  const level = rarityLevel(points);
  return (
    <span
      title={`Rarity level ${level} of 8`}
      className="relative inline-block h-5"
    >
      {formatRarity(points)}
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

/**
 * Spec sheet card. The name takes one line (long Type names use their short
 * form), colours and horns are shown in full, and the text half reserves room
 * for the longest ones, so a card is the same size in every state, on sale or
 * not: the price is a tag on the artwork.
 */
export function SpecCard({ token, market, visibility }: CardProps) {
  const name = token.name ?? "Unknown Yunipal";
  const facts =
    token.facts ??
    ([
      ["Color", token.color],
      ["Horn", token.horn]
    ] as const);
  const listed = market?.status === "listed" ? market : undefined;
  // A price or status tag takes the top right corner; the owner's button
  // steps under it.
  const tagged = listed !== undefined || marketNote(market) !== null;
  return (
    <article
      className={cn(
        CARD,
        "group shadow-card transition-shadow duration-300 hover:shadow-cardHover"
      )}
    >
      <div className="relative aspect-square shrink-0 overflow-hidden bg-lavender/25">
        <Artwork token={token} name={name} />
        <ChainMark token={token} />
        {token.glitter && <GlitterMark label={token.glitter} />}
        {token.special && <SpecialPlate />}
        {listed && <PriceTag market={listed} name={name} />}
        {market && <StatusTag market={market} />}
      </div>
      {visibility && (
        <VisibilityButton state={visibility} name={name} lowered={tagged} />
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
            to="/proposals/yunipal-page"
            title={name}
            aria-label={name}
            className="min-w-0 truncate after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-badge"
          >
            {cardName(name)}
          </Link>
          {token.airdrop && (
            <span title="Airdrop" className="shrink-0 text-muted">
              <Parachute className="h-3.5 w-3.5" />
              <span className="sr-only">Airdrop</span>
            </span>
          )}
        </h3>
        <div className={META}>
          <p className="h-[22px] shrink-0 text-sm font-extrabold tabular-nums leading-5 text-ink">
            {token.rarityPoints !== null && (
              <Rarity points={token.rarityPoints} />
            )}
          </p>
          <div className="flex h-5 min-w-0 items-center">
            <TokenId token={token} />
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
              <dd className="break-words text-[11px] font-extrabold tabular-nums leading-[14px] text-ink [@container_(min-width:250px)]:text-xs [@container_(min-width:250px)]:leading-[14px]">
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
export function CardSkeleton() {
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
