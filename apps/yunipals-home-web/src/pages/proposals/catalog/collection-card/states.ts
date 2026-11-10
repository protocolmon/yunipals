import exodonkeyArt from "./art/exodonkey.webp";
import theDancefloor from "./art/the-dancefloor.webp";
import winterWonderlandNfb from "./art/winter-wonderland-nfb.webp";
import { SAMPLES, type SampleToken } from "./samples";

/** What the marketplace knows about a card. Prices here are made up. */
export type CardMarket =
  | {
      status: "listed";
      /** buy: the viewer can buy; view: only a link; own: the viewer's listing. */
      mode: "buy" | "view" | "own";
      listings: readonly {
        price: string;
        currency: string;
        opensea?: boolean;
      }[];
    }
  | { status: "unlisted" | "purchased" | "updating" | "unavailable" };

/** The collector-page button that hides or shows a Yunipal. */
export type CardVisibility = "hide" | "show" | "busy";

const dancefloor: SampleToken = {
  name: "The Dancefloor",
  tokenId: "1000794114",
  chain: "ethereum",
  image: theDancefloor,
  type: "The Dancefloor",
  color: "",
  horn: "",
  facts: [["Sound", "Techno"]],
  rarityPoints: 15000,
  special: true,
  airdrop: false,
  glitter: null
};

const exodonkey: SampleToken = {
  name: "Exodonkey #13",
  tokenId: "1000002000013",
  chain: "base",
  image: exodonkeyArt,
  type: "Exodonkey",
  color: "Steely Blue",
  horn: "Iron Claw",
  rarityPoints: 5210,
  special: false,
  airdrop: false,
  glitter: "Sapphire Field"
};

const nfb: SampleToken = {
  name: "NFB #3",
  tokenId: "3",
  chain: "base",
  image: winterWonderlandNfb,
  type: "Winter Wonderland NFB",
  color: "",
  horn: "",
  facts: [
    ["Series", "Winter Wonderland"],
    ["Edition", "1"]
  ],
  rarityPoints: null,
  special: false,
  airdrop: false,
  glitter: null
};

/** Every example card: six originals and three that are not standard. */
export const EXAMPLES: readonly SampleToken[] = [
  ...SAMPLES,
  dancefloor,
  exodonkey,
  nfb
];

export const PAGE_STATES = [
  { id: "ready", label: "Ready" },
  { id: "loading", label: "Loading" }
] as const;

export const CONTENT_CASES = [
  { id: "as-is", label: "As is" },
  { id: "long-text", label: "Longest real name and traits" },
  { id: "long-name", label: "Longest short name" },
  { id: "full-name", label: "Longest full name" },
  { id: "unknown-long", label: "Long name, no short form" },
  { id: "low-rarity", label: "Long id, low rarity" },
  { id: "top-rarity", label: "Highest rarity" },
  { id: "no-rarity", label: "No rarity" },
  { id: "no-traits", label: "No traits" },
  { id: "all-flags", label: "Special, Airdrop, Glitter" },
  { id: "solana", label: "Solana mint" },
  { id: "no-artwork", label: "Artwork pending" },
  { id: "no-metadata", label: "Metadata pending" }
] as const;

export const MARKET_STATES = [
  { id: "off", label: "No marketplace" },
  { id: "buy", label: "Listed" },
  { id: "opensea", label: "Listed on OpenSea" },
  { id: "view", label: "Listed, cannot buy" },
  { id: "own", label: "Your listing" },
  { id: "two", label: "Two currencies" },
  { id: "large", label: "Large price" },
  { id: "unlisted", label: "Not listed" },
  { id: "purchased", label: "Purchased" },
  { id: "updating", label: "Updating" },
  { id: "unavailable", label: "Unavailable" }
] as const;

export const COLLECTOR_STATES = [
  { id: "off", label: "Visitor" },
  { id: "hide", label: "Yours: can hide" },
  { id: "show", label: "Hidden: can show" },
  { id: "busy", label: "Saving" }
] as const;

export type PageState = (typeof PAGE_STATES)[number]["id"];
export type ContentCase = (typeof CONTENT_CASES)[number]["id"];
export type MarketState = (typeof MARKET_STATES)[number]["id"];
export type CollectorState = (typeof COLLECTOR_STATES)[number]["id"];

/**
 * The example token reshaped into one of the content cases. The long values
 * are the longest that exist in the collection today: the 41-letter Type,
 * the 18-letter Color and the 15-letter Horn.
 */
export function applyContentCase(
  token: SampleToken,
  contentCase: ContentCase
): SampleToken {
  switch (contentCase) {
    case "as-is":
      return token;
    case "long-text":
      return {
        ...token,
        name: "Flame of a Purple Fire Binance Babydragon",
        facts: [
          ["Color", "Cybertronic Purple"],
          ["Horn", "Diamond Antlers"]
        ]
      };
    case "long-name":
      return { ...token, name: "Star of a Blue Baby Unifairy" };
    case "full-name":
      return { ...token, name: "Colchian Unidragon" };
    case "unknown-long":
      // Made up: what happens to a future long Type with no short form yet.
      return { ...token, name: "Legendary Midnight Aurora Unidragon" };
    case "low-rarity":
      return { ...token, tokenId: "1000001000195", rarityPoints: 40.625 };
    case "top-rarity":
      return { ...token, rarityPoints: 61322000 };
    case "no-rarity":
      return { ...token, rarityPoints: null };
    case "no-traits":
      return { ...token, facts: [], special: false, airdrop: false };
    case "all-flags":
      return {
        ...token,
        special: true,
        airdrop: true,
        glitter: token.glitter ?? "Glitter"
      };
    case "solana":
      return {
        ...token,
        chain: "solana",
        tokenId: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        airdrop: false
      };
    case "no-artwork":
      return { ...token, image: null };
    case "no-metadata":
      return {
        ...token,
        name: null,
        image: null,
        facts: [],
        rarityPoints: null,
        special: false,
        airdrop: false,
        glitter: null
      };
  }
}

const CURRENCY: Record<SampleToken["chain"], string> = {
  ethereum: "ETH",
  base: "ETH",
  polygon: "POL",
  bnb: "BNB",
  solana: "SOL"
};

/** The made-up market strip for one card, or none where there is no marketplace. */
export function marketFor(
  token: SampleToken,
  state: MarketState,
  index: number
): CardMarket | undefined {
  // The marketplace does not cover Solana; the strip stays so the card keeps
  // its size.
  if (token.chain === "solana" && state !== "off")
    return { status: "unlisted" };
  const currency = CURRENCY[token.chain];
  const price = [
    "0.42",
    "0.085",
    "310",
    "0.2",
    "0.5",
    "1.75",
    "12",
    "0.01",
    "3"
  ][index % 9];
  switch (state) {
    case "off":
      return undefined;
    case "buy":
      return { status: "listed", mode: "buy", listings: [{ price, currency }] };
    case "opensea":
      return {
        status: "listed",
        mode: "buy",
        listings: [{ price, currency, opensea: true }]
      };
    case "view":
      return {
        status: "listed",
        mode: "view",
        listings: [{ price, currency }]
      };
    case "own":
      return { status: "listed", mode: "own", listings: [{ price, currency }] };
    case "two":
      return {
        status: "listed",
        mode: "buy",
        listings: [
          { price, currency },
          { price: "1250", currency: "USDC", opensea: true }
        ]
      };
    case "large":
      return {
        status: "listed",
        mode: "buy",
        listings: [{ price: "1250000", currency: "USDC" }]
      };
    default:
      return { status: state };
  }
}
