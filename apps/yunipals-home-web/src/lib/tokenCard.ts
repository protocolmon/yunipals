import type { CollectionToken } from "@/lib/collectionBrowser";
import { getTokenAttribute } from "@/lib/yunipalsIndexer";

/**
 * Card-only short forms of the Type names that do not fit on one line of a
 * card. The Yunipal page, search and filters keep the full name.
 */
const SHORT_NAMES: Record<string, string> = {
  "Flame of a Purple Fire Binance Babydragon": "Flame Babydragon",
  "Moonrock x Morningstar Babydragon": "MxM Babydragon",
  "Binance Smart Chain Unidragon": "BSC Unidragon",
  "Feather of a Blue Uniphoenix": "Blue Uniphoenix",
  "Star of a Blue Baby Unifairy": "Blue Baby Unifairy",
  "Genesis Island Land Ticket": "Land Ticket",
  "Moonrock x Morningstar Egg": "MxM Egg",
  "Hoof of a Green Unidonkey": "Green Unidonkey",
  "Engines of Fury Unitiger": "Fury Unitiger",
  "Polite Raptors Unidonkey": "Raptors Unidonkey",
  "Polkastarter Babydragon": "POLS Babydragon",
  "Binance Baby Unidragon": "BNB Baby Unidragon",
  "Winter Wonderland NFB": "Winter NFB",
  "Moonie Doggie Uniair": "Doggie Uniair",
  "Old Master Unicursed": "Master Unicursed",
  "Skill Guilds Unikles": "Guilds Unikles",
  "Chainlink Uniturtle": "LINK Uniturtle",
  "Christmas Unibranch": "Xmas Unibranch",
  "Moonie Bitty Uniair": "Bitty Uniair",
  "Moonie Ettie Uniair": "Ettie Uniair",
  "Ukrainian Unidonkey": "Ukraine Unidonkey",
  "Ukrainian Unidragon": "Ukraine Unidragon"
};

// Longest first, so "Moonrock x Morningstar Babydragon #7" matches its own
// entry before any shorter one.
const LONG_NAMES = Object.keys(SHORT_NAMES).sort((a, b) => b.length - a.length);

/**
 * The name as a card shows it. A numbered name keeps its number:
 * "Winter Wonderland NFB #3" becomes "Winter NFB #3".
 */
export function cardName(name: string) {
  const long = LONG_NAMES.find(
    (entry) => name === entry || name.startsWith(`${entry} `)
  );
  return long ? `${SHORT_NAMES[long]}${name.slice(long.length)}` : name;
}

/** Presentation tiers from the collection-card design; the score is unchanged. */
const RARITY_MINIMUMS = [
  0, 200, 1_000, 5_000, 30_000, 100_000, 250_000, 1_000_000
];

export function cardRarityLevel(points: string | null) {
  if (points === null || points.trim() === "") return null;
  const numeric = Number(points);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return RARITY_MINIMUMS.filter((minimum) => numeric >= minimum).length;
}

/** Only show facts supplied by this token's metadata. */
export function cardFacts(token: Pick<CollectionToken, "attributes">) {
  const read = (labels: string[]) =>
    labels.flatMap((label) => {
      const value = getTokenAttribute(token, label);
      return !["string", "number", "boolean"].includes(typeof value) ||
        String(value).trim() === ""
        ? []
        : [[label, String(value)] as const];
    });
  const traits = read(["Color", "Horn"]);
  return traits.length ? traits : read(["Sound", "Series", "Edition"]);
}
