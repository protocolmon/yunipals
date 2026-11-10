import type { DisplayChainId } from "@/data/chains";

import unidragonArt from "./art/unidragon.webp";
import yopUnichickArt from "./art/yop-unichick.webp";
import theDancefloorArt from "./art/the-dancefloor.webp";
import exodonkeyArt from "./art/exodonkey.webp";
import winterWonderlandNfbArt from "./art/winter-wonderland-nfb.webp";

export type SampleTrait = {
  label: string;
  value: string;
  /** Drop chance in percent, for the traits that count towards rarity. */
  chance?: number;
  /** Unix seconds, for date traits. */
  timestamp?: number;
};

export type SampleTransfer = {
  from: string;
  to: string;
  /** Unix seconds. */
  timestamp: number;
  block: string;
};

export type SampleYunipal = {
  id: string;
  name: string;
  tokenId: string;
  chain: DisplayChainId;
  chainLabel: string;
  image: string;
  /** Formatted rarity points; absent when the token is not scored. */
  rarityPoints?: string;
  description?: string;
  owner: string;
  /** The collector's ENS name, when the wallet has one. */
  ownerName?: string;
  traits: readonly SampleTrait[];
  transfers: readonly SampleTransfer[];
  /** Uncapped rarity points, when a cap lowered the displayed score. */
  rarityRaw?: string;
  /** The NFT on another chain that this Base airdrop was created from. */
  original?: SampleOriginal;
};

export type SampleOriginal = {
  chainLabel: string;
  tokenId: string;
  status?: "burned" | "ownership-unavailable";
};

