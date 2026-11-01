import { zeroAddress } from "viem";
import { parseMarketAssetId } from "./marketOrder";
import {
  address,
  array,
  boolean,
  decimal,
  integer,
  record,
  string
} from "./validation";

export type CatalogAttribute = { trait_type: string; value: unknown };

function nullableText(value: unknown, max = 256) {
  return value === null ? null : string(value, max);
}
function rarity(value: unknown) {
  const result = nullableText(value, 80);
  if (result !== null && !Number.isFinite(Number(result)))
    throw new Error("Invalid catalog rarity value.");
  return result;
}
export function parseCatalogToken(value: unknown) {
  const data = record(value);
  const asset = parseMarketAssetId(data);
  const owner = address(data.owner);
  if (boolean(data.hidden) || boolean(data.burned) || owner === zeroAddress)
    throw new Error("The public catalog returned an unavailable NFT.");
  const image = nullableText(data.image, 2048);
  if (image) {
    const url = new URL(image, "https://yunipals.com");
    if (
      !["http:", "https:", "ipfs:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("The catalog returned an unsupported artwork URL.");
  }
  const attributes =
    data.attributes === null
      ? null
      : array(
          data.attributes,
          (value): CatalogAttribute => {
            const attribute = record(value);
            const item = attribute.value;
            if (
              item !== null &&
              typeof item !== "boolean" &&
              !(typeof item === "string" && item.length <= 512) &&
              !(typeof item === "number" && Number.isFinite(item))
            )
              throw new Error("Invalid catalog trait value.");
            return {
              trait_type: string(attribute.trait_type, 128),
              value: item
            };
          },
          64
        );
  return {
    ...asset,
    owner,
    hidden: false,
    burned: false,
    lifecycle: integer(data.lifecycle),
    mintBlock: decimal(data.mintBlock),
    lastTransferBlock: decimal(data.lastTransferBlock),
    name: nullableText(data.name),
    image,
    attributes,
    tokenUri: nullableText(data.tokenUri, 2048),
    metadataAvailable: boolean(data.metadataAvailable),
    rarityPoints: rarity(data.rarityPoints),
    rarityPointsCapped: rarity(data.rarityPointsCapped)
  };
}

export type CatalogToken = ReturnType<typeof parseCatalogToken>;
