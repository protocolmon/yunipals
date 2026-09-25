import type { Pool } from "pg";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";

const namespace = 1970171497;

/** Session locks exclude overlapping fleet and updated single-chain runtimes. */
export async function withSignatureWorkerLocks<T>(
  pool: Pool,
  chains: readonly OpenSeaChain[],
  signal: AbortSignal,
  task: (guard: { signal: AbortSignal; assertOwner: () => void }) => Promise<T>
) {
  if (
    !chains.length ||
    chains.some((chain) => !isOpenSeaChain(chain)) ||
    new Set(chains).size !== chains.length ||
    (pool.options.max ?? 10) < 2
  )
    throw new Error("Invalid signature worker lock configuration.");
  const client = await pool.connect();
  const acquired: number[] = [];
  const lost = new AbortController();
  const onError = () => lost.abort();
  client.on("error", onError);
  const assertOwner = () => {
    if (lost.signal.aborted)
      throw new Error("Signature worker lost its coordinator session.");
  };
  try {
    for (const chainId of chains
      .map((chain) => marketplaceChains[chain].chainId)
      .sort((a, b) => a - b)) {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1,$2) AS acquired",
        [namespace, chainId]
      );
      if (!result.rows[0]?.acquired)
        throw new Error("A signature worker already owns this chain.");
      acquired.push(chainId);
    }
    const result = await task({
      signal: AbortSignal.any([signal, lost.signal]),
      assertOwner
    });
    assertOwner();
    return result;
  } finally {
    try {
      if (!lost.signal.aborted)
        for (const chainId of acquired.reverse())
          await client.query("SELECT pg_advisory_unlock($1,$2)", [
            namespace,
            chainId
          ]);
    } finally {
      client.removeListener("error", onError);
      client.release(true);
    }
  }
}
