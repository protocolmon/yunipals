import {
  decodeEventLog,
  erc20Abi,
  erc721Abi,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  zeroAddress,
  type Hex,
  type PublicClient
} from "viem";
import {
  openseaConduit,
  openseaCurrencies,
  openSeaSpender
} from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  seaportReadAbi,
  seaportWriteAbi,
  seaportFulfillmentOrder
} from "@protopals/yunipals-market-core/seaport";
import { verifySeaportOrderMaker } from "@protopals/yunipals-market-core/verifyOrderMaker";

import { OpenSeaOrderError, type OpenSeaOrderRequest } from "@/opensea/orders";
import type { OpenSeaReadEvidenceCache } from "@/opensea/readEvidenceCache";
import type { IndexedOpenSeaAsset } from "@/opensea/indexer";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);
const conduitAbi = parseAbi([
  "function getConduit(bytes32 conduitKey) view returns (address conduit, bool exists)",
  "function getChannelStatus(address conduit, address channel) view returns (bool isOpen)"
]);

// Actual per-chain runtime hashes captured in the 5 September fork evidence.
// Seaport has chain-specific constructor immutables; the BNB hash is different.
const seaportCodeHashes = {
  ethereum:
    "0x74499ac0cce14428e4b41541d5e44f28f5a6882a1051d0118867c2a93cd5aec0",
  base: "0x2d5cb8553e21a19550413299c05a6493cc606fb0000b5042328a5ba06bfdaf35",
  polygon: "0x24fd52b9fba5545dabf736449aa4f2beed9562a4a641d2f6c85ca05eeed35d52"
} as const;

export function assertOpenSeaRuntimeCode(
  chain: keyof typeof seaportCodeHashes,
  code: Hex | undefined
) {
  if (!code || keccak256(code) !== seaportCodeHashes[chain])
    throw new OpenSeaOrderError("deployment_or_hash_mismatch", 503);
}

export type OpenSeaObservation = {
  chainId: number;
  number: bigint;
  hash: Hex;
  timestamp: bigint;
  checkedAt: number;
  finalizedNumber?: bigint;
  finalizedHash?: Hex;
};
export type OpenSeaObservationOptions = {
  confirmations: bigint;
  indexerMaxAgeMs: number;
  observationMaxAgeMs?: number;
  finality?: "confirmations" | "finalized";
  enabledAdmissionSides?: Partial<
    Record<
      OpenSeaOrderRequest["asset"]["chain"],
      readonly ("listing" | "offer")[]
    >
  >;
  now?: () => number;
  evidence?: OpenSeaReadEvidenceCache;
};

export async function verifyOpenSeaMakerSignature(
  client: PublicClient,
  chain: OpenSeaOrderRequest["asset"]["chain"],
  order: OpenSeaOrderRequest["order"],
  signature: Hex,
  blockNumber: bigint
) {
  if ((await client.getChainId()) !== marketplaceChains[chain].chainId)
    return false;
  if (
    (signature.length === 130 || signature.length === 132) &&
    (await verifySeaportOrderMaker(
      client,
      chain,
      order,
      signature,
      blockNumber
    ).catch(() => false))
  )
    return true;
  // Bulk and other nonstandard bytes go directly to Seaport. A preliminary
  // ERC-1271 call cannot verify a bulk root and can revert on delegated EOAs.
  // A non-maker caller prevents validate from bypassing signature checks.
  try {
    const result = await client.simulateContract({
      address: seaportDeployment.address,
      abi: seaportWriteAbi,
      functionName: "validate",
      args: [[seaportFulfillmentOrder(order, signature)]],
      account:
        order.offerer.toLowerCase() === zeroAddress
          ? seaportDeployment.address
          : zeroAddress,
      blockNumber
    });
    return result.result === true;
  } catch {
    return false;
  }
}

