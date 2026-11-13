import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { portalCompetitionAbi } from "../../../packages/yunipals-market-core/src/portalAbi.js";
import {
  portalEventAbis,
  type PortalEventSource
} from "../../../packages/yunipals-market-core/src/portalIndex.js";
import { portalContracts } from "../lib/unified/portal-sources.js";
import {
  applySharedPortalEvent,
  type PortalRows,
  type PortalDomain,
  type PortalProjectionStore
} from "../lib/unified/portal-projection.js";
import {
  recordCanonicalEvent,
  sourceManifest
} from "../lib/unified/handlers.js";
import type { Address } from "viem";

type PortalEventName = Exclude<
  Extract<Parameters<typeof ponder.on>[0], `Portal${string}:${string}`>,
  `${string}:setup`
>;

if (
  process.env.PONDER_ISLANDS_ONLY !== "true" &&
  process.env.PONDER_BOOSTERS_ONLY !== "true"
) {
  for (const kind of Object.keys(portalContracts) as PortalEventSource[]) {
    for (const item of portalEventAbis[kind]) {
      ponder.on(
        `${portalContracts[kind]}:${item.name}` as PortalEventName,
        async ({ event, context }) => {
          const source = sourceManifest.sources.find(
            (row) => row.id === `portals:8453:${kind}`
          );
          const collection = sourceManifest.sources.find(
            (row) => row.id === "portals:8453:collection"
          );
          const grading = sourceManifest.sources.find(
            (row) => row.id === "portals:8453:grading"
          );
          const competition = sourceManifest.sources.find(
            (row) => row.id === "portals:8453:competition"
          );
          if (
            !source?.enabled ||
            !collection?.address ||
            !grading?.address ||
            !competition?.address
          )
            throw new Error("Unregistered portal deployment.");
          const previous = await context.db.find(schema.canonicalEvent, {
            id: `${context.chain.id}:${event.log.address.toLowerCase()}:${event.transaction.hash}:${event.log.logIndex}`
          });
          if (previous) {
            if (
              previous.blockHash !== event.block.hash ||
              previous.data !== event.log.data ||
              previous.topics !== JSON.stringify(event.log.topics) ||
              previous.args !==
                JSON.stringify(event.args, (_key, value: unknown) =>
                  typeof value === "bigint" ? value.toString() : value
                ) ||
              previous.name !== item.name
            )
              throw new Error(
                "Conflicting portal event replay requires rollback."
              );
            return;
          }
          const eventId = await recordCanonicalEvent(
            source.id,
            item.name,
            event,
            context
          );
          const deployment = `${context.chain.id}:${collection.address}:${grading.address}`;
          const key = (domain: PortalDomain, id: string) =>
            `${deployment}:${domain}:${id}`;
          const store: PortalProjectionStore = {
            async get<K extends PortalDomain>(domain: K, id: string) {
              const row = await context.db.find(schema.portalProjection, {
                id: key(domain, id)
              });
              return row ? (row.value as unknown as PortalRows[K]) : null;
            },
            async put<K extends PortalDomain>(
              domain: K,
              id: string,
              value: PortalRows[K]
            ) {
              const entity = key(domain, id);
              const data = value as unknown as Record<string, unknown>;
              await context.db
                .insert(schema.portalProjection)
                .values({ id: entity, value: data })
                .onConflictDoUpdate({ value: data });
              await context.db.insert(schema.portalProjectionVersion).values({
                id: `${eventId}:${entity}`,
                entity,
                deployment,
                domain,
                value: data,
                blockNumber: event.block.number,
                transactionIndex: event.transaction.transactionIndex,
                logIndex: event.log.logIndex
              });
            }
          };
          const args = Object.fromEntries(
            Object.entries(event.args ?? {}).map(([key, value]) => [
              key,
              String(value)
            ])
          );
          const rules =
            item.name.startsWith("Competition") &&
            ![
              "CompetitionConfigured",
              "CompetitionNotificationDeferred"
            ].includes(item.name)
              ? {
                  batchSize: await context.client.readContract({
                    address: competition.address as Address,
                    abi: portalCompetitionAbi,
                    functionName: "BATCH_SIZE",
                    blockNumber: event.block.number
                  }),
                  contribution: await context.client.readContract({
                    address: competition.address as Address,
                    abi: portalCompetitionAbi,
                    functionName: "CONTRIBUTION",
                    blockNumber: event.block.number
                  })
                }
              : { batchSize: 111n, contribution: 500000n };
          await applySharedPortalEvent(
            store,
            {
              type: item.name,
              tokenId:
                args.portalId ??
                (kind === "collection" ? args.tokenId : undefined) ??
                "0",
              source: event.log.address.toLowerCase(),
              args,
              block: String(event.block.number),
              blockHash: event.block.hash,
              transactionHash: event.transaction.hash,
              transactionIndex: event.transaction.transactionIndex,
              logIndex: event.log.logIndex
            },
            rules
          );
        }
      );
    }
  }
}
