import type { DisplayChainId } from "@/data/chains";

import type { SampleTransfer, SampleYunipal } from "./sample";

export const PAGE_STATES = [
  { id: "ready", label: "Ready" },
  { id: "loading", label: "Loading" },
  { id: "not-found", label: "Not found" },
  { id: "invalid-id", label: "Invalid id" },
  { id: "no-metadata", label: "Metadata unavailable" },
  { id: "no-artwork", label: "Artwork failed" },
  { id: "burned", label: "Burned" }
] as const;

export const MARKET_STATES = [
  { id: "empty", label: "No listings" },
  { id: "listed", label: "Listed" },
  { id: "listed-only", label: "Listed, no offers" },
  { id: "offers-only", label: "Offers, not listed" },
  { id: "owner", label: "Your Yunipal" },
  { id: "loading", label: "Loading" },
  { id: "unavailable", label: "Unavailable" },
  { id: "unsupported", label: "Not on this chain" }
] as const;

export const CONTENT_CASES = [
  { id: "as-is", label: "As is" },
  { id: "airdrop-original", label: "Airdrop original" },
  { id: "original-burned", label: "Original burned" },
  { id: "long-journey", label: "Long journey" },
  { id: "no-transfers", label: "No transfers" },
  { id: "long-name", label: "Long name, big number" },
  { id: "capped", label: "Capped rarity" }
] as const;

export type PageState = (typeof PAGE_STATES)[number]["id"];
export type MarketState = (typeof MARKET_STATES)[number]["id"];
export type ContentCase = (typeof CONTENT_CASES)[number]["id"];

const CURRENCY: Record<DisplayChainId, string> = {
  ethereum: "ETH",
  base: "ETH",
  polygon: "POL",
  bnb: "BNB",
  solana: "SOL"
};

export function currencyOf(chain: DisplayChainId) {
  return CURRENCY[chain];
}

/** A made-up wallet for the illustrative market and journey data. */
function exampleWallet(seed: number) {
  const hex = ((seed + 3) * 2654435761).toString(16).padStart(8, "0");
  return `0x${hex.slice(0, 8).repeat(5)}`;
}

export type SampleOrder = {
  id: string;
  side: "listing" | "offer";
  price: string;
  maker: string;
  expires: string;
};

export type SampleSale = {
  id: string;
  price: string;
  from: string;
  to: string;
  timestamp: number;
};

/** Illustrative orders: the real token has none of these. */
export function exampleOrders(yunipal: SampleYunipal): SampleOrder[] {
  return [
    {
      id: "listing",
      side: "listing",
      price: "0.42",
      maker: yunipal.owner,
      expires: "Ends in 6 days"
    },
    {
      id: "offer-1",
      side: "offer",
      price: "0.35",
      maker: exampleWallet(1),
      expires: "Ends in 2 days"
    },
    {
      id: "offer-2",
      side: "offer",
      price: "0.3",
      maker: exampleWallet(2),
      expires: "Ends in 9 hours"
    }
  ];
}

/** Illustrative sales: the real token has none of these. */
export function exampleSales(yunipal: SampleYunipal): SampleSale[] {
  const first = yunipal.transfers[0]?.timestamp ?? 1_617_227_614;
  return [
    {
      id: "sale-2",
      price: "0.31",
      from: exampleWallet(4),
      to: yunipal.owner,
      timestamp: first + 400 * 86_400
    },
    {
      id: "sale-1",
      price: "0.12",
      from: exampleWallet(3),
      to: exampleWallet(4),
      timestamp: first + 90 * 86_400
    }
  ];
}

const ZERO = "0x0000000000000000000000000000000000000000";

function longJourney(yunipal: SampleYunipal): SampleTransfer[] {
  const start = yunipal.transfers[0]?.timestamp ?? 1_617_227_614;
  const wallets = Array.from({ length: 13 }, (_, index) =>
    exampleWallet(index + 10)
  );
  wallets.push(yunipal.owner);
  return wallets.map((to, index) => ({
    from: index === 0 ? ZERO : wallets[index - 1],
    to,
    timestamp: start + index * 97 * 86_400 + index * 4_321,
    block: (12_149_701 + index * 640_000).toLocaleString("en-US")
  }));
}

/** Applies one content edge case to a real example. */
export function applyContentCase(
  yunipal: SampleYunipal,
  contentCase: ContentCase
): SampleYunipal {
  switch (contentCase) {
    case "airdrop-original":
    case "original-burned":
      return {
        ...yunipal,
        chain: "base",
        chainLabel: "Base",
        traits: [
          ...yunipal.traits.filter((trait) => trait.label !== "Airdrop"),
          { label: "Airdrop", value: "Yes" }
        ],
        original: {
          chainLabel: "Ethereum",
          tokenId: yunipal.tokenId,
          status: contentCase === "original-burned" ? "burned" : undefined
        }
      };
    case "long-journey":
      return { ...yunipal, transfers: longJourney(yunipal) };
    case "no-transfers":
      return { ...yunipal, transfers: [] };
    case "long-name":
      return {
        ...yunipal,
        name: "Polkastarter Babydragon",
        rarityPoints: "54,713,804.714"
      };
    case "capped":
      return { ...yunipal, rarityPoints: "40,000", rarityRaw: "201,327.188" };
    default:
      return yunipal;
  }
}
