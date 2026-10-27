import { isAddress, zeroAddress } from "viem";
import {
  boosterIdentity,
  type BoosterRecentOpening
} from "@protopals/yunipals-market-core/boosters";

import { environment } from "@/environment";
import {
  boosterAddresses,
  boosterAssetUrl,
  type BoosterPage
} from "@/lib/boosters";

const integer = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,77})$/.test(value) &&
  BigInt(value) < 2n ** 256n;

export function parseRecentBoosterOpenings(value: unknown) {
  const deployment = boosterAddresses();
  if (!deployment || !value || typeof value !== "object")
    throw new Error("Recent openings are temporarily unavailable.");
  const page = value as BoosterPage<BoosterRecentOpening>;
  if (
    page.chainId !== 8453 ||
    !page.enabled ||
    page.collection !== deployment.monsters ||
    page.engine !== deployment.engine ||
    !integer(page.indexedBlock) ||
    !integer(page.indexedTimestamp) ||
    !Array.isArray(page.items) ||
    page.items.length > 12
  )
    throw new Error("Recent openings could not be verified.");
  const seen = new Set<string>();
  let previousTime = BigInt(page.indexedTimestamp);
  for (const item of page.items) {
    const monster = item?.monster;
    if (
      !item ||
      !monster ||
      item.engine !== deployment.engine ||
      !integer(item.requestId) ||
      item.requestKey !== boosterIdentity(item.engine, item.requestId) ||
      seen.has(item.requestKey) ||
      typeof item.opening !== "boolean" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      (item.opening && item.quantity !== 1) ||
      !integer(item.revealedAt) ||
      BigInt(item.revealedAt) === 0n ||
      BigInt(item.revealedAt) > previousTime ||
      Number(item.revealedAt) > 8_640_000_000_000 ||
      monster.collection !== deployment.monsters ||
      !integer(monster.tokenId) ||
      monster.id !== boosterIdentity(monster.collection, monster.tokenId) ||
      monster.requestKey !== item.requestKey ||
      monster.isOriginal !== item.opening ||
      typeof monster.burned !== "boolean" ||
      !isAddress(monster.owner) ||
      !isAddress(monster.mintedTo) ||
      monster.mintedTo === zeroAddress ||
      !integer(monster.mintBlock) ||
      BigInt(monster.mintBlock) > BigInt(page.indexedBlock) ||
      ![
        monster.monsterType,
        monster.color,
        monster.horn,
        monster.glitter,
        monster.variantId
      ].every(integer) ||
      !boosterAssetUrl(monster.metadataUri)
    )
      throw new Error("Recent opening details could not be verified.");
    previousTime = BigInt(item.revealedAt);
    seen.add(item.requestKey);
  }
  return page;
}

export async function fetchRecentBoosterOpenings(signal?: AbortSignal) {
  const response = await fetch(
    `${environment.yunipalsIndexerUrl}/v1/boosters/recent-openings?limit=12`,
    { signal, cache: "no-store" }
  );
  if (!response.ok)
    throw new Error("Recent openings are temporarily unavailable.");
  return parseRecentBoosterOpenings(await response.json());
}
