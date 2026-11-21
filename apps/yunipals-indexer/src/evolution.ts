import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import {
  evolutionContracts,
  evolutionEventAbis,
  type EvolutionEventSource
} from "../lib/unified/evolution-sources.js";
import {
  recordCanonicalEvent,
  sourceManifest
} from "../lib/unified/handlers.js";
import {
  applyEvolutionEvent,
  type EvolutionProjectionStore
} from "../lib/evolution/projection.js";

type EventName = Exclude<
  Extract<
    Parameters<typeof ponder.on>[0],
    `Yunipal${string}:${string}` | `EvolutionCollection:${string}`
  >,
  `${string}:setup`
>;
if (
  process.env.PONDER_ISLANDS_ONLY !== "true" &&
  process.env.PONDER_BOOSTERS_ONLY !== "true"
) {
  for (const kind of Object.keys(
    evolutionContracts
  ) as EvolutionEventSource[]) {
    for (const abi of evolutionEventAbis[kind]) {
      ponder.on(
        `${evolutionContracts[kind]}:${abi.name}` as EventName,
        async ({ event, context }) => {
          const source = sourceManifest.sources.find(
            (v) => v.id === `evolution:8453:${kind}`
          );
          const controller = sourceManifest.sources.find(
            (v) => v.id === "evolution:8453:evolution"
          );
          if (!source?.enabled || !controller?.address)
            throw new Error("Unregistered evolution source.");
          const id = `${context.chain.id}:${event.log.address.toLowerCase()}:${event.transaction.hash}:${event.log.logIndex}`;
          const previous = await context.db.find(schema.canonicalEvent, { id });
          if (previous) {
            if (
              previous.blockHash !== event.block.hash ||
              previous.data !== event.log.data ||
              previous.topics !== JSON.stringify(event.log.topics) ||
              previous.name !== abi.name
            )
              throw new Error("Evolution replay needs rollback.");
            return;
          }
          await recordCanonicalEvent(source.id, abi.name, event, context);
          const deployment = `8453:${controller.address}`;
          const store: EvolutionProjectionStore = {
            async get(domain, key) {
              return (
                (
                  await context.db.find(schema.evolutionProjection, {
                    id: `${deployment}:${domain}:${key}`
                  })
                )?.value ?? null
              );
            },
            async put(domain, key, value) {
              const entity = `${deployment}:${domain}:${key}`;
              await context.db
                .insert(schema.evolutionProjection)
                .values({ id: entity, value })
                .onConflictDoUpdate({ value });
              await context.db
                .insert(schema.evolutionProjectionVersion)
                .values({
                  id: `${id}:${entity}`,
                  entity,
                  domain,
                  deployment,
                  value,
                  blockNumber: event.block.number,
                  transactionIndex: event.transaction.transactionIndex,
                  logIndex: event.log.logIndex
                });
            }
          };
          const args = JSON.parse(
            JSON.stringify(event.args, (_key, value: unknown) =>
              typeof value === "bigint" ? value.toString() : value
            )
          ) as Record<string, unknown>;
          await applyEvolutionEvent(store, abi.name, args);
        }
      );
    }
  }
}
