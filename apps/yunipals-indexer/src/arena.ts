import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { arenaAbi } from "../../../packages/yunipals-market-core/src/arenaAbi.js";
import { applyArenaEvent } from "../lib/arena/state.js";
import {
  recordCanonicalEvent,
  sourceManifest
} from "../lib/unified/handlers.js";

if (
  process.env.PONDER_ISLANDS_ONLY !== "true" &&
  process.env.PONDER_BOOSTERS_ONLY !== "true"
) {
  for (const item of arenaAbi) {
    if (item.type !== "event") continue;
    for (const contract of ["YunipalsArena", "YunipalsAnimeArena"] as const) {
      ponder.on(`${contract}:${item.name}`, async ({ event, context }) => {
        const address = event.log.address.toLowerCase();
        const source = sourceManifest.sources.find(
          (source) => source.feature === "arena" && source.address === address
        );
        if (!source) throw new Error("Unregistered Arena deployment.");
        const eventId = await recordCanonicalEvent(
          source.id,
          item.name,
          event,
          context
        );
        const deployment = `${context.chain.id}:${address}`;
        const args: Record<string, unknown> = Object.fromEntries(
          Object.entries(event.args)
        );
        const tournamentId = args.id === undefined ? null : String(args.id);
        const id = `${deployment}:${tournamentId}`;
        const existing =
          tournamentId === null
            ? null
            : await context.db.find(schema.arenaTournament, { id });
        const transition = applyArenaEvent(
          existing?.state ?? null,
          item.name,
          args,
          contract === "YunipalsAnimeArena" ? "anime" : "video"
        );
        if (transition.state) {
          const values = {
            id,
            deployment,
            tournamentId: transition.state.id,
            state: transition.state,
            openedEventId: existing?.openedEventId ?? eventId,
            openedBlockHash: existing?.openedBlockHash ?? event.block.hash,
            lastEventId: eventId,
            blockNumber: event.block.number,
            blockHash: event.block.hash
          };
          await context.db
            .insert(schema.arenaTournament)
            .values(values)
            .onConflictDoUpdate(values);
          if (item.name === "Entered") {
            const seat = transition.state.seats.at(-1)!;
            await context.db
              .insert(schema.arenaSeat)
              .values({ id: `${id}:${seat.seat}`, tournamentKey: id, ...seat });
          }
        }
        for (const change of transition.credits) {
          const creditId = `${deployment}:${change.wallet}`;
          const credit = await context.db.find(schema.arenaCredit, {
            id: creditId
          });
          const amount = (credit?.amount ?? 0n) + change.amount;
          if (amount < 0n)
            throw new Error("Arena claim exceeds indexed credit.");
          await context.db
            .insert(schema.arenaCredit)
            .values({
              id: creditId,
              deployment,
              wallet: change.wallet,
              amount,
              lastEventId: eventId,
              blockNumber: event.block.number,
              blockHash: event.block.hash
            })
            .onConflictDoUpdate({
              amount,
              lastEventId: eventId,
              blockNumber: event.block.number,
              blockHash: event.block.hash
            });
        }
      });
    }
  }
}
