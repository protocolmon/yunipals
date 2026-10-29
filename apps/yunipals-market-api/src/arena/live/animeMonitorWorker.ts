import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { savedMediaFolder } from "./mediaPaths";
import { setTimeout } from "node:timers/promises";
import { createIndexerReader } from "@protopals/yunipals-indexer-server/readers";
import { readAnimeFighters } from "@protopals/yunipals-indexer-server/anime";
import { ANIME_BASE_COLLECTION } from "@protopals/yunipals-market-core/anime";
import { arenaRuntime } from "./runtime";
const runtime = await arenaRuntime({ native: true });
if (!runtime.anime || !runtime.sourcePool)
  throw new Error("Anime monitor requires its native registry source.");
let stopped = false,
  lastReport = "",
  verifiedAt = 0;
let lastVerificationIssues: string[] = [];
process.once("SIGTERM", () => {
  stopped = true;
});
process.once("SIGINT", () => {
  stopped = true;
});
try {
  while (!stopped) {
    try {
      const reader = await createIndexerReader(runtime.sourcePool, {
        releaseId: process.env.ARENA_INDEXER_RELEASE_ID
      });
      const queue = await readAnimeFighters(reader, {
        status: "Applied",
        limit: 1,
        registry: runtime.anime.registry
      });
      const oldest = queue.items[0]?.appliedBlock;
      const block = oldest
        ? await runtime.anime.client.getBlock({ blockNumber: BigInt(oldest) })
        : null;
      const attention = (
        await runtime.pool.query<{ token_id: string }>(
          "SELECT tournament_id::text AS token_id FROM yunipals_arena.media_job WHERE deployment=$1 AND (state='needs-attention' OR (state<>'ready' AND updated_at<now()-interval '20 minutes')) ORDER BY tournament_id LIMIT 100",
          [runtime.config.deployment.id]
        )
      ).rows.map((r) => r.token_id);
      const issues: string[] = [];
      if (Date.now() - verifiedAt > 86400000) {
        let cursor: string | undefined;
        const head = await runtime.anime.client.getBlock({
          blockTag: "latest"
        });
        do {
          const page = await readAnimeFighters(reader, {
            status: "Approved",
            limit: 100,
            cursor,
            registry: runtime.anime.registry
          });
          for (const fighter of page.items) {
            try {
              await runtime.anime.eligible(
                {
                  nftChainId: 8453,
                  collection: ANIME_BASE_COLLECTION,
                  tokenId: fighter.tokenId
                },
                head.number
              );
              await runtime.anime.manifest(
                fighter.tokenId,
                fighter.manifestHash,
                true
              );
            } catch {
              issues.push(fighter.tokenId);
            }
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor && !stopped);
        lastVerificationIssues = issues;
        verifiedAt = Date.now();
      }
      const assetsHealthy = await fetch(
        `${runtime.anime.origin}/recipes/anime-fighter-v1/recipe-lock.json`,
        {
          method: "HEAD",
          redirect: "error",
          signal: AbortSignal.timeout(15000)
        }
      )
        .then((r) => r.ok)
        .catch(() => false);
      const recent = (
        await runtime.pool.query<{ id: string; incarnation: string }>(
          "SELECT tournament_id::text AS id,incarnation FROM yunipals_arena.media_job WHERE deployment=$1 AND state='ready' ORDER BY updated_at DESC LIMIT 1",
          [runtime.config.deployment.id]
        )
      ).rows[0];
      let lastRender: { tournamentId: string; wallMs: number | null } | null =
        null;
      if (recent && process.env.ARENA_MEDIA_ROOT) {
        const folder = await savedMediaFolder(
          runtime.pool,
          join(process.env.ARENA_MEDIA_ROOT, "published"),
          runtime.config.deployment.id,
          recent.id,
          recent.incarnation
        );
        const receipt = JSON.parse(
          await readFile(join(folder, "receipts.json"), "utf8")
        );
        lastRender = {
          tournamentId: recent.id,
          wallMs: Number.isSafeInteger(receipt.renderWallMs)
            ? receipt.renderWallMs
            : null
        };
      }
      const report = {
        lastRender,
        assetsHealthy,
        event: "anime_health",
        counts: queue.counts,
        queueOverSevenDays: block
          ? Date.now() - Number(block.timestamp) * 1000 > 604800000
          : false,
        oldestAppliedBlock: oldest ?? null,
        renderAttention: attention,
        fightersNeedingReview: lastVerificationIssues
      };
      const current = JSON.stringify(report);
      if (current !== lastReport) {
        console.log(current);
        lastReport = current;
      }
    } catch {
      if (lastReport !== "unavailable") {
        console.error(
          "Anime monitor unavailable; inspect registry coverage, asset health and render jobs."
        );
        lastReport = "unavailable";
      }
    }
    for (let i = 0; i < 60 && !stopped; i++) await setTimeout(5000);
  }
} finally {
  await runtime.close();
}