export async function readOpenSeaHead(
  client: PublicClient,
  chain: OpenSeaOrderRequest["asset"]["chain"],
  now: () => number = Date.now,
  finality: "confirmations" | "finalized" = "confirmations"
): Promise<OpenSeaObservation> {
  if (finality !== "confirmations" && finality !== "finalized")
    throw new Error("Invalid OpenSea finality mode.");
  const checkedAt = now();
  // Base finality follows L1 finality plus derivation and batch inclusion. Its
  // finalized head can legitimately be slightly older than 30 minutes even
  // while latest and finalized data are both healthy. Keep the stricter limit
  // for L1 and Polygon, and retain every finalized hash/height fence below.
  const finalizedMaxAgeMs = chain === "base" ? 3600000n : 1800000n;
  const [chainId, block, finalized] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: "latest" }),
    finality === "finalized"
      ? client.getBlock({ blockTag: "finalized" })
      : Promise.resolve(undefined)
  ]);
  if (
    chainId !== marketplaceChains[chain].chainId ||
    !block.hash ||
    block.number === null ||
    block.timestamp * 1000n > BigInt(checkedAt + 30000) ||
    BigInt(checkedAt) - block.timestamp * 1000n > 90000n
  )
    throw new OpenSeaOrderError("chain_unavailable", 503);
  if (
    finality === "finalized" &&
    (!finalized ||
      !finalized.hash ||
      finalized.number === null ||
      finalized.number > block.number ||
      finalized.timestamp > block.timestamp ||
      finalized.timestamp * 1000n > BigInt(checkedAt + 30000) ||
      BigInt(checkedAt) - finalized.timestamp * 1000n > finalizedMaxAgeMs)
  )
    throw new OpenSeaOrderError("chain_finality_unavailable", 503);
  return {
    chainId,
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

export async function assertOpenSeaObservationCurrent(
  client: PublicClient,
  observation: OpenSeaObservation,
  now: () => number = Date.now,
  maxAgeMs = 10000
) {
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > 60000)
    throw new Error("Invalid OpenSea observation age limit.");
  const [chainId, current, finalized, finalizedAnchor] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockNumber: observation.number }),
    observation.finalizedNumber === undefined
      ? Promise.resolve(undefined)
      : client.getBlock({ blockTag: "finalized" }),
    observation.finalizedNumber === undefined
      ? Promise.resolve(undefined)
      : client.getBlock({ blockNumber: observation.finalizedNumber })
  ]);
  if (
    chainId !== observation.chainId ||
    current.number !== observation.number ||
    current.timestamp !== observation.timestamp ||
    current.hash !== observation.hash ||
    (observation.finalizedNumber !== undefined &&
      (!finalized ||
        !finalizedAnchor ||
        finalized.number === null ||
        finalized.number < observation.finalizedNumber ||
        finalizedAnchor.hash !== observation.finalizedHash)) ||
    now() < observation.checkedAt ||
    now() - observation.checkedAt > maxAgeMs
  )
    throw new OpenSeaOrderError("observation_expired", 503);
}

// This protocol-only observation remains usable after the NFT leaves the maker
// or the provider/indexer becomes unavailable. Terminal labels are still revisited
// because a reorg can remove the observed cancellation or fill.
export async function readOpenSeaProtocolState(
  client: PublicClient,
  input: OpenSeaOrderRequest,
  now: () => number = Date.now,
  head?: OpenSeaObservation,
  evidence?: OpenSeaReadEvidenceCache,
  finality: "confirmations" | "finalized" = "confirmations"
) {
  const observed =
    head ?? (await readOpenSeaHead(client, input.asset.chain, now, finality));
  if (observed.chainId !== input.asset.chainId)
    throw new OpenSeaOrderError("chain_unavailable", 503);
  const stateClient = evidence?.at(client, observed) ?? client;
  const [code, hash, counter, status] = await Promise.all([
    stateClient.getCode({
      address: seaportDeployment.address,
      blockNumber: observed.number
    }),
    stateClient.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderHash",
      args: [input.order],
      blockNumber: observed.number
    }),
    stateClient.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getCounter",
      args: [input.order.offerer],
      blockNumber: observed.number
    }),
    stateClient.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderStatus",
      args: [input.hash],
      blockNumber: observed.number
    })
  ]);
  assertOpenSeaRuntimeCode(input.asset.chain, code);
  if (hash.toLowerCase() !== input.hash.toLowerCase())
    throw new OpenSeaOrderError("deployment_or_hash_mismatch", 503);
  return {
    observed,
    orderHash: input.hash,
    counter,
    validated: status[0],
    cancelled: status[1],
    filled: status[2],
    size: status[3]
  };
}
export type OpenSeaProtocolState = Awaited<
  ReturnType<typeof readOpenSeaProtocolState>
>;

