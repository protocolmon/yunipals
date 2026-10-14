import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  toEventSelector,
  type Hex
} from "viem";
import { base } from "viem/chains";
import { setTimeout as delay } from "node:timers/promises";
import { baseIslandCollection as collection } from "./collections.js";

export const baseIslandsAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)",
  "event AirdropFinalized(uint256 totalSupply,uint256 sourceBlockNumber,bytes32 sourceBlockHash,bytes32 distributionSha256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function SOURCE_CONTRACT() view returns (address)",
  "function SNAPSHOT_JSON_SHA256() view returns (bytes32)",
  "function DISTRIBUTION_CSV_SHA256() view returns (bytes32)",
  "function REPLACES_CONTRACT() view returns (address)",
  "function BASE_METADATA_URI() view returns (string)",
  "function DISTRIBUTION_ROOT() view returns (bytes32)",
  "function REPLACEMENT_SNAPSHOT_BLOCK() view returns (uint256)",
  "function REPLACEMENT_SNAPSHOT_HASH() view returns (bytes32)",
  "function REPLACEMENT_SNAPSHOT_SHA256() view returns (bytes32)",
  "function REVEAL_ASSIGNMENTS_SHA256() view returns (bytes32)"
]);
export const baseIslandTopics = [
  toEventSelector("Transfer(address,address,uint256)"),
  toEventSelector("OwnershipTransferred(address,address)"),
  toEventSelector("AirdropFinalized(uint256,uint256,bytes32,bytes32)")
];
export type RawBaseLog = {
  address: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  logIndex: Hex;
  topics: [Hex, ...Hex[]];
  data: Hex;
};

export type BaseRpcMetrics = {
  startedAtUTC: string;
  methods: Record<string, number>;
  responses: Record<string, number>;
};

export function baseReadClient(url: string, metrics?: BaseRpcMetrics) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    )
  )
    throw new Error("base_islands_rpc_must_use_https_or_local_gateway");
  return createPublicClient({
    chain: base,
    transport: http(url, {
      timeout: 20_000,
      retryCount: 0,
      onFetchRequest: metrics
        ? async (request) => {
            const body: unknown = await request.clone().json();
            for (const entry of Array.isArray(body) ? body : [body]) {
              if (
                entry &&
                typeof entry === "object" &&
                "method" in entry &&
                typeof entry.method === "string"
              )
                metrics.methods[entry.method] =
                  (metrics.methods[entry.method] ?? 0) + 1;
            }
          }
        : undefined,
      onFetchResponse: metrics
        ? (response) => {
            const status = String(response.status);
            metrics.responses[status] = (metrics.responses[status] ?? 0) + 1;
          }
        : undefined
    })
  });
}
export type BaseReadClient = ReturnType<typeof baseReadClient>;

/** Brief free-provider failures may retry; an exhausted CU budget must defer. */
export async function retryBaseRead<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt >= 2 ||
        /budget|compute.units/i.test(message) ||
        !/429|502|503|timeout|timed.out|request.limit|pacing/i.test(message)
      )
        throw error;
      await delay(2000 * (attempt + 1));
    }
  }
}

export function isRangeLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|budget|rate.limit|cooldown|compute.units/i.test(message))
    return false;
  return /block.range|too.many.results|response.*(large|size)|limit.*blocks|query.*exceed|range.*exceed/i.test(
    message
  );
}

/** Split range-limit failures sequentially. A budget failure never fans out into more requests. */
export async function baseLogsAdaptive(
  request: (from: bigint, to: bigint) => Promise<RawBaseLog[]>,
  from: bigint,
  to: bigint
): Promise<RawBaseLog[]> {
  try {
    return await request(from, to);
  } catch (error) {
    if (from === to || !isRangeLimitError(error)) throw error;
    const middle = (from + to) / 2n;
    const left = await baseLogsAdaptive(request, from, middle);
    const right = await baseLogsAdaptive(request, middle + 1n, to);
    return [...left, ...right];
  }
}

export async function getBaseLogs(
  client: BaseReadClient,
  from: bigint,
  to: bigint
) {
  return baseLogsAdaptive(
    async (start, end) =>
      (await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: collection.address,
            topics: [baseIslandTopics],
            fromBlock: `0x${start.toString(16)}`,
            toBlock: `0x${end.toString(16)}`
          }
        ]
      })) as RawBaseLog[],
    from,
    to
  );
}

export function decodeBaseLog(log: RawBaseLog) {
  if (log.address.toLowerCase() !== collection.address)
    throw new Error("base_islands_wrong_contract_log");
  const event = decodeEventLog({
    abi: baseIslandsAbi,
    topics: log.topics,
    data: log.data
  });
  const args = Object.fromEntries(
    Object.entries(event.args).map(([key, value]) => [
      key,
      String(value).toLowerCase()
    ])
  );
  return {
    eventName: event.eventName,
    args,
    id: `base-islands-v2:${log.transactionHash}:${Number(BigInt(log.logIndex))}`,
    blockNumber: BigInt(log.blockNumber),
    blockHash: log.blockHash.toLowerCase(),
    transactionHash: log.transactionHash.toLowerCase(),
    transactionIndex: Number(BigInt(log.transactionIndex)),
    logIndex: Number(BigInt(log.logIndex))
  };
}
