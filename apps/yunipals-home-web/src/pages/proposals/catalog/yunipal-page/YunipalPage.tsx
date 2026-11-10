import { useState } from "react";
import { ArrowLeft, ImageOff, Swords } from "lucide-react";

import { ChainLogo } from "@/components/ui/ChainLogo";
import type { DisplayChainId } from "@/data/chains";
import { cn } from "@/lib/utils";
import {
  Address,
  CopyButton,
  DateToggle,
  HEADING,
  Parachute,
  ZERO_ADDRESS
} from "./atoms";
import { Journey, type JourneyStep } from "./Journey";
import { rarityLevel } from "./rarity";
import {
  MarketTab,
  orderCount,
  PageTabs,
  PriceSection,
  SalesHistory,
  type PageTab
} from "./Market";
import type { SampleTrait, SampleYunipal } from "./sample";
import type { MarketState, PageState } from "./states";

/** A chance of 1% or less is ultra rare and gets the accent colour. */
const ULTRA_RARE_CHANCE = 1;

/** Type, Color and Horn always lead the trait list, in this order. */
const LEADING_TRAITS = ["Type", "Color", "Horn"];

/** Yes/no attributes shown as flags under the rarity points, not as traits. */
const FLAG_TRAITS = ["Special", "First Edition", "Airdrop"];

/** Internal identifiers that are never shown in the trait list. */
const HIDDEN_TRAITS = ["Booster", "Nfb", "Nfb Number"];

/** Traits whose value is a chain name and gets that chain's icon. */
const CHAIN_TRAITS = ["Origin Chain", "Opening Network"];

const CHAIN_BY_NAME: Record<string, DisplayChainId> = {
  Ethereum: "ethereum",
  Polygon: "polygon",
  Base: "base",
  "BNB Chain": "bnb",
  "Binance Smart Chain": "bnb",
  Solana: "solana",
  "Solana Mainnet": "solana"
};

function orderTraits(traits: readonly SampleTrait[]) {
  const rank = (trait: SampleTrait) => {
    const index = LEADING_TRAITS.indexOf(trait.label);
    return index === -1 ? LEADING_TRAITS.length : index;
  };
  return traits
    .filter(
      (trait) =>
        !FLAG_TRAITS.includes(trait.label) &&
        !HIDDEN_TRAITS.includes(trait.label)
    )
    .map((trait, index) => ({ trait, index }))
    .sort((a, b) => rank(a.trait) - rank(b.trait) || a.index - b.index)
    .map(({ trait }) => trait);
}

function Trait({ trait }: { trait: SampleTrait }) {
  const chain = CHAIN_TRAITS.includes(trait.label)
    ? CHAIN_BY_NAME[trait.value]
    : undefined;
  return (
    <div className="min-w-0 border-b border-ink/10 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">
        {trait.label}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-bold tabular-nums text-ink [overflow-wrap:anywhere]">
        {chain && (
          <ChainLogo
            chainId={chain}
            className="h-3.5 w-3.5 shrink-0 self-center"
          />
        )}
        {trait.timestamp ? (
          <DateToggle timestamp={trait.timestamp} />
        ) : (
          <span>{trait.value}</span>
        )}
        {trait.chance !== undefined && (
          <span
            className={cn(
              "whitespace-nowrap text-xs font-normal",
              trait.chance <= ULTRA_RARE_CHANCE ? "text-grape" : "text-muted"
            )}
          >
            {trait.chance}%<span className="sr-only"> drop chance</span>
          </span>
        )}
      </dd>
    </div>
  );
}

const FLAG_WORD = "text-[10px] font-extrabold uppercase tracking-widest";

/** Special, First Edition and Airdrop as small capital words, like the card. */
function Flags({
  traits,
  burned
}: {
  traits: readonly SampleTrait[];
  burned: boolean;
}) {
  const has = (label: string) =>
    traits.some((trait) => trait.label === label && trait.value === "Yes");
  if (!burned && !FLAG_TRAITS.some(has)) return null;
  return (
    <ul className="mt-1.5 flex flex-col items-end gap-1">
      {burned && <li className={cn("text-red-600", FLAG_WORD)}>Burned</li>}
      {has("Special") && (
        <li className={cn("text-grape", FLAG_WORD)}>Special</li>
      )}
      {has("First Edition") && (
        <li className={cn("text-ink/70", FLAG_WORD)}>First edition</li>
      )}
      {has("Airdrop") && (
        <li className={cn("flex items-center gap-1 text-bluex", FLAG_WORD)}>
          <Parachute className="h-3 w-3" />
          Airdrop
        </li>
      )}
    </ul>
  );
}

