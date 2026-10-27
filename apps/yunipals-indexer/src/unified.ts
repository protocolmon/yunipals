import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { recordCanonicalEvent } from "../lib/unified/handlers.js";
import {
  boosterPacksAbi,
  packRegistryAbi,
  yunipalMonstersAbi
} from "../../../packages/yunipals-market-core/src/boosterAbi.js";

if (
  process.env.PONDER_ISLANDS_ONLY !== "true" &&
  process.env.PONDER_BOOSTERS_ONLY !== "true"
) {
  for (const name of [
    "EthereumCheckpoint",
    "BaseCheckpoint",
    "PolygonCheckpoint",
    "BnbCheckpoint"
  ] as const) {
    ponder.on(`${name}:block`, async ({ event, context }) => {
      const values = {
        id: String(context.chain.id),
        chainId: context.chain.id,
        blockNumber: event.block.number,
        blockHash: event.block.hash,
        parentHash: event.block.parentHash,
        timestamp: event.block.timestamp
      };
      await context.db
        .insert(schema.chainCheckpoint)
        .values(values)
        .onConflictDoUpdate(values);
      await context.db
        .insert(schema.chainBlock)
        .values({ ...values, id: `${context.chain.id}:${event.block.number}` });
      if (event.block.number >= 4096n) {
        await context.db.delete(schema.chainBlock, {
          id: `${context.chain.id}:${event.block.number - 4096n}`
        });
      }
    });
  }
  // Domain handlers in boosters.ts also write the shared journal. Capture the
  // remaining administrative events here without registering a handler twice.
  const registryDomain = new Set([
    "TypeConfigured",
    "TypeActivated",
    "SalesPaused"
  ]);
  const engineDomain = new Set([
    "RequestsPaused",
    "RequestCreated",
    "PaymentBurned",
    "RandomnessReceived",
    "RecoveryRequired",
    "OriginalRevealed",
    "RequestCompleted",
    "RequestForfeited",
    "RefundReturned",
    "RefundCredited",
    "RefundWithdrawn"
  ]);
  const monsterDomain = new Set([
    "MonsterMinted",
    "Transfer",
    "OriginalBurned"
  ]);
  for (const item of packRegistryAbi) {
    if (item.type !== "event" || registryDomain.has(item.name)) continue;
    ponder.on(`BoosterRegistry:${item.name}`, async ({ event, context }) => {
      await recordCanonicalEvent(
        "boosters:boosterregistry",
        item.name,
        event,
        context
      );
    });
  }
  for (const item of boosterPacksAbi) {
    if (item.type !== "event" || engineDomain.has(item.name)) continue;
    ponder.on(`BoosterEngine:${item.name}`, async ({ event, context }) => {
      await recordCanonicalEvent(
        "boosters:boosterengine",
        item.name,
        event,
        context
      );
    });
  }
  for (const item of yunipalMonstersAbi) {
    if (item.type !== "event" || monsterDomain.has(item.name)) continue;
    ponder.on(`BoosterMonsters:${item.name}`, async ({ event, context }) => {
      await recordCanonicalEvent(
        "boosters:boostermonsters",
        item.name,
        event,
        context
      );
    });
  }
  for (const name of ["Mint", "Update"] as const) {
    ponder.on(`YunipalsBaseMetadata:${name}`, async ({ event, context }) => {
      await recordCanonicalEvent("metadata:base", name, event, context);
    });
  }
  for (const name of [
    "OrderValidated",
    "CounterIncremented",
    "OrderFulfilled",
    "OrderCancelled"
  ] as const) {
    ponder.on(`BnbSeaport:${name}`, async ({ event, context }) => {
      await recordCanonicalEvent(
        "marketplace:bnb:seaport",
        name,
        event,
        context
      );
    });
  }
}
