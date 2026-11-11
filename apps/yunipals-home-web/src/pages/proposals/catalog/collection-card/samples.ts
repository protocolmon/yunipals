import type { DisplayChainId } from "@/data/chains";

import uniairBlack from "./art/uniair-black.webp";
import uniaquaPurple from "./art/uniaqua-purple.webp";
import unichickYellow from "./art/unichick-yellow.webp";
import unicursedRed from "./art/unicursed-red.webp";
import unidragonBlue from "./art/unidragon-blue.webp";
import unifairyGreen from "./art/unifairy-green.webp";

export type SampleToken = {
  /** Null while the metadata has not been read. */
  name: string | null;
  tokenId: string;
  chain: DisplayChainId;
  /** Null while the artwork is unknown. */
  image: string | null;
  type: string;
  color: string;
  horn: string;
  /** Shown instead of Color and Horn; empty when the token has neither. */
  facts?: readonly (readonly [label: string, value: string])[];
  /** Null for tokens that carry no rarity. */
  rarityPoints: number | null;
  special: boolean;
  /** Airdropped on Base from an original on another chain. */
  airdrop: boolean;
  glitter: string | null;
};

// Artwork, type, colour, horn and token id are real original Yunipals. Chain,
// rarity points, Special, Glitter and Airdrop are varied here to exercise each layout.
export const SAMPLES: readonly SampleToken[] = [
  {
    name: "Unidragon",
    tokenId: "1000000585",
    chain: "base",
    image: unidragonBlue,
    type: "Unidragon",
    color: "Blue",
    horn: "Wide",
    rarityPoints: 3373974.7,
    special: true,
    airdrop: true,
    glitter: "Glitter"
  },
  {
    name: "Uniaqua",
    tokenId: "1000000101",
    chain: "ethereum",
    image: uniaquaPurple,
    type: "Uniaqua",
    color: "Purple",
    horn: "Twisted Wood",
    rarityPoints: 812440.2,
    special: false,
    airdrop: false,
    glitter: null
  },
  {
    name: "Unicursed",
    tokenId: "1000000046",
    chain: "polygon",
    image: unicursedRed,
    type: "Unicursed",
    color: "Red",
    horn: "Normal",
    rarityPoints: 1250300,
    special: true,
    airdrop: false,
    glitter: null
  },
  {
    name: "Unifairy",
    tokenId: "1000000004",
    chain: "base",
    image: unifairyGreen,
    type: "Unifairy",
    color: "Green",
    horn: "Dragon Claw",
    rarityPoints: 96512.4,
    special: false,
    airdrop: true,
    glitter: "Glitter"
  },
  {
    name: "Unichick",
    tokenId: "1000000027",
    chain: "ethereum",
    image: unichickYellow,
    type: "Unichick",
    color: "Yellow",
    horn: "Wide",
    rarityPoints: 45120,
    special: false,
    airdrop: false,
    glitter: null
  },
  {
    name: "Uniair",
    tokenId: "1000003405",
    chain: "base",
    image: uniairBlack,
    type: "Uniair",
    color: "Black",
    horn: "Wide",
    rarityPoints: 2204880.9,
    special: false,
    airdrop: false,
    glitter: "Glitter"
  }
];
