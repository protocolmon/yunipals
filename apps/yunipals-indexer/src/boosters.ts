import { ponder, type Context } from "ponder:registry";
import schema from "ponder:schema";
import { zeroAddress, type Address, type Hex } from "viem";
import { boosterDeployment } from "../lib/boosters/config.js";
import { boosterIdentity } from "../../../packages/yunipals-market-core/src/boosters.js";
import {
  recordCanonicalEvent,
  sourceManifest,
  type IndexedLog
} from "../lib/unified/handlers.js";

type LogEvent = IndexedLog;
const lower = (address: string) => address.toLowerCase() as Address;
const typeKey = (id: bigint) =>
  boosterIdentity(boosterDeployment()!.registry, id);
const originalKey = (id: bigint) =>
  boosterIdentity(boosterDeployment()!.monsters, id);
const requestKey = (engine: string, id: bigint) => boosterIdentity(engine, id);

async function record(
  name: string,
  event: LogEvent,
  context: Context
): Promise<boolean> {
  const id = `${event.block.hash}:${event.transaction.hash}:${event.log.logIndex}`;
  if (await context.db.find(schema.boosterEvent, { id })) return false;
  if (process.env.PONDER_BOOSTERS_ONLY !== "true") {
    const source = sourceManifest.sources.find(
      (source) =>
        source.feature === "boosters" &&
        source.address === event.log.address.toLowerCase()
    );
    if (!source) throw new Error("Unregistered booster source.");
    await recordCanonicalEvent(source.id, name, event, context);
  }
  await context.db.insert(schema.boosterEvent).values({
    id,
    name,
    address: lower(event.log.address),
    args: JSON.stringify(event.args, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value
    ),
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex
  });
  const checkpoint = {
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    timestamp: event.block.timestamp
  };
  await context.db
    .insert(schema.boosterCheckpoint)
    .values({ id: "8453", ...checkpoint })
    .onConflictDoUpdate(checkpoint);
  return true;
}