export async function inspectOpenSeaAdmission(
  client: PublicClient,
  input: OpenSeaOrderRequest,
  indexed: IndexedOpenSeaAsset,
  options: OpenSeaObservationOptions,
  head?: OpenSeaObservation,
  protocolState?: OpenSeaProtocolState
) {
  const now = options.now ?? Date.now;
  if (
    options.confirmations < 1n ||
    options.confirmations > 10000n ||
    !Number.isSafeInteger(options.indexerMaxAgeMs) ||
    options.indexerMaxAgeMs < 1000 ||
    options.indexerMaxAgeMs > 180000 ||
    (options.finality !== undefined &&
      options.finality !== "confirmations" &&
      options.finality !== "finalized") ||
    (options.observationMaxAgeMs !== undefined &&
      (!Number.isSafeInteger(options.observationMaxAgeMs) ||
        options.observationMaxAgeMs < 1000 ||
        options.observationMaxAgeMs > 60000))
  )
    throw new Error("Invalid OpenSea observation settings.");
  const block =
    head ??
    (await readOpenSeaHead(client, input.asset.chain, now, options.finality));
  const finalityNumber =
    options.finality === "finalized"
      ? block.finalizedNumber
      : block.number - options.confirmations;
  if (finalityNumber === undefined)
    throw new OpenSeaOrderError("chain_finality_unavailable", 503);
  if (block.chainId !== input.asset.chainId)
    throw new OpenSeaOrderError("chain_unavailable", 503);
  const stateClient = options.evidence?.at(client, block) ?? client;
  if (
    indexed.hidden ||
    indexed.burned ||
    indexed.owner === zeroAddress ||
    indexed.lifecycle !== input.lifecycle
  )
    throw new OpenSeaOrderError("asset_changed");
  if (
    indexed.checkpoint.number > block.number ||
    indexed.lastTransfer.blockNumber > finalityNumber ||
    indexed.checkpoint.heartbeatAt > now() + 30000 ||
    now() - indexed.checkpoint.heartbeatAt > options.indexerMaxAgeMs ||
    indexed.checkpoint.timestamp > block.timestamp ||
    (block.timestamp - indexed.checkpoint.timestamp) * 1000n >
      BigInt(options.indexerMaxAgeMs)
  )
    throw new OpenSeaOrderError("indexer_not_finalized_or_stale", 503);
  if (
    input.order.startTime > block.timestamp ||
    input.order.endTime <= block.timestamp
  )
    throw new OpenSeaOrderError("order_not_active");
  const chain = input.asset.chain;
  const listing = input.order.offer[0]?.itemType === 2;
  const spender = openSeaSpender(input.order.conduitKey);
  const [
    protocolStateAtHead,
    owner,
    information,
    conduit,
    channel,
    checkpoint,
    transfers
  ] = await Promise.all([
    protocolState ??
      readOpenSeaProtocolState(
        client,
        input,
        now,
        block,
        options.evidence,
        options.finality
      ),
    stateClient.readContract({
      address: input.asset.contractAddress,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [BigInt(input.asset.tokenId)],
      blockNumber: block.number
    }),
    stateClient.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "information",
      blockNumber: block.number
    }),
    stateClient.readContract({
      address: openseaConduit.controller,
      abi: conduitAbi,
      functionName: "getConduit",
      args: [openseaConduit.key],
      blockNumber: block.number
    }),
    stateClient.readContract({
      address: openseaConduit.controller,
      abi: conduitAbi,
      functionName: "getChannelStatus",
      args: [openseaConduit.address, seaportDeployment.address],
      blockNumber: block.number
    }),
    client.getBlock({ blockNumber: indexed.checkpoint.number }),
    client.getLogs({
      address: input.asset.contractAddress,
      event: transferEvent,
      args: { tokenId: BigInt(input.asset.tokenId) },
      fromBlock: indexed.checkpoint.number,
      toBlock: block.number,
      strict: true
    })
  ]);
  if (
    protocolStateAtHead.orderHash !== input.hash ||
    protocolStateAtHead.observed.hash !== block.hash ||
    protocolStateAtHead.observed.number !== block.number ||
    protocolStateAtHead.observed.chainId !== block.chainId ||
    information[0] !== seaportDeployment.version ||
    getAddress(information[2]) !== getAddress(openseaConduit.controller) ||
    !conduit[1] ||
    getAddress(conduit[0]) !== getAddress(openseaConduit.address) ||
    !channel
  )
    throw new OpenSeaOrderError("deployment_or_hash_mismatch", 503);
  if (checkpoint.timestamp !== indexed.checkpoint.timestamp || !checkpoint.hash)
    throw new OpenSeaOrderError("indexer_checkpoint_invalid", 503);
  if (
    protocolStateAtHead.counter !== input.order.counter ||
    protocolStateAtHead.cancelled ||
    protocolStateAtHead.filled !== 0n
  )
    throw new OpenSeaOrderError("order_invalidated");
  if (
    getAddress(owner) !== indexed.owner ||
    transfers.some(
      (event) =>
        event.removed ||
        event.blockNumber === null ||
        event.logIndex === null ||
        event.blockNumber > indexed.lastTransfer.blockNumber ||
        (event.blockNumber === indexed.lastTransfer.blockNumber &&
          event.logIndex! > indexed.lastTransfer.logIndex)
    )
  )
    throw new OpenSeaOrderError("asset_still_syncing", 503);
  if (
    listing
      ? getAddress(owner) !== getAddress(input.order.offerer)
      : getAddress(owner) === getAddress(input.order.offerer)
  )
    throw new OpenSeaOrderError("maker_ownership_mismatch");
  // Canonical receipt checks bind the current mint/last transfer actually retained
  // by Ponder. Its timestamp-only cursor remains a coverage claim by the indexer,
  // not independent historical hash/finality evidence.
  const receipts = await Promise.all(
    [
      ...new Set([
        indexed.mint.transactionHash,
        indexed.lastTransfer.transactionHash
      ])
    ].map(async (transactionHash) => {
      const receipt = options.evidence
        ? await options.evidence.receipt(client, transactionHash)
        : await client.getTransactionReceipt({ hash: transactionHash });
      const canonical = await client.getBlock({
        blockNumber: receipt.blockNumber
      });
      if (
        receipt.status !== "success" ||
        receipt.transactionHash.toLowerCase() !==
          transactionHash.toLowerCase() ||
        canonical.hash !== receipt.blockHash ||
        receipt.blockNumber > finalityNumber
      ) {
        options.evidence?.forgetReceipt(transactionHash);
        throw new OpenSeaOrderError("indexer_event_not_canonical", 503);
      }
      return receipt;
    })
  );
  const mintReceipt = receipts.find(
    (receipt) =>
      receipt.transactionHash.toLowerCase() ===
      indexed.mint.transactionHash.toLowerCase()
  )!;
  const transferReceipt = receipts.find(
    (receipt) =>
      receipt.transactionHash.toLowerCase() ===
      indexed.lastTransfer.transactionHash.toLowerCase()
  )!;
  const matching = (receipt: typeof transferReceipt) =>
    receipt.logs
      .filter(
        (log) =>
          getAddress(log.address) === getAddress(input.asset.contractAddress)
      )
      .flatMap((log) => {
        try {
          const decoded = decodeEventLog({
            abi: [transferEvent],
            data: log.data,
            topics: log.topics,
            strict: true
          });
          return decoded.args.tokenId === BigInt(input.asset.tokenId)
            ? [{ log, args: decoded.args }]
            : [];
        } catch {
          return [];
        }
      });
  const latest = matching(transferReceipt)
    .sort((a, b) => a.log.logIndex - b.log.logIndex)
    .at(-1);
  const latestMint = matching(mintReceipt)
    .filter((event) => event.args.from === zeroAddress)
    .sort((a, b) => a.log.logIndex - b.log.logIndex)
    .at(-1);
  if (
    mintReceipt.blockNumber !== indexed.mint.blockNumber ||
    !latestMint ||
    getAddress(latestMint.args.to) !== indexed.mint.recipient ||
    transferReceipt.blockNumber !== indexed.lastTransfer.blockNumber ||
    transferReceipt.transactionIndex !==
      indexed.lastTransfer.transactionIndex ||
    !latest ||
    latest.log.logIndex !== indexed.lastTransfer.logIndex ||
    getAddress(latest.args.from) !== indexed.lastTransfer.from ||
    getAddress(latest.args.to) !== indexed.lastTransfer.to
  ) {
    options.evidence?.forgetReceipt(indexed.mint.transactionHash);
    options.evidence?.forgetReceipt(indexed.lastTransfer.transactionHash);
    throw new OpenSeaOrderError("indexer_event_mismatch", 503);
  }
  if (input.order.zone !== zeroAddress) {
    const zoneCode = await stateClient.getCode({
      address: input.order.zone,
      blockNumber: block.number
    });
    if (!zoneCode || zoneCode === "0x")
      throw new OpenSeaOrderError("provider_zone_unavailable", 503);
  }
  if (listing) {
    const [operator, approved] = await Promise.all([
      stateClient.readContract({
        address: input.asset.contractAddress,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [input.order.offerer, spender],
        blockNumber: block.number
      }),
      stateClient.readContract({
        address: input.asset.contractAddress,
        abi: erc721Abi,
        functionName: "getApproved",
        args: [BigInt(input.asset.tokenId)],
        blockNumber: block.number
      })
    ]);
    if (!operator && getAddress(approved) !== getAddress(spender))
      throw new OpenSeaOrderError("nft_approval_required");
  } else {
    const [balance, allowance] = await Promise.all([
      stateClient.readContract({
        address: openseaCurrencies[chain].address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [input.order.offerer],
        blockNumber: block.number
      }),
      stateClient.readContract({
        address: openseaCurrencies[chain].address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [input.order.offerer, spender],
        blockNumber: block.number
      })
    ]);
    if (
      balance < input.order.offer[0]!.startAmount ||
      allowance < input.order.offer[0]!.startAmount
    )
      throw new OpenSeaOrderError("offer_funding_required");
  }
  if (
    !protocolStateAtHead.validated &&
    input.signature &&
    !(await verifyOpenSeaMakerSignature(
      client,
      chain,
      input.order,
      input.signature,
      block.number
    ))
  )
    throw new OpenSeaOrderError("invalid_maker_signature", 400);
  await assertOpenSeaObservationCurrent(
    client,
    block,
    now,
    options.observationMaxAgeMs
  );
  return block;
}
