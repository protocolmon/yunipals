import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { collectionAbi } from "../abi.js";
import { COLLECTION_ADDRESS } from "../constants.js";
import { buildTokenUri } from "./build.js";

export async function verifyCurrentBaseUri() {
  const rpcUrl = process.env.PONDER_RPC_URL_1;
  if (!rpcUrl) throw new Error("PONDER_RPC_URL_1 is required");
  const tokenId = process.env.URI_VERIFY_TOKEN_ID ?? "1000000000000";
  if (!/^\d+$/.test(tokenId)) throw new Error("URI_VERIFY_TOKEN_ID must be a decimal token ID");

  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  const [actual, blockNumber] = await Promise.all([
    client.readContract({
      address: COLLECTION_ADDRESS,
      abi: collectionAbi,
      functionName: "tokenURI",
      args: [BigInt(tokenId)]
    }),
    client.getBlockNumber()
  ]);
  const expected = buildTokenUri(tokenId);
  if (actual !== expected) {
    throw new Error(`URI base verification failed for token ${tokenId}: expected ${expected}, received ${actual}`);
  }
  return { tokenId, tokenUri: actual, blockNumber };
}