if (process.env.PONDER_ISLANDS_ONLY !== "true") {
  ponder.on("BoosterRegistry:TypeConfigured", async ({ event, context }) => {
    await record("TypeConfigured", event, context);
  });
  ponder.on("BoosterRegistry:TypeActivated", async ({ event, context }) => {
    if (!(await record("TypeActivated", event, context))) return;
    const a = event.args;
    await context.db.insert(schema.boosterType).values({
      id: typeKey(a.packTypeId),
      packTypeId: a.packTypeId.toString(),
      registry: lower(event.log.address),
      engine: lower(a.engine),
      paymentToken: lower(a.paymentToken),
      price: a.price.toString(),
      intervalSeconds: a.intervalSeconds,
      mintsPerInterval: BigInt(a.mintsPerInterval),
      totalVariants: BigInt(a.totalVariants),
      maxBatch: a.maxBatch,
      catalogHash: a.catalogHash,
      ruleHash: a.ruleHash,
      manifestUri: a.manifestURI,
      metadataBaseUri: a.metadataBaseURI,
      salesPaused: false,
      openings: 0n
    });
  });
  ponder.on("BoosterRegistry:SalesPaused", async ({ event, context }) => {
    if (!(await record("SalesPaused", event, context))) return;
    await context.db
      .update(schema.boosterType, { id: typeKey(event.args.packTypeId) })
      .set({ salesPaused: event.args.paused });
  });
  ponder.on("BoosterEngine:RequestsPaused", async ({ event, context }) => {
    if (!(await record("RequestsPaused", event, context))) return;
    const paused = event.args.paused;
    await context.db
      .insert(schema.boosterEngineState)
      .values({ id: lower(event.log.address), paused })
      .onConflictDoUpdate({ paused });
  });
  ponder.on("BoosterEngine:RequestCreated", async ({ event, context }) => {
    if (!(await record("RequestCreated", event, context))) return;
    const a = event.args;
    const deployment = boosterDeployment()!;
    const engine = lower(event.log.address);
    const id = requestKey(engine, a.requestId);
    const parentId = originalKey(a.originalId);
    await context.db.insert(schema.boosterRequest).values({
      id,
      engine,
      wrapper: deployment.wrapper,
      requestId: a.requestId.toString(),
      originalKey: parentId,
      payer: lower(a.payer),
      quantity: a.quantity,
      opening: a.opening,
      paid: a.paid.toString(),
      ruleHash: a.ruleHash,
      callbackGas: a.callbackGas,
      status: "pending",
      requestedAt: event.block.timestamp,
      transactionHash: event.transaction.hash
    });
    if (a.opening) {
      const pack = await context.db.find(schema.boosterType, {
        id: typeKey(a.packTypeId)
      });
      if (!pack) throw new Error("Booster opening without activated type");
      await context.db.insert(schema.boosterOriginal).values({
        id: parentId,
        collection: deployment.monsters,
        tokenId: a.originalId.toString(),
        typeKey: pack.id,
        engine,
        owner: lower(a.payer),
        dailyCommitted: 0n,
        minted: 0n,
        remaining: pack.totalVariants,
        pendingRequest: id,
        burned: false
      });
      await context.db
        .update(schema.boosterType, { id: pack.id })
        .set({ openings: pack.openings + 1n });
    } else {
      await context.db
        .update(schema.boosterOriginal, { id: parentId })
        .set((row) => ({
          dailyCommitted: row.dailyCommitted + BigInt(a.quantity),
          pendingRequest: id
        }));
    }
  });
  ponder.on("BoosterEngine:PaymentBurned", async ({ event, context }) => {
    await record("PaymentBurned", event, context);
  });
  ponder.on("BoosterEngine:RandomnessReceived", async ({ event, context }) => {
    if (!(await record("RandomnessReceived", event, context))) return;
    const id = requestKey(event.log.address, event.args.requestId);
    const request = await context.db.find(schema.boosterRequest, { id });
    if (!request) throw new Error("Randomness without booster request");
    await context.db.update(schema.boosterRequest, { id }).set({
      seed: event.args.seed.toString(),
      receivedAt: event.args.receivedAt,
      status: request.status === "forfeited" ? "forfeited" : "seeded"
    });
    if (request.opening)
      await context.db
        .update(schema.boosterOriginal, { id: request.originalKey })
        .set({ revealedAt: event.args.receivedAt });
  });
  ponder.on("BoosterEngine:RecoveryRequired", async ({ event, context }) => {
    await record("RecoveryRequired", event, context);
  });
  ponder.on("BoosterEngine:OriginalRevealed", async ({ event, context }) => {
    if (!(await record("OriginalRevealed", event, context))) return;
    await context.db
      .update(schema.boosterOriginal, {
        id: originalKey(event.args.originalId)
      })
      .set({ revealedAt: event.args.revealedAt });
  });
  ponder.on("BoosterEngine:RequestCompleted", async ({ event, context }) => {
    if (!(await record("RequestCompleted", event, context))) return;
    const a = event.args;
    await context.db
      .update(schema.boosterRequest, {
        id: requestKey(event.log.address, a.requestId)
      })
      .set({ status: "completed", recipient: lower(a.recipient) });
    await context.db
      .update(schema.boosterOriginal, { id: originalKey(a.originalId) })
      .set({
        minted: BigInt(a.minted),
        remaining: BigInt(a.remaining),
        pendingRequest: null
      });
  });
  ponder.on("BoosterEngine:RequestForfeited", async ({ event, context }) => {
    if (!(await record("RequestForfeited", event, context))) return;
    await context.db
      .update(schema.boosterRequest, {
        id: requestKey(event.log.address, event.args.requestId)
      })
      .set({ status: "forfeited" });
    await context.db
      .update(schema.boosterOriginal, {
        id: originalKey(event.args.originalId)
      })
      .set({ pendingRequest: null });
  });
  ponder.on("BoosterMonsters:MonsterMinted", async ({ event, context }) => {
    if (!(await record("MonsterMinted", event, context))) return;
    const a = event.args;
    const original = await context.db.find(schema.boosterOriginal, {
      id: originalKey(a.originalTokenId)
    });
    if (!original?.pendingRequest)
      throw new Error("Monster mint without committed booster request");
    await context.db.insert(schema.boosterMonster).values({
      id: originalKey(a.tokenId),
      collection: lower(event.log.address),
      tokenId: a.tokenId.toString(),
      originalKey: originalKey(a.originalTokenId),
      requestKey: original.pendingRequest,
      typeKey: typeKey(a.packTypeId),
      owner: lower(a.recipient),
      mintedTo: lower(a.recipient),
      variantId: BigInt(a.variantId),
      monsterType: BigInt(a.monsterType),
      color: BigInt(a.color),
      horn: BigInt(a.horn),
      glitter: BigInt(a.glitter),
      isOriginal: a.isOriginal,
      burned: false,
      mintBlock: event.block.number
    });
  });
  ponder.on("BoosterMonsters:Transfer", async ({ event, context }) => {
    if (!(await record("Transfer", event, context))) return;
    const id = originalKey(event.args.tokenId);
    const owner = lower(event.args.to);
    const burned = owner === zeroAddress;
    // On mint, provenance is inserted by the following MonsterMinted event.
    if (await context.db.find(schema.boosterMonster, { id }))
      await context.db
        .update(schema.boosterMonster, { id })
        .set({ owner, burned });
    if (await context.db.find(schema.boosterOriginal, { id }))
      await context.db
        .update(schema.boosterOriginal, { id })
        .set({ owner, burned });
  });
  ponder.on("BoosterMonsters:OriginalBurned", async ({ event, context }) => {
    await record("OriginalBurned", event, context);
  });

  for (const name of [
    "RefundReturned",
    "RefundCredited",
    "RefundWithdrawn"
  ] as const) {
    ponder.on(`BoosterEngine:${name}`, async ({ event, context }) => {
      if (!(await record(name, event, context))) return;
      const engine = lower(event.log.address);
      const requester = lower(event.args.requester);
      const id = `${engine}:${requester}`;
      const current = await context.db.find(schema.boosterRefund, { id });
      const amount = event.args.amount;
      const credit =
        (current?.credit ?? 0n) +
        (name === "RefundCredited"
          ? amount
          : name === "RefundWithdrawn"
            ? -amount
            : 0n);
      const returned =
        (current?.returned ?? 0n) + (name === "RefundReturned" ? amount : 0n);
      const withdrawn =
        (current?.withdrawn ?? 0n) + (name === "RefundWithdrawn" ? amount : 0n);
      await context.db
        .insert(schema.boosterRefund)
        .values({ id, engine, requester, credit, returned, withdrawn })
        .onConflictDoUpdate({ credit, returned, withdrawn });
    });
  }
}
