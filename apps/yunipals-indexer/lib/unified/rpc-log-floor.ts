import { RpcError, type HttpTransport } from "viem";
import {
  validateUnifiedRpcCalls,
  UnifiedRpcRangeError,
  type UnifiedRpcCall,
  type UnifiedRpcProfile
} from "../../../../packages/yunipals-indexer-server/src/rpc-policy.js";

// Ponder uses the earliest start block for an address array, then queries each
// address separately. A later deployment has no logs before its reviewed start.
export function reviewedLogRange(
  call: UnifiedRpcCall,
  profile: UnifiedRpcProfile,
  chainId: number
): UnifiedRpcCall | null {
  if (
    call.method !== "eth_getLogs" ||
    !Array.isArray(call.params) ||
    call.params.length !== 1
  )
    return call;
  const filter: unknown = call.params[0];
  if (!filter || typeof filter !== "object" || Array.isArray(filter))
    return call;
  const value = filter as Record<string, unknown>;
  if (
    typeof value.fromBlock !== "string" ||
    typeof value.toBlock !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(value.fromBlock) ||
    !/^0x[0-9a-fA-F]+$/.test(value.toBlock)
  )
    return call;
  const addresses = Array.isArray(value.address)
    ? value.address
    : [value.address];
  if (!addresses.length) return call;
  const starts = addresses.map((address) => {
    if (typeof address !== "string") return null;
    const sources = profile.manifest.sources.filter(
      (source) =>
        source.enabled &&
        source.chainId === chainId &&
        source.address?.toLowerCase() === address.toLowerCase()
    );
    return sources.length
      ? sources.reduce(
          (start, source) =>
            BigInt(source.startBlock!) < start
              ? BigInt(source.startBlock!)
              : start,
          BigInt(sources[0]!.startBlock!)
        )
      : null;
  });
  if (starts.some((start) => start === null)) return call;
  const floor = (starts as bigint[]).reduce((a, b) => (a < b ? a : b));
  const from = BigInt(value.fromBlock),
    to = BigInt(value.toBlock);
  if (from >= floor) return call;
  if (to < from) throw Error("Invalid historical log range.");
  const adjusted = {
    ...call,
    params: [
      {
        ...value,
        fromBlock: `0x${floor.toString(16)}`,
        toBlock: `0x${(to < floor ? floor : to).toString(16)}`
      }
    ]
  };
  // Validate even an empty interval: unknown keys, addresses and malformed
  // topics never become a successful local response.
  validateUnifiedRpcCalls(profile, chainId, [adjusted]);
  return to < floor ? null : adjusted;
}

export function withReviewedLogFloors(
  transport: HttpTransport,
  profile: UnifiedRpcProfile,
  chainId: number
): HttpTransport {
  return (parameters) => {
    const initialized = transport(parameters);
    const request = async (
      args: Parameters<typeof initialized.request>[0],
      options?: Parameters<typeof initialized.request>[1]
    ): Promise<unknown> => {
      let adjusted;
      try {
        adjusted = reviewedLogRange(args, profile, chainId);
      } catch (error) {
        if (error instanceof UnifiedRpcRangeError)
          throw new RpcError(error, {
            code: -32005,
            shortMessage: `Max range: ${error.maximum}`
          });
        throw error;
      }
      if (adjusted === null) return [];
      return initialized.request(adjusted as typeof args, options);
    };
    return { ...initialized, request: request as typeof initialized.request };
  };
}
