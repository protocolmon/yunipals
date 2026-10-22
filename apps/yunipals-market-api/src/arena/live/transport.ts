import { createTransport, type EIP1193RequestFn, type Transport } from "viem";

/** Keep every read on the CU coordinator. Only already signed broadcasts use
 * the separate submission endpoint; neither route falls back to the other. */
export function arenaTransport(
  reads: Transport,
  broadcasts?: Transport
): Transport {
  return (options) => {
    const reader = reads(options);
    const writer = broadcasts?.(options);
    // Preserve the underlying provider's generic response type at this routing boundary.
    const route = (async (request: Parameters<EIP1193RequestFn>[0]) => {
      if (request.method === "eth_sendRawTransaction") {
        if (!writer) throw new Error("Arena broadcast endpoint is disabled.");
        return writer.request(request);
      }
      return reader.request(request);
    }) as EIP1193RequestFn;
    return createTransport({
      key: "arena-budgeted",
      name: "Arena budgeted reads and signed broadcasts",
      type: "custom",
      retryCount: 0,
      request: route
    });
  };
}
