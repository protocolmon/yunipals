import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { PublicClient } from "viem";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { arenaPrivateTables } from "./identitySchema";
import type { ArenaIntake } from "./intake";
import type { NativeArenaSource } from "./nativeSource";
import {
  verifyNativeArenaAction,
  type NativeArenaActionObservation
} from "./nativeAction";
import { verifyNativeArenaFilm } from "./mediaAdoption";
import {
  selectedArenaSource,
  sourceLeaseKey,
  type ArenaSourceBinding
} from "./sourceSelection";
import {
  arenaSourceSelectionMigration,
  arenaSourceWatermarkMigration,
  arenaSourceDeleteFenceMigration,
  arenaSourcePredecessorMigration
} from "./sourceSelectionSchema";

type Target = {
  kind: ArenaSourceBinding["kind"];
  sourceId: string;
  source: Pick<NativeArenaSource, "read" | "list">;
};

/** Reversible publication of a public-source selector. Private rows are never
 * reassigned, deleted, restored, or recreated. Run with consumers stopped and
 * deployment halted; the lease additionally fences a call already in progress.
 */
export class ArenaSourceSwitch {
  constructor(
    readonly service: Pick<
      ArenaIntake,
      "pool" | "deployment" | "nativeSource" | "assertSourceSelection"
    >,
    readonly target: Target,
    readonly client: Pick<PublicClient, "getBlock" | "getChainId">,
    readonly verify: (observed: NativeArenaActionObservation) => Promise<void>,
    readonly minimum?: { block: string; hash: string }
  ) {
    if (!service.nativeSource || !/^0x[0-9a-f]{64}$/.test(target.sourceId))
      throw new Error(
        "Arena source switch requires explicit compatible sources."
      );
    if (
      minimum &&
      (!/^(0|[1-9][0-9]*)$/.test(minimum.block) ||
        !/^0x[0-9a-f]{64}$/.test(minimum.hash))
    )
      throw new Error("Invalid accepted Arena floor.");
  }
  private async review(db: PoolClient) {
    const deployment = (
      await db.query<{
        halted: boolean;
        indexer_mode: string;
        start_block: string;
      }>(
        "SELECT halted,indexer_mode,start_block::text FROM yunipals_arena.deployment WHERE id=$1 FOR UPDATE",
        [this.service.deployment]
      )
    ).rows[0];
    if (!deployment?.halted || deployment.indexer_mode !== "unified")
      throw new Error(
        "Arena source switch requires a halted compatible deployment."
      );
    await this.service.assertSourceSelection(db);
    for (const migration of [
      arenaSourceSelectionMigration,
      arenaSourceWatermarkMigration,
      arenaSourceDeleteFenceMigration,
      arenaSourcePredecessorMigration
    ]) {
      const marker = (
        await db.query<{ checksum: string }>(
          "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
          [migration.version]
        )
      ).rows[0];
      if (marker?.checksum !== migration.checksum)
        throw new Error("Arena source switch schema differs.");
    }
    const accepted = (
      await db.query<{ block: string }>(
        `SELECT GREATEST(
      COALESCE((SELECT indexed_block FROM yunipals_arena.source_operational_cursor WHERE deployment=$1),0),
      COALESCE((SELECT accepted_block FROM yunipals_arena.source_selection WHERE deployment=$1),0),
      COALESCE((SELECT max(receipt_block_number) FROM yunipals_arena.client_transaction WHERE deployment=$1),0),
      COALESCE((SELECT max(block_number) FROM yunipals_arena.transaction_receipt_history h
      JOIN yunipals_arena.transaction_intent i USING(action_id) WHERE i.deployment=$1 AND h.canonical),0),
      $2::bigint,$3::bigint)::text AS block`,
        [
          this.service.deployment,
          deployment.start_block,
          this.minimum?.block ?? "0"
        ]
      )
    ).rows[0]!.block;
    const next = await this.target.source.read("0", {
      requiredThroughBlock: BigInt(accepted)
    });
    if (
      next.releaseId !== this.target.sourceId ||
      BigInt(next.indexedThroughBlock) < BigInt(accepted)
    )
      throw new Error(
        "Target Arena source has not reached the accepted operational cursor."
      );
    const boundary = await this.client.getBlock({
      blockNumber: BigInt(accepted)
    });
    if (
      this.minimum &&
      (await this.client.getBlock({ blockNumber: BigInt(this.minimum.block) }))
        .hash !== this.minimum.hash
    )
      throw new Error("The reviewed Arena floor is no longer canonical.");
    const head = await this.client.getBlock({ blockTag: "latest" });
    if (
      (await this.client.getChainId()) !== 8453 ||
      !boundary.hash ||
      !head.hash ||
      head.number < BigInt(next.indexedThroughBlock) ||
      Math.abs(Date.now() - Number(head.timestamp) * 1000) > 120000
    )
      throw new Error("Arena switch canonical coverage is unavailable.");
    const identities = (
      await db.query<{
        id: string;
        incarnation: string;
        opened_event_id: string;
        opened_block_hash: string;
      }>(
        `SELECT tournament_id::text AS id,incarnation,opened_event_id,opened_block_hash FROM yunipals_arena.tournament_identity
      WHERE deployment=$1 ORDER BY tournament_id,incarnation LIMIT 1001`,
        [this.service.deployment]
      )
    ).rows;
    if (
      identities.length > 1000 ||
      identities.some((row) => row.incarnation === "legacy")
    )
      throw new Error(
        "Arena switch requires reviewed bound identities within its verification limit."
      );
    const latest = await this.target.source.list();
    const ids = new Set([...identities.map((row) => row.id), ...latest.ids]);
    const origins = [];
    for (const id of ids) {
      const observed = await this.target.source.read(id, {
          requiredThroughBlock: BigInt(accepted)
        }),
        t = observed.tournament;
      if (!t)
        throw new Error(
          "An accepted Arena opening is absent from the rollback source."
        );
      const known = identities.filter((row) => row.id === id);
      if (
        known.length &&
        !known.some(
          (row) =>
            row.incarnation === t.incarnation &&
            row.opened_event_id === t.opened.id &&
            row.opened_block_hash === t.opened.blockHash
        )
      )
        throw new Error(
          "Arena source switch changed an accepted opening; reconcile its origin first."
        );
      await this.verify({ ...observed, tournament: t });
      origins.push({
        id,
        incarnation: t.incarnation,
        opened: t.opened,
        inputFrozen: t.inputFrozen,
        stateHash: manifestDigest(t.state)
      });
    }
    const privateRecords: Record<string, { count: number; digest: string }> =
      {};
    for (const table of [
      ...arenaPrivateTables,
      "provider_action_evidence",
      "media_publication",
      "client_transaction"
    ] as const) {
      const rows = (
        await db.query<{ body: unknown }>(
          table === "provider_action_evidence"
            ? `SELECT to_jsonb(e) AS body FROM yunipals_arena.provider_action_evidence e JOIN yunipals_arena.provider_task t USING(request_id)
            WHERE t.deployment=$1 ORDER BY e.request_id LIMIT 10001`
            : `SELECT to_jsonb(t) AS body FROM yunipals_arena.${table} t WHERE deployment=$1 ORDER BY to_jsonb(t)::text LIMIT 10001`,
          [this.service.deployment]
        )
      ).rows;
      if (rows.length > 10000)
        throw new Error(
          "Arena private-state review limit exceeded; use a larger measured rehearsal."
        );
      privateRecords[table] = {
        count: rows.length,
        digest: manifestDigest(rows.map((row) => row.body))
      };
    }
    if (
      (await this.client.getBlock({ blockNumber: BigInt(accepted) })).hash !==
      boundary.hash
    )
      throw new Error("Arena source switch boundary changed during review.");
    return {
      version: 1,
      deployment: this.service.deployment,
      migrationChecksum: arenaSourceSelectionMigration.checksum,
      sourceMigrationChecksums: [
        arenaSourceSelectionMigration,
        arenaSourceWatermarkMigration,
        arenaSourceDeleteFenceMigration,
        arenaSourcePredecessorMigration
      ],
      previous:
        (await selectedArenaSource(db, this.service.deployment)) ?? null,
      target: { kind: this.target.kind, sourceId: this.target.sourceId },
      accepted: { block: accepted, hash: boundary.hash.toLowerCase() },
      origins,
      privateRecords
    };
  }
  async run(applyReviewHash?: string) {
    if (
      applyReviewHash !== undefined &&
      !/^0x[0-9a-f]{64}$/.test(applyReviewHash)
    )
      throw new Error("An exact review hash is required.");
    const db = await this.service.pool.connect();
    try {
      await db.query("BEGIN");
      const lock = (
        await db.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
          [sourceLeaseKey(this.service.deployment)]
        )
      ).rows[0];
      if (!lock?.locked)
        throw new Error(
          "Arena source switch is waiting for an in-flight action."
        );
      const review = await this.review(db),
        reviewHash = manifestDigest(review);
      if (!applyReviewHash) {
        await db.query("ROLLBACK");
        return { applied: false as const, reviewHash, review };
      }
      if (reviewHash !== applyReviewHash)
        throw new Error("Arena source switch review changed; review again.");
      const epoch = randomUUID();
      await db.query(
        "INSERT INTO yunipals_arena.source_switch_history(epoch,deployment,review_hash,review) VALUES($1,$2,$3,$4)",
        [epoch, this.service.deployment, reviewHash, review]
      );
      // A real UPDATE is required: INSERT ... ON CONFLICT invokes the INSERT
      // trigger first, whose reviewed predecessor must correctly be null.
      const published = await db.query(
        review.previous
          ? `UPDATE yunipals_arena.source_selection SET epoch=$2,kind=$3,source_id=$4,accepted_block=$5,
            accepted_hash=$6,review_hash=$7,switched_at=now() WHERE deployment=$1`
          : `INSERT INTO yunipals_arena.source_selection(deployment,epoch,kind,source_id,accepted_block,accepted_hash,review_hash)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          this.service.deployment,
          epoch,
          this.target.kind,
          this.target.sourceId,
          review.accepted.block,
          review.accepted.hash,
          reviewHash
        ]
      );
      if (published.rowCount !== 1)
        throw new Error("Arena source selector changed during publication.");
      await db.query("COMMIT");
      return { applied: true as const, epoch, reviewHash, review };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}

export const arenaSourceSwitchVerifier =
  (client: PublicClient) => (observed: NativeArenaActionObservation) =>
    observed.tournament.state.phase === "settled"
      ? verifyNativeArenaFilm(client, observed)
      : verifyNativeArenaAction(client, observed);
