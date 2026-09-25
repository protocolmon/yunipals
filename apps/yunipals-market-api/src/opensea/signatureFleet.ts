import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { Address } from "viem";
import type { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import {
  enqueueMissingOpenSeaSignatures,
  enrichNextOpenSeaSignature
} from "@/opensea/signatureEnrichment";
import {
  SignatureSchedule,
  signatureChains
} from "@/opensea/signatureSchedule";
import { withSignatureWorkerLocks } from "@/opensea/signatureWorkerLock";

export async function runOpenSeaSignatureFleet(input: {
  pool: Pool;
  listingActor: Address;
  service: Pick<OpenSeaFulfillmentService, "preflight">;
  directory: string;
  signal: AbortSignal;
  now?: () => number;
}) {
  return withSignatureWorkerLocks(
    input.pool,
    signatureChains,
    input.signal,
    async (guard) => {
      const schedule = await SignatureSchedule.load(input.directory);
      const started = performance.now();
      const report = Object.fromEntries(
        signatureChains.map((chain) => [
          chain,
          {
            enqueued: 0,
            processed: 0,
            outcomes: {} as Record<string, number>,
            reasons: {} as Record<string, number>
          }
        ])
      );
      let nextSeed = 0;
      while (!guard.signal.aborted) {
        if (schedule.notBefore > Date.now()) {
          try {
            await delay(
              Math.min(60000, schedule.notBefore - Date.now()),
              undefined,
              { signal: guard.signal }
            );
          } catch (error) {
            if (!guard.signal.aborted) throw error;
          }
          continue;
        }
        if (performance.now() >= nextSeed) {
          for (const chain of signatureChains) {
            if (guard.signal.aborted) break;
            report[chain]!.enqueued += await enqueueMissingOpenSeaSignatures(
              input.pool,
              chain,
              new Date(input.now?.() ?? Date.now())
            );
          }
          nextSeed = performance.now() + 15000;
        }
        if (guard.signal.aborted) break;
        const chain = schedule.next;
        const result = await enrichNextOpenSeaSignature({ ...input, chain });
        guard.assertOwner();
        const item = report[chain]!;
        item.outcomes[result.status] = (item.outcomes[result.status] ?? 0) + 1;
        if (result.status !== "idle") item.processed++;
        if ("code" in result && result.code)
          item.reasons[result.code] = (item.reasons[result.code] ?? 0) + 1;
        // A rejected budget reservation did not grant a turn. Keeping this chain
        // next avoids a fixed rotation repeatedly favoring the quota refill phase.
        // Empty chains are skipped without disk writes; completed/failed attempts
        // advance durably, including a drained in-flight operation on shutdown.
        if (result.status === "deferred") await schedule.defer();
        else await schedule.advance(result.status !== "idle");
        try {
          await delay(result.status === "deferred" ? 15000 : 1000, undefined, {
            signal: guard.signal
          });
        } catch (error) {
          if (!guard.signal.aborted) throw error;
        }
      }
      return {
        chains: report,
        nextChain: schedule.next,
        elapsedMs: Math.round(performance.now() - started)
      };
    }
  );
}
