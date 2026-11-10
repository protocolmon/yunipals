import {
  BadgeCheck,
  BookOpen,
  Check,
  HandCoins,
  Route,
  ShoppingBag,
  Store,
  Tag,
  X
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Address, DateToggle, HEADING, LABEL } from "./atoms";
import type { SampleYunipal } from "./sample";
import {
  currencyOf,
  exampleOrders,
  exampleSales,
  type MarketState,
  type SampleOrder,
  type SampleSale
} from "./states";

export type PageTab = "story" | "journey" | "market";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge";
const BUTTON = cn(
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-bold",
  FOCUS
);
const PRIMARY = cn(BUTTON, "bg-ink text-white hover:opacity-90");
const SECONDARY = cn(
  BUTTON,
  "border border-ink/15 bg-white text-ink hover:bg-line/40"
);
const QUIET = "mt-2 text-[13px] text-muted";
const TABLE_BOX =
  "mt-2 overflow-x-auto rounded-xl border border-ink/10 bg-white [container-type:inline-size]";
const CELL = "px-2 py-2.5 align-middle [@container_(min-width:480px)]:px-3";
const HEAD_CELL = cn(
  LABEL,
  "px-2 py-2 text-left [@container_(min-width:480px)]:px-3"
);
const HEAD_ROW = "border-b border-ink/10 bg-ink/[.03]";

type Market = {
  yunipal: SampleYunipal;
  currency: string;
  /** The viewer owns this Yunipal. */
  owns: boolean;
  /** Missing when the Yunipal has offers but is not for sale. */
  listing?: SampleOrder;
  offers: SampleOrder[];
  sales: SampleSale[];
};

/** The states in which this Yunipal has a listing or offers. */
const LISTED: readonly MarketState[] = [
  "listed",
  "listed-only",
  "offers-only",
  "owner"
];

/** The active market, or null when nothing is listed or it cannot be read. */
function marketOf(yunipal: SampleYunipal, state: MarketState): Market | null {
  if (!LISTED.includes(state)) return null;
  const orders = exampleOrders(yunipal);
  const listing =
    state === "offers-only"
      ? undefined
      : orders.find((order) => order.side === "listing");
  return {
    yunipal,
    currency: currencyOf(yunipal.chain),
    owns: state === "owner",
    listing,
    offers:
      state === "listed-only"
        ? []
        : orders.filter((order) => order.side === "offer"),
    sales: exampleSales(yunipal)
  };
}

/** How many active listings and offers the Market tab holds. */
export function orderCount(yunipal: SampleYunipal, state: MarketState) {
  const market = marketOf(yunipal, state);
  return market ? market.offers.length + (market.listing ? 1 : 0) : 0;
}

function Maker({ market, order }: { market: Market; order: SampleOrder }) {
  if (order.side === "listing" && market.owns) return <span>You</span>;
  return (
    <Address
      value={order.maker}
      name={
        order.maker === market.yunipal.owner
          ? market.yunipal.ownerName
          : undefined
      }
    />
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="mt-3 space-y-2.5">
      <div className="h-9 animate-pulse rounded-xl bg-line/70" />
      <div className="h-9 w-4/5 animate-pulse rounded-xl bg-line/50" />
    </div>
  );
}

/**
 * The asking price and the best offer side by side, at the top of the page
 * while a Yunipal is listed, with the two things the viewer can do.
 */
export function PriceSection({
  yunipal,
  state
}: {
  yunipal: SampleYunipal;
  state: MarketState;
}) {
  const market = marketOf(yunipal, state);
  if (!market) return null;
  const { listing, owns } = market;
  const best = market.offers[0];
  if (!listing && !best) return null;
  // Both numbers sit side by side; one number alone shares its row with the
  // buttons.
  const split = Boolean(listing && best);
  const stat = "font-display text-[26px] leading-tight";
  const unit = "ml-1.5 text-[0.57em]";
  const big = "h-10 flex-1 justify-center whitespace-nowrap px-3 text-sm";
  const second = owns ? best !== undefined : true;
  return (
    <section
      aria-label="Price"
      className={cn(
        "mt-4 rounded-2xl border border-white bg-white/75 p-4 shadow-[0_10px_24px_-18px_rgba(79,70,229,.6)]",
        !split && "flex flex-wrap items-center gap-x-6 gap-y-3"
      )}
    >
      <div className={cn(split && "grid grid-cols-2 divide-x divide-ink/10")}>
        {listing && (
          <div className={cn(split && "pr-4")}>
            <p className={LABEL}>{owns ? "Your listing" : "Price"}</p>
            <p className={cn(stat, "text-ink")}>
              {listing.price}
              <span className={unit}>{market.currency}</span>
            </p>
            <p className="text-[13px] text-muted">{listing.expires}</p>
          </div>
        )}
        {best && (
          <div className={cn(split && "pl-4")}>
            <p className={LABEL}>
              {listing ? "Best offer" : "Not listed · Best offer"}
            </p>
            <p className={cn(stat, listing ? "text-ink/55" : "text-ink")}>
              {best.price}
              <span className={unit}>{market.currency}</span>
            </p>
            <p className="text-[13px] text-muted">{best.expires}</p>
          </div>
        )}
      </div>
      <div
        className={cn(
          "flex gap-2",
          split
            ? "mt-3 flex-wrap"
            : listing && second
              ? "ml-auto max-w-[340px] grow basis-[260px]"
              : "ml-auto max-w-[200px] grow basis-[160px]"
        )}
      >
        {listing && (
          <button type="button" className={cn(owns ? SECONDARY : PRIMARY, big)}>
            {owns ? (
              <X aria-hidden="true" size={16} />
            ) : (
              <ShoppingBag aria-hidden="true" size={16} />
            )}
            {owns ? "Cancel listing" : "Buy now"}
          </button>
        )}
        {second && (
          <button
            type="button"
            className={cn(owns || !listing ? PRIMARY : SECONDARY, big)}
          >
            {owns ? (
              <Check aria-hidden="true" size={16} />
            ) : (
              <HandCoins aria-hidden="true" size={16} />
            )}
            {owns ? "Accept best offer" : "Make an offer"}
          </button>
        )}
      </div>
    </section>
  );
}

