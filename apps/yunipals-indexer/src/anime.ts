import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { animeRegistryAbi } from "../../../packages/yunipals-market-core/src/animeRegistryAbi.js";
import { recordCanonicalEvent } from "../lib/unified/handlers.js";

if (
  process.env.PONDER_ISLANDS_ONLY !== "true" &&
  process.env.PONDER_BOOSTERS_ONLY !== "true"
) {
  for (const item of animeRegistryAbi) {
    if (item.type !== "event") continue;
    ponder.on(
      `AnimeFighterRegistry:${item.name}`,
      async ({ event, context }) => {
        const eventId = await recordCanonicalEvent(
          "anime-registry:8453",
          item.name,
          event,
          context
        );
        if (!("tokenId" in event.args)) return;
        const id = String(event.args.tokenId);
        const prior = await context.db.find(schema.animeFighter, { id });
        const args = event.args as {
          owner?: `0x${string}`;
          application?: number;
          manifestHash?: `0x${string}`;
          recipeVersion?: number;
          reasonCode?: number;
          note?: string;
        };
        if (item.name !== "Applied" && !prior)
          throw new Error("Anime transition has no application.");
        const statuses: Record<string, number> = {
          Applied: 1,
          Approved: 2,
          Rejected: 3,
          Revoked: 4
        };
        const values = {
          id,
          status: statuses[item.name]!,
          recipeVersion: args.recipeVersion ?? prior?.recipeVersion ?? 0,
          manifestHash:
            args.manifestHash ??
            prior?.manifestHash ??
            (`0x${"0".repeat(64)}` as const),
          applicant: args.owner ?? prior!.applicant,
          applications: args.application ?? prior!.applications,
          reasonCode: args.reasonCode ?? null,
          note: args.note ?? null,
          appliedBlock:
            item.name === "Applied" ? event.block.number : prior!.appliedBlock,
          lastEventId: eventId,
          blockNumber: event.block.number,
          blockHash: event.block.hash
        };
        await context.db
          .insert(schema.animeFighter)
          .values(values)
          .onConflictDoUpdate(values);
      }
    );
  }
}
