import { type Address, type PublicClient } from "viem";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";

/** Read presentation artwork at the same block as the original kind configuration. */
export async function readPortalDisplayKind(
  client: Pick<PublicClient, "readContract">,
  collection: Address,
  kindId: bigint,
  blockNumber: bigint
) {
  const at = { address: collection, abi: portalCollectionAbi, blockNumber };
  const [kind, revisionsSupported] = await Promise.all([
    client.readContract({ ...at, functionName: "getKind", args: [kindId] }),
    client.readContract({
      ...at,
      functionName: "supportsInterface",
      args: ["0x49064906"]
    })
  ]);
  // Pre-artwork collection implementations do not advertise ERC-4906.
  if (!revisionsSupported) return kind;
  const artwork = await client.readContract({
    ...at,
    functionName: "kindArtwork",
    args: [kindId]
  });
  return {
    ...kind,
    definition: {
      ...kind.definition,
      imageURI: artwork.imageURI,
      artworkHash: artwork.artworkHash
    }
  };
}