/** Folder tabs that split the page into its story, market and journey. */
export function PageTabs({
  tab,
  onChange,
  orders
}: {
  tab: PageTab;
  onChange: (tab: PageTab) => void;
  orders: number;
}) {
  return (
    <div
      role="tablist"
      aria-label="Yunipal page sections"
      className="mt-5 flex gap-1 border-b border-ink/15 [container-type:inline-size]"
    >
      {(
        [
          { id: "story", label: "Story", Icon: BookOpen },
          { id: "market", label: "Market", Icon: Store },
          { id: "journey", label: "Journey", Icon: Route }
        ] as const
      ).map((entry) => {
        const selected = tab === entry.id;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`yunipal-tab-${entry.id}`}
            aria-selected={selected}
            aria-controls={`yunipal-panel-${entry.id}`}
            onClick={() => onChange(entry.id)}
            className={cn(
              "-mb-px flex h-10 items-center gap-1.5 whitespace-nowrap rounded-t-xl border px-2.5 text-sm font-bold [@container_(min-width:400px)]:px-4",
              FOCUS,
              selected
                ? "border-ink/15 border-b-white bg-white text-ink"
                : "border-transparent text-muted hover:text-ink"
            )}
          >
            <entry.Icon
              aria-hidden="true"
              size={15}
              className="[@container_(max-width:300px)]:hidden"
            />
            {entry.label}
            {entry.id === "market" && orders > 0 && (
              <span className="rounded-full bg-grape/10 px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums text-grape">
                {orders}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function OrdersTable({ market }: { market: Market }) {
  const orders = market.listing
    ? [market.listing, ...market.offers]
    : market.offers;
  return (
    <div className={TABLE_BOX}>
      <table className="w-full text-[13px]">
        <thead>
          <tr className={HEAD_ROW}>
            <th className={HEAD_CELL}>Type</th>
            <th className={HEAD_CELL}>Price</th>
            <th
              className={cn(
                HEAD_CELL,
                "hidden [@container_(min-width:480px)]:table-cell"
              )}
            >
              From
            </th>
            <th className={HEAD_CELL}>Ends in</th>
            <th className={HEAD_CELL}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {orders.map((order) => {
            const listing = order.side === "listing";
            return (
              <tr key={order.id}>
                <td className={cn(CELL, "font-semibold text-ink")}>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full",
                        listing
                          ? "bg-grape/10 text-grape"
                          : "bg-bluex/10 text-bluex"
                      )}
                    >
                      {listing ? (
                        <Tag aria-hidden="true" size={13} />
                      ) : (
                        <HandCoins aria-hidden="true" size={13} />
                      )}
                    </span>
                    <span className="[@container_(max-width:315px)]:sr-only">
                      {listing ? "Listing" : "Offer"}
                    </span>
                  </span>
                </td>
                <td
                  className={cn(
                    CELL,
                    "whitespace-nowrap font-bold tabular-nums text-ink"
                  )}
                >
                  {order.price} {market.currency}
                </td>
                <td
                  className={cn(
                    CELL,
                    "hidden text-muted [@container_(min-width:480px)]:table-cell"
                  )}
                >
                  <Maker market={market} order={order} />
                </td>
                <td className={cn(CELL, "whitespace-nowrap text-muted")}>
                  {order.expires.replace("Ends in ", "")}
                </td>
                <td className={cn(CELL, "text-right")}>
                  {listing && !market.owns && (
                    <button
                      type="button"
                      className={cn(
                        PRIMARY,
                        "h-7 px-2.5 [@container_(min-width:480px)]:px-3"
                      )}
                    >
                      <ShoppingBag
                        aria-hidden="true"
                        size={13}
                        className="hidden [@container_(min-width:480px)]:block"
                      />
                      Buy
                    </button>
                  )}
                  {listing && market.owns && (
                    <button
                      type="button"
                      className={cn(
                        SECONDARY,
                        "h-7 px-2.5 [@container_(min-width:480px)]:px-3"
                      )}
                    >
                      <X
                        aria-hidden="true"
                        size={13}
                        className="hidden [@container_(min-width:480px)]:block"
                      />
                      Cancel
                    </button>
                  )}
                  {!listing && market.owns && (
                    <button
                      type="button"
                      className={cn(
                        PRIMARY,
                        "h-7 px-2.5 [@container_(min-width:480px)]:px-3"
                      )}
                    >
                      <Check
                        aria-hidden="true"
                        size={13}
                        className="hidden [@container_(min-width:480px)]:block"
                      />
                      Accept
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SalesTable({
  sales,
  yunipal
}: {
  sales: readonly SampleSale[];
  yunipal: SampleYunipal;
}) {
  const currency = currencyOf(yunipal.chain);
  return (
    <div className={TABLE_BOX}>
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          <col />
          <col className="w-[150px] [@container_(min-width:480px)]:w-[280px]" />
          <col className="hidden w-24 [@container_(min-width:480px)]:table-column" />
        </colgroup>
        <thead>
          <tr className={HEAD_ROW}>
            <th className={HEAD_CELL}>
              <span className="[@container_(min-width:480px)]:hidden">
                Price ·{" "}
              </span>
              Date
            </th>
            <th className={HEAD_CELL}>From → to</th>
            <th
              className={cn(
                HEAD_CELL,
                "hidden text-right [@container_(min-width:480px)]:table-cell"
              )}
            >
              Price
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {sales.map((sale) => (
            <tr key={sale.id}>
              <td className={cn(CELL, "break-words text-muted")}>
                <span className="block font-bold tabular-nums text-ink [@container_(min-width:480px)]:hidden">
                  {sale.price} {currency}
                </span>
                <DateToggle timestamp={sale.timestamp} steady />
              </td>
              <td className={CELL}>
                <div className="[@container_(min-width:480px)]:flex [@container_(min-width:480px)]:items-center [@container_(min-width:480px)]:gap-1 [@container_(min-width:480px)]:whitespace-nowrap">
                  <span className="block text-muted">
                    <Address value={sale.from} />
                  </span>
                  <span className="flex items-center gap-1 text-ink">
                    <span aria-hidden="true" className="text-muted">
                      →
                    </span>
                    <span className="sr-only">to</span>
                    <Address
                      value={sale.to}
                      name={
                        sale.to === yunipal.owner
                          ? yunipal.ownerName
                          : undefined
                      }
                    />
                  </span>
                </div>
              </td>
              <td
                className={cn(
                  CELL,
                  "hidden whitespace-nowrap text-right font-bold tabular-nums text-ink [@container_(min-width:480px)]:table-cell"
                )}
              >
                {sale.price} {currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Confirmed sales of this Yunipal, newest first. */
export function SalesHistory({
  yunipal,
  state
}: {
  yunipal: SampleYunipal;
  state: MarketState;
}) {
  const sales = LISTED.includes(state) ? exampleSales(yunipal) : [];
  return (
    <section aria-label="Confirmed sales">
      <h4 className={cn(HEADING, "flex items-center gap-2")}>
        <BadgeCheck aria-hidden="true" size={18} className="text-grape" />
        Confirmed sales
      </h4>
      {state === "loading" && <Skeleton label="Loading confirmed sales" />}
      {state === "unavailable" && (
        <p className={QUIET}>Sales history is temporarily unavailable.</p>
      )}
      {state !== "loading" && state !== "unavailable" && sales.length === 0 && (
        <p className={QUIET}>None recorded yet.</p>
      )}
      {sales.length > 0 && <SalesTable sales={sales} yunipal={yunipal} />}
    </section>
  );
}

/** Everything inside the Market tab: listings and offers, then sales. */
export function MarketTab({
  yunipal,
  state
}: {
  yunipal: SampleYunipal;
  state: MarketState;
}) {
  const market = marketOf(yunipal, state);
  const canOffer = state === "empty" || (market !== null && !market.owns);
  return (
    <>
      <section aria-label="Listings and offers">
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 font-display text-xl">
            <Tag aria-hidden="true" size={18} className="text-grape" />
            Listings and offers
          </h4>
          {canOffer && (
            <button type="button" className={SECONDARY}>
              <HandCoins aria-hidden="true" size={14} />
              Make an offer
            </button>
          )}
        </div>
        {market && <OrdersTable market={market} />}
        {state === "loading" && (
          <Skeleton label="Loading listings and offers" />
        )}
        {state === "unavailable" && (
          <p className={QUIET}>
            Listings and offers are temporarily unavailable.{" "}
            <button
              type="button"
              className={cn(
                "rounded font-bold text-ink underline underline-offset-[3px]",
                FOCUS
              )}
            >
              Try again
            </button>
          </p>
        )}
        {state === "unsupported" && (
          <p className={QUIET}>
            Buying and selling are not available on {yunipal.chainLabel} yet.
          </p>
        )}
        {state === "empty" && (
          <p className={QUIET}>No active listings or offers.</p>
        )}
      </section>
      <SalesHistory yunipal={yunipal} state={state} />
    </>
  );
}