/** How many transfer steps a journey shows before the middle is folded. */
const JOURNEY_FOLD = 4;

function traitValue(yunipal: SampleYunipal, label: string) {
  return yunipal.traits.find((trait) => trait.label === label);
}

function journeySteps(
  yunipal: SampleYunipal,
  options: {
    burned: boolean;
    owns: boolean;
    expanded: boolean;
    onExpand: () => void;
  }
): JourneyStep[] {
  const nameOf = (address: string) =>
    address === yunipal.owner ? yunipal.ownerName : undefined;
  const steps: JourneyStep[] = [];

  const birthday = traitValue(yunipal, "Birthday")?.timestamp;
  if (birthday) {
    const home = traitValue(yunipal, "Opening Network")?.value;
    steps.push({
      key: "hatched",
      when: <DateToggle timestamp={birthday} />,
      title: home ? `Hatched on ${home}` : "Hatched",
      note:
        traitValue(yunipal, "Background")?.value ??
        traitValue(yunipal, "Type")?.value ??
        ""
    });
  }

  const transferSteps = yunipal.transfers.map((transfer, index) => {
    const minted = transfer.from === ZERO_ADDRESS;
    return {
      key: `transfer-${index}`,
      when: <DateToggle timestamp={transfer.timestamp} withTime />,
      title: (
        <>
          {minted ? "Went home with" : "Moved in with"}{" "}
          <Address value={transfer.to} name={nameOf(transfer.to)} />
        </>
      ),
      note: minted ? (
        `Minted on ${yunipal.chainLabel} · Block ${transfer.block}`
      ) : (
        <>
          From <Address value={transfer.from} name={nameOf(transfer.from)} />
          <span>· Block {transfer.block}</span>
        </>
      )
    };
  });
  if (transferSteps.length > JOURNEY_FOLD && !options.expanded) {
    const hidden = transferSteps.length - 3;
    steps.push(transferSteps[0], {
      key: "more",
      when: "",
      title: (
        <button
          type="button"
          onClick={options.onExpand}
          className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-bold text-ink hover:bg-line/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge"
        >
          Show {hidden} more moves
        </button>
      ),
      note: ""
    });
    steps.push(...transferSteps.slice(-2));
  } else {
    steps.push(...transferSteps);
  }

  const refreshed = traitValue(yunipal, "Last metadata update")?.timestamp;
  if (refreshed) {
    steps.push({
      key: "refreshed",
      when: <DateToggle timestamp={refreshed} />,
      title: "Details refreshed",
      note: "Latest metadata update"
    });
  }

  if (options.burned) {
    steps.push({
      key: "burned",
      current: true,
      when: "Today",
      title: "Burned",
      note: "Sent to the burn address. It has no collector now."
    });
  } else {
    steps.push({
      key: "now",
      current: true,
      when: "Today",
      title: options.owns ? (
        "Lives with you"
      ) : (
        <>
          Lives with{" "}
          <Address value={yunipal.owner} name={yunipal.ownerName} linked />
        </>
      ),
      note: options.owns ? (
        <>
          Your wallet <Address value={yunipal.owner} name={yunipal.ownerName} />
        </>
      ) : (
        "Current collector"
      )
    });
  }
  return steps;
}

const NOTICE = "mt-4 rounded-2xl border px-4 py-3 text-[13px] leading-relaxed";
const PLAIN_LINK =
  "rounded font-bold text-ink underline underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge";