// Real tokens read from the public indexer on 2026-11-10: traits, the drop
// chances stored in each token's metadata, owners, ENS names and transfers.
// Together they cover every attribute the page has to handle.
export const YUNIPALS: readonly SampleYunipal[] = [
  {
    id: "unidragon",
    name: "Unidragon",
    tokenId: "1000000585",
    chain: "ethereum",
    chainLabel: "Ethereum",
    image: unidragonArt,
    rarityPoints: "40.625",
    description:
      "Adorning both glimmer and self-confidence, the Unidragon is stalwart and courageous. None stands above such a character except for the Bitcoin Unidragon.",
    owner: "0xaee14af01c5b0ddb2ad5a61ad5d59ba5e157eee9",
    traits: [
      { label: "Horn", value: "Wide", chance: 20 },
      { label: "Type", value: "Unidragon", chance: 2 },
      { label: "Color", value: "Blue", chance: 25 },
      { label: "Booster", value: "195" },
      { label: "Glitter", value: "None", chance: 96 },
      { label: "Birthday", value: "", timestamp: 1617211472 },
      { label: "Background", value: "Grassland" },
      { label: "Origin Chain", value: "Ethereum" },
      { label: "First Edition", value: "Yes" },
      { label: "Opening Network", value: "Ethereum" },
      { label: "Last metadata update", value: "", timestamp: 1790031698 }
    ],
    transfers: [
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0xaee14af01c5b0ddb2ad5a61ad5d59ba5e157eee9",
        timestamp: 1617227614,
        block: "12,149,701"
      }
    ]
  },
  {
    id: "yop-unichick",
    name: "YOP Unichick",
    tokenId: "1000001000195",
    chain: "bnb",
    chainLabel: "BNB Chain",
    image: yopUnichickArt,
    rarityPoints: "15,071.506",
    description:
      "At first glance, the majestic YOP Unichick may make you feel intimidated by his piercing blue eyes and strong wings. These attributes, however, are powerful tools necessary to show us an easy and secure way to the yield markets in the complex world of DeFi.",
    owner: "0x31497d9293604b75e5b433b5255340abd4789321",
    ownerName: "mike4ever.eth",
    traits: [
      { label: "Horn", value: "Silver Edge", chance: 20 },
      { label: "Type", value: "YOP Unichick", chance: 0.05 },
      { label: "Color", value: "Galactic Violet", chance: 0.05 },
      { label: "Airdrop", value: "Yes" },
      { label: "Glitter", value: "None", chance: 99 },
      { label: "Special", value: "Yes" },
      { label: "Variant", value: "Rocket Launched" },
      { label: "Birthday", value: "", timestamp: 1655888042 },
      { label: "Background", value: "Defi Launch Pad" },
      { label: "Origin Chain", value: "BNB Chain" },
      { label: "Opening Network", value: "Binance Smart Chain" },
      { label: "Last metadata update", value: "", timestamp: 1790033405 }
    ],
    transfers: [
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x31497d9293604b75e5b433b5255340abd4789321",
        timestamp: 1655904253,
        block: "18,911,779"
      }
    ]
  },
  {
    id: "the-dancefloor",
    name: "The Dancefloor",
    tokenId: "1000794114",
    chain: "ethereum",
    chainLabel: "Ethereum",
    image: theDancefloorArt,
    rarityPoints: "5,238.367",
    owner: "0xe586d7e83dd923ed73fa660b573e48cc254ee2e7",
    traits: [
      { label: "Type", value: "The Dancefloor", chance: 0.33 },
      { label: "Sound", value: "Techno", chance: 5 },
      { label: "Booster", value: "264705" },
      { label: "Special", value: "Yes" },
      { label: "Birthday", value: "", timestamp: 1622072951 },
      { label: "Background", value: "Dancefloor" },
      { label: "Origin Chain", value: "Ethereum" },
      { label: "Opening Network", value: "Ethereum" },
      { label: "Last metadata update", value: "", timestamp: 1790032670 }
    ],
    transfers: [
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x0bbe17ffb2dff302f1eade3f39390cf4ee60f4fc",
        timestamp: 1624153150,
        block: "12,668,356"
      },
      {
        from: "0x0bbe17ffb2dff302f1eade3f39390cf4ee60f4fc",
        to: "0xe586d7e83dd923ed73fa660b573e48cc254ee2e7",
        timestamp: 1624980322,
        block: "12,729,734"
      }
    ]
  },
  {
    id: "exodonkey",
    name: "Exodonkey #13",
    tokenId: "1000002000013",
    chain: "base",
    chainLabel: "Base",
    image: exodonkeyArt,
    rarityPoints: "28,307",
    description:
      "Incredibly popular with young children, it's common to find Exodonkey around schools and homes of young families. Their naturally careful disposition allows them to operate safely around vulnerable populations and can offer aid to their caretakers.",
    owner: "0x719da550453ff1afd4ce5cc648168d768d98f613",
    ownerName: "doslions.eth",
    traits: [
      { label: "Horn", value: "Iron Claw" },
      { label: "Rank", value: "549" },
      { label: "Type", value: "Exodonkey" },
      { label: "Color", value: "Steely Blue" },
      { label: "Glitter", value: "Sapphire Field" },
      { label: "Birthday", value: "", timestamp: 1656432000 },
      { label: "Celestial", value: "Golden Celestial" },
      { label: "Background", value: "Exopolis" },
      { label: "Origin Chain", value: "Solana Mainnet" },
      { label: "Opening Network", value: "Solana" },
      { label: "Last metadata update", value: "", timestamp: 1790031824 }
    ],
    transfers: [
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x719da550453ff1afd4ce5cc648168d768d98f613",
        timestamp: 1732873553,
        block: "23,042,103"
      }
    ]
  },
  {
    id: "winter-wonderland-nfb",
    name: "NFB #3",
    tokenId: "3",
    chain: "base",
    chainLabel: "Base",
    image: winterWonderlandNfbArt,
    description:
      "Our eight newest Unimon arrive in the Winter Wonderland for the very first time! Some of them have gifts in the background. Are you lucky enough to win the big prize? Starting December 24th, open Christmas booster packs to see if you���ve won. These packs are the first to utilize our Non-Fungible Boosters (NFBs) technology. Enjoy!",
    owner: "0x9679862304ef35b7870fd1c80e5994b483d76804",
    traits: [
      { label: "Type", value: "Winter Wonderland NFB" },
      { label: "Series", value: "Winter Wonderland" },
      { label: "Edition", value: "1" },
      { label: "Birthday", value: "", timestamp: 1670603741 },
      { label: "Series Id", value: "1" },
      { label: "Nfb Number", value: "3" },
      { label: "Opening Network", value: "Binance Smart Chain" },
      { label: "Last metadata update", value: "", timestamp: 1790036611 }
    ],
    transfers: [
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x9679862304ef35b7870fd1c80e5994b483d76804",
        timestamp: 1733869635,
        block: "23,540,144"
      }
    ]
  }
];
