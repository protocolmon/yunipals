import { keccak256, type Hex, type PublicClient } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportReadAbi } from "@protopals/yunipals-market-core/seaport";

import { BnbOrderError, type BnbOrderRequest } from "@/bnb/orders";

export const seaportCodeHash =
  "0x16bd146d392a011a996f447b813623d4857ba2d7621af38194a009cbc03ab5f4";
export const bnbObservationMaxAgeMs = 30000;
export type BnbObservation = {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
  checkedAt: number;
  finalizedNumber?: bigint;
  finalizedHash?: Hex;
};
export type BnbProtocolState = Awaited<ReturnType<typeof readBnbProtocolState>>;

export async function readBnbHead(
  client: PublicClient,
  now: () => number = Date.now,
  finality: "confirmations" | "finalized" = "confirmations"
): Promise<BnbObservation> {
  if (finality !== "confirmations" && finality !== "finalized")
    throw new Error("Invalid BNB finality mode.");
  const checkedAt = now();
  // BNB finalizes close to the head and produces blocks quickly. Reading
  // `latest` and `finalized` concurrently can observe latest=N followed by
  // finalized=N+1 when the node processes the latter after a new block. Read
  // the finalized anchor first, then a head that must include it.
  const [chainId, finalized] = await Promise.all([
    client.getChainId(),
    finality === "finalized"
      ? client.getBlock({ blockTag: "finalized" })
      : Promise.resolve(undefined)
  ]);
  const block = await client.getBlock({ blockTag: "latest" });
  if (
    chainId !== 56 ||
    !block.hash ||
    block.number === null ||
    block.timestamp * 1000n > BigInt(checkedAt + 30000) ||
    BigInt(checkedAt) - block.timestamp * 1000n > 90000n
  )
    throw new BnbOrderError("chain_unavailable", 503);
  if (
    finality === "finalized" &&
    (!finalized ||
      !finalized.hash ||
      finalized.number === null ||
      finalized.number > block.number ||
      finalized.timestamp > block.timestamp ||
      finalized.timestamp * 1000n > BigInt(checkedAt + 30000) ||
      BigInt(checkedAt) - finalized.timestamp * 1000n > 360000n)
  )
    throw new BnbOrderError("chain_finality_unavailable", 503);
  return {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp,
    checkedAt,
    ...(finalized
      ? {
          finalizedNumber: finalized.number!,
          finalizedHash: finalized.hash!
        }
      : {})
  };
}

export async function readBnbProtocolState(
  client: PublicClient,
  input: Pick<BnbOrderRequest, "order" | "hash">,
  now: () => number = Date.now,
  finality: "confirmations" | "finalized" = "confirmations"
) {
  const block = await readBnbHead(client, now, finality);
  const [code, contractHash, counter, status] = await Promise.all([
    client.getCode({
      address: seaportDeployment.address,
      blockNumber: block.number
    }),
    client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderHash",
      args: [input.order],
      blockNumber: block.number
    }),
    client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getCounter",
      args: [input.order.offerer],
      blockNumber: block.number
    }),
    client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderStatus",
      args: [input.hash],
      blockNumber: block.number
    })
  ]);
  if (
    !code ||
    keccak256(code) !== seaportCodeHash ||
    contractHash.toLowerCase() !== input.hash.toLowerCase()
  )
    throw new BnbOrderError("deployment_or_hash_mismatch", 503);
  return {
    orderHash: input.hash,
    observed: block,
    counter,
    validated: status[0],
    cancelled: status[1],
    filled: status[2],
    size: status[3]
  };
}

export async function assertBnbObservationCurrent(
  client: PublicClient,
  observed: BnbObservation,
  now: () => number = Date.now
) {
  const [canonical, finalized, finalizedAnchor] = await Promise.all([
    client.getBlock({ blockNumber: observed.number }),
    observed.finalizedNumber === undefined
      ? Promise.resolve(undefined)
      : client.getBlock({ blockTag: "finalized" }),
    observed.finalizedNumber === undefined
      ? Promise.resolve(undefined)
      : client.getBlock({ blockNumber: observed.finalizedNumber })
  ]);
  if (
    canonical.hash !== observed.hash ||
    (observed.finalizedNumber !== undefined &&
      (!finalized ||
        !finalizedAnchor ||
        finalized.number === null ||
        finalized.number < observed.finalizedNumber ||
        finalizedAnchor.hash !== observed.finalizedHash)) ||
    // The production RPC proxy intentionally dispatches at about one request
    // per second to bound provider spend. Admission rechecks both the observed
    // head and finalized anchor here, so allow the complete bounded read set to
    // finish without weakening either canonicality check.
    now() - observed.checkedAt > bnbObservationMaxAgeMs
  )
    throw new BnbOrderError("observation_expired", 503);
}
