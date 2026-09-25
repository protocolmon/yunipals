import {
  createPublicClient,
  custom,
  numberToHex,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";

type Entry = { value: unknown; bytes: number; expiresAt: number };

// One cache belongs to one RPC client. State reads are pinned with EIP-1898;
// current heads, canonical headers, chain IDs and transfer ranges are never cached.
// Receipt consumers must still check their canonical header on every observation.
export class OpenSeaReadEvidenceCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  constructor(
    private readonly client: PublicClient,
    private readonly limits = {
      entries: 4096,
      bytes: 16 * 1024 * 1024,
      entryBytes: 256 * 1024,
      ttlMs: 300000
    },
    private readonly now: () => number = () => performance.now()
  ) {
    if (
      Object.values(limits).some((n) => !Number.isSafeInteger(n) || n < 1) ||
      limits.entries > 10000 ||
      limits.bytes > 64 * 1024 * 1024 ||
      limits.entryBytes > limits.bytes ||
      limits.ttlMs > 300000
    )
      throw new Error("Invalid read evidence cache limits.");
    this.limits = { ...limits };
  }
  private remove(key: string) {
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(key);
      this.evictions++;
    }
  }
  private async read<T>(
    key: string,
    load: () => Promise<T>,
    reusable: (value: T) => boolean
  ): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      this.hits++;
      return structuredClone(entry.value) as T;
    }
    this.remove(key);
    const existing = this.pending.get(key);
    if (existing) {
      this.hits++;
      return structuredClone(await existing) as T;
    }
    this.misses++;
    const request = (async () => {
      const value = await load();
      if (reusable(value)) {
        const bytes =
          Buffer.byteLength(key) +
          Buffer.byteLength(
            JSON.stringify(value, (_key, item) =>
              typeof item === "bigint" ? item.toString() : item
            )
          );
        if (bytes <= this.limits.entryBytes) {
          this.remove(key);
          while (
            this.entries.size >= this.limits.entries ||
            this.bytes + bytes > this.limits.bytes
          )
            this.remove(this.entries.keys().next().value!);
          this.entries.set(key, {
            value: structuredClone(value),
            bytes,
            expiresAt: this.now() + this.limits.ttlMs
          });
          this.bytes += bytes;
        }
      }
      return value;
    })();
    // Bound temporary sharing too. The underlying worker already bounds lanes.
    if (this.pending.size < 128) this.pending.set(key, request);
    try {
      return structuredClone(await request);
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }
  at(client: PublicClient, block: { number: bigint; hash: Hex }): PublicClient {
    if (client !== this.client)
      throw new Error("Read evidence cache client mismatch.");
    const height = numberToHex(block.number);
    // EIP-1898 object parameters are not in this viem version's request schema.
    // Use the client's dispatch wrapper: transport.request is the raw function
    // from its configuration and bypasses instrumentation/middleware.
    const request = client.request as (args: {
      method: string;
      params?: readonly unknown[];
    }) => Promise<unknown>;
    return createPublicClient({
      cacheTime: 0,
      transport: custom(
        {
          request: async (args: {
            method: string;
            params?: readonly unknown[];
          }) => {
            const params = args.params;
            if (
              (args.method !== "eth_call" && args.method !== "eth_getCode") ||
              params?.length !== 2 ||
              params[1] !== height
            )
              return request(args);
            const pinned = [
              params[0],
              { blockHash: block.hash, requireCanonical: true }
            ];
            const key = JSON.stringify([args.method, pinned]);
            return this.read(
              key,
              () =>
                request({
                  method: args.method,
                  params: pinned
                }),
              (value) =>
                typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value)
            );
          }
        },
        { retryCount: 0 }
      )
    });
  }
  receipt(client: PublicClient, hash: Hex): Promise<TransactionReceipt> {
    if (client !== this.client)
      throw new Error("Read evidence cache client mismatch.");
    return this.read(
      `receipt:${hash.toLowerCase()}`,
      () => client.getTransactionReceipt({ hash }),
      (receipt) =>
        receipt.status === "success" &&
        typeof receipt.blockNumber === "bigint" &&
        receipt.blockNumber >= 0n &&
        typeof receipt.blockHash === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) &&
        Array.isArray(receipt.logs) &&
        receipt.transactionHash.toLowerCase() === hash.toLowerCase()
    );
  }
  forgetReceipt(hash: Hex) {
    this.remove(`receipt:${hash.toLowerCase()}`);
  }
  snapshot() {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entries: this.entries.size,
      retainedBytes: this.bytes,
      pending: this.pending.size
    };
  }
}