/** Base airdrops: where the original lives and how the two relate. */
function OriginalNotice({ yunipal }: { yunipal: SampleYunipal }) {
  const original = yunipal.original;
  if (!original) return null;
  return (
    <section
      aria-label="Original NFT"
      className={cn(NOTICE, "border-bluex/15 bg-bluex/5 text-ink/80")}
    >
      <p className="flex items-center gap-1.5 font-bold text-bluex">
        <Parachute className="h-3.5 w-3.5 shrink-0" />
        Airdropped from an original on {original.chainLabel}
      </p>
      <p className="mt-1">
        Each NFT has its own owner. Buying or transferring one does not include
        the other.
      </p>
      <p className="mt-2">
        <span className={PLAIN_LINK}>
          View {original.chainLabel} original #{original.tokenId} →
        </span>
        {original.status === "burned" && (
          <span className="ml-2 text-[10px] font-extrabold uppercase tracking-widest text-red-600">
            Burned
          </span>
        )}
        {original.status === "ownership-unavailable" && (
          <span className="ml-2 text-muted">Ownership unavailable</span>
        )}
      </p>
    </section>
  );
}

/** The proposed Yunipal page: story first, then traits, then the journey. */
export function YunipalPage({
  yunipal: source,
  page,
  market
}: {
  yunipal: SampleYunipal;
  page: Extract<PageState, "ready" | "no-metadata" | "no-artwork" | "burned">;
  market: MarketState;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<PageTab>("story");
  const noMetadata = page === "no-metadata";
  const burned = page === "burned";
  const owns = market === "owner" && !burned;
  // Without metadata only the on-chain facts remain: id, chain, owner, moves.
  const yunipal: SampleYunipal = noMetadata
    ? {
        ...source,
        name: "Unknown Yunipal",
        description: undefined,
        rarityPoints: undefined,
        rarityRaw: undefined,
        traits: []
      }
    : source;
  const showArtwork = !noMetadata && page !== "no-artwork";
  const traits = orderTraits(yunipal.traits);
  // The decimal part (with its dot) is set smaller so it is not read as
  // thousands: 15,071.506 must not look like fifteen million.
  const [whole, fraction] = (yunipal.rarityPoints ?? "").split(".");
  const longName = yunipal.name.length > 16;
  const orders = burned ? 0 : orderCount(yunipal, market);

  return (
    <article className="grid gap-5 bg-[linear-gradient(180deg,#c7c9f9_0%,#e9eafc_30%,#ffffff_58%)] p-4 pb-7 text-ink [@container_(min-width:768px)]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] [@container_(min-width:768px)]:items-start [@container_(min-width:768px)]:gap-x-9 [@container_(min-width:768px)]:p-10">
      <p className="[@container_(min-width:768px)]:col-span-2">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/70 px-3.5 text-xs font-bold text-ink">
          <ArrowLeft aria-hidden="true" size={14} /> Back
        </span>
      </p>
      <div
        className={cn(
          "aspect-square overflow-hidden rounded-[18px] border-[5px] border-white shadow-[0_22px_44px_-22px_rgba(79,70,229,.65)]",
          burned && "opacity-70 grayscale"
        )}
      >
        {showArtwork ? (
          <img
            src={yunipal.image}
            alt={`${yunipal.name} artwork`}
            width={640}
            height={640}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-lavender/40 text-center text-badge">
            <div>
              <ImageOff aria-hidden="true" size={30} className="mx-auto" />
              <p className="mt-2 text-xs font-bold">Artwork unavailable</p>
            </div>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="mt-1 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[.14em] text-grape">
          <ChainLogo chainId={yunipal.chain} className="h-3.5 w-3.5 shrink-0" />
          {yunipal.chainLabel}
        </p>
        <div
          className={cn(
            "mt-2 flex items-start justify-between gap-x-3 gap-y-2",
            longName && "flex-wrap"
          )}
        >
          <div className="min-w-0">
            <h3
              className={cn(
                "break-words font-display leading-none",
                longName
                  ? "text-[26px] [@container_(min-width:640px)]:text-[30px]"
                  : "text-[32px] [@container_(min-width:640px)]:text-[40px]"
              )}
            >
              {yunipal.name}
            </h3>
            <p className="mt-1.5 flex items-center gap-0.5 text-[13px] tabular-nums text-muted">
              #{yunipal.tokenId}
              <CopyButton
                value={yunipal.tokenId}
                label={`Copy token id ${yunipal.tokenId}`}
              />
            </p>
          </div>
          <div className="ml-auto shrink-0 pt-3 text-right">
            {yunipal.rarityPoints && (
              <p
                title={`Rarity level ${rarityLevel(Number(yunipal.rarityPoints))} of 8`}
                className="relative inline-block whitespace-nowrap pb-1.5 text-lg font-extrabold leading-none tabular-nums text-ink"
              >
                {whole}
                {fraction && (
                  <span className="text-xs font-bold">.{fraction}</span>
                )}
                <abbr
                  title="Rarity points"
                  className="ml-1 text-[11px] font-bold text-muted no-underline"
                >
                  RP
                </abbr>
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-ink/10"
                >
                  <span
                    className="block h-full rounded-full bg-ink"
                    style={{
                      width: `${(rarityLevel(Number(yunipal.rarityPoints)) / 8) * 100}%`
                    }}
                  />
                </span>
                <span className="sr-only">
                  , level {rarityLevel(Number(yunipal.rarityPoints))} of 8
                </span>
              </p>
            )}
            {yunipal.rarityRaw && (
              <p className="mt-1 text-[11px] tabular-nums text-muted">
                Capped · raw {yunipal.rarityRaw}
              </p>
            )}
            <Flags traits={yunipal.traits} burned={burned} />
          </div>
        </div>

        {!burned && <PriceSection yunipal={yunipal} state={market} />}

        <PageTabs tab={tab} onChange={setTab} orders={orders} />

        {tab === "story" && (
          <div
            role="tabpanel"
            id="yunipal-panel-story"
            aria-labelledby="yunipal-tab-story"
          >
            {noMetadata && (
              <p
                role="status"
                className={cn(
                  NOTICE,
                  "border-amber-200 bg-amber-50 text-amber-900"
                )}
              >
                Metadata is currently unavailable for this Yunipal. Its on-chain
                identity, owner and journey are still shown below.
              </p>
            )}
            {burned && (
              <p
                role="status"
                className={cn(NOTICE, "border-red-200 bg-red-50 text-red-900")}
              >
                This Yunipal was burned. It can no longer be owned, bought or
                sold; its traits and journey are kept as a record.
              </p>
            )}
            <OriginalNotice yunipal={yunipal} />

            {yunipal.description && (
              <p className="mt-4 text-base leading-[1.65] text-ink/90 first-letter:float-left first-letter:pr-2 first-letter:pt-1.5 first-letter:font-display first-letter:text-[46px] first-letter:leading-[.8] first-letter:text-grape">
                {yunipal.description}
              </p>
            )}

            <h4 className={HEADING}>Traits</h4>
            {traits.length > 0 ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-[18px]">
                {traits.map((trait) => (
                  <Trait key={trait.label} trait={trait} />
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-[13px] text-muted">
                Traits will appear here once the metadata is available.
              </p>
            )}

            {yunipal.chain === "base" && !burned && (
              <section aria-label="Arena">
                <h4 className={HEADING}>Arena</h4>
                <p className="mt-2 flex items-center gap-2 text-[13px] text-muted">
                  <Swords aria-hidden="true" size={15} className="shrink-0" />
                  Applications are being prepared for launch.
                </p>
              </section>
            )}
          </div>
        )}

        {tab === "journey" && (
          <div
            role="tabpanel"
            id="yunipal-panel-journey"
            aria-labelledby="yunipal-tab-journey"
          >
            <h4 className="mt-5 font-display text-xl">The journey so far</h4>
            <Journey
              steps={journeySteps(yunipal, {
                burned,
                owns,
                expanded,
                onExpand: () => setExpanded(true)
              })}
            />
            {yunipal.transfers.length === 0 && (
              <p className="mt-3 text-[13px] text-muted">
                No transfers have been indexed for this Yunipal yet.
              </p>
            )}
          </div>
        )}

        {tab === "market" && (
          <div
            role="tabpanel"
            id="yunipal-panel-market"
            aria-labelledby="yunipal-tab-market"
          >
            {burned ? (
              <>
                <p className="mt-5 text-[13px] text-muted">
                  A burned Yunipal cannot be listed or bought.
                </p>
                <SalesHistory yunipal={yunipal} state={market} />
              </>
            ) : (
              <MarketTab yunipal={yunipal} state={market} />
            )}
          </div>
        )}

        <p className="mt-6 flex flex-wrap gap-3.5 text-[13px] font-semibold underline underline-offset-[3px]">
          <span>Contract ↗</span>
          {!noMetadata && <span>Metadata ↗</span>}
          {yunipal.transfers.length > 0 && <span>Latest transfer ↗</span>}
        </p>
      </div>
    </article>
  );
}
