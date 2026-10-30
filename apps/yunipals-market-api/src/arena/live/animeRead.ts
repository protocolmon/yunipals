import { createIndexerReader } from "@protopals/yunipals-indexer-server/readers";
import {
  readAnimeFighter,
  readAnimeFighters
} from "@protopals/yunipals-indexer-server/anime";
import {
  ANIME_BASE_COLLECTION,
  ANIME_STATUSES,
  animeTokenId,
  type AnimeStatus
} from "@protopals/yunipals-market-core/anime";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import type { arenaRuntime } from "./runtime";
import { ArenaRequestError } from "./intake";

export function animeRead(runtime: Awaited<ReturnType<typeof arenaRuntime>>) {
  const reader = async () => {
    if (!runtime.sourcePool)
      throw new Error("Anime indexing is not configured.");
    return createIndexerReader(runtime.sourcePool, {
      releaseId: process.env.ARENA_INDEXER_RELEASE_ID
    });
  };
  let intake: { value: boolean; expires: number } | null = null;
  let intakePending: Promise<boolean> | null = null;
  const applicationsOpen = async () => {
    if (intake && intake.expires > Date.now()) return intake.value;
    if (intakePending) return intakePending;
    intakePending = runtime
      .anime!.client.readContract({
        address: runtime.anime!.registry,
        abi: animeRegistryAbi,
        functionName: "applicationsOpen"
      })
      .then((value) => {
        intake = { value, expires: Date.now() + 60000 };
        return value;
      });
    try {
      return await intakePending;
    } finally {
      intakePending = null;
    }
  };
  const cache = new Map<
    string,
    {
      expires: number;
      value: Awaited<ReturnType<NonNullable<typeof runtime.anime>["status"]>>;
    }
  >();
  return {
    fighter: async (tokenId: string) => {
      try {
        animeTokenId(tokenId);
      } catch {
        throw new ArenaRequestError(400, "Invalid Base token ID.");
      }
      const selected = await reader();
      // Before the one source transition only, bounded cached calls can show status.
      // Never conceal a stale/corrupt registered source with RPC fallback.
      if (
        !selected.release.manifest.sources.some(
          (s) => s.id === "anime-registry:8453" && s.enabled
        )
      ) {
        let item = cache.get(tokenId);
        if (!item || item.expires < Date.now()) {
          item = {
            value: await runtime.anime!.status(tokenId),
            expires: Date.now() + 60000
          };
          if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
          cache.set(tokenId, item);
        }
        return {
          fighter: {
            ...item.value,
            applicant: null,
            reasonCode: null,
            note: null,
            appliedBlock: null,
            queuePosition: null
          },
          source: "cached-contract-call",
          notePendingIndexing: true,
          registry: runtime.config.eligibilityRegistry,
          applicationsOpen: await applicationsOpen(),
          assetsOrigin: runtime.config.fighterAssetsOrigin
        };
      }
      const result = await readAnimeFighter(
        selected,
        tokenId,
        runtime.config.eligibilityRegistry
      );
      const fighter = result.fighter ?? {
        tokenId,
        status: "None",
        applications: 0,
        recipeVersion: 0,
        manifestHash: `0x${"0".repeat(64)}`,
        applicant: null,
        reasonCode: null,
        note: null,
        appliedBlock: null,
        queuePosition: null
      };
      const manifest =
        fighter.status === "Approved"
          ? await runtime
              .anime!.manifest(tokenId, fighter.manifestHash)
              .catch(() => null)
          : null;
      return {
        ...result,
        fighter,
        registry: runtime.config.eligibilityRegistry,
        applicationsOpen: await applicationsOpen(),
        assetsOrigin: runtime.config.fighterAssetsOrigin,
        manifest,
        artworkState: manifest ? "verified" : "unavailable"
      };
    },
    fighterQueue: async (query: Record<string, string>) => {
      if (
        query.status !== undefined &&
        !ANIME_STATUSES.includes(query.status as AnimeStatus)
      )
        throw new ArenaRequestError(400, "Invalid fighter status.");
      const limit = Number(query.limit ?? 24);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (query.cursor?.length ?? 0) > 2048
      )
        throw new ArenaRequestError(400, "Invalid queue pagination.");
      const page = await readAnimeFighters(await reader(), {
        status: query.status as AnimeStatus | undefined,
        cursor: query.cursor,
        limit,
        registry: runtime.config.eligibilityRegistry
      });
      const approved = page.items.filter((f) => f.status === "Approved");
      if (approved.length) {
        const head = await runtime.anime!.client.getBlock({
          blockTag: "latest"
        });
        for (let i = 0; i < approved.length; i += 4)
          await Promise.all(
            approved.slice(i, i + 4).map(async (f) => {
              try {
                await runtime.anime!.eligible(
                  {
                    nftChainId: 8453,
                    collection: ANIME_BASE_COLLECTION,
                    tokenId: f.tokenId
                  },
                  head.number
                );
                f.reviewRequired = false;
              } catch {
                f.reviewRequired = true;
              }
            })
          );
      }
      return page;
    }
  };
}
