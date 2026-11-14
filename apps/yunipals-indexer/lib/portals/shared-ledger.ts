import { PortalSourceError } from "./errors.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { getAddress } from "viem";
import {
  indexerTransaction,
  sqlIdentifier
} from "../../../../packages/yunipals-indexer-server/src/database.js";
import {
  loadIndexerRelease,
  type RegisteredRelease
} from "../../../../packages/yunipals-indexer-server/src/releases.js";
import { readIndexerSourceStatus } from "../../../../packages/yunipals-indexer-server/src/status.js";
import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";
import { type PortalEventSource } from "../../../../packages/yunipals-market-core/src/portalIndex.js";
import { sharedPortalEventAbis } from "../unified/portal-sources.js";
import { portalReadIdentity } from "../unified/portal-views.js";
import { PortalLedgerStore, type PortalLedgerCursor } from "./ledger-store.js";
import type { PortalChain } from "./chain.js";

type Frame = {
  db?: PoolClient;
  release: RegisteredRelease;
  cursor: PortalLedgerCursor;
  witness: { number: string; hash: string };
  identity: string;
  revision: string;
};

// Ponder normalizes decoded addresses to lowercase. The existing portal API
// uses viem's checksummed decoded arguments, including in saved v1 evidence.
// Restore that representation only in decoded argument/state JSON, leaving
// canonical storage and normalized ownership/source columns unchanged.
function legacyDecodedAddresses(value: unknown): unknown {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value))
    return getAddress(value.toLowerCase());
  if (Array.isArray(value)) return value.map(legacyDecodedAddresses);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        legacyDecodedAddresses(item)
      ])
    );
  return value;
}
export type SharedPortalBinding = {
  releaseId: string;
  readSchema: string;
  competition: string;
  confirmations: number;
};
export class SharedPortalLedger extends PortalLedgerStore {
  private readonly frames: AsyncLocalStorage<Frame>;
  private definition?: {
    expires: number;
    release: RegisteredRelease;
    identity: string;
  };
  constructor(
    readonly pool: Pool,
    readonly binding: SharedPortalBinding,
    readonly chain: PortalChain
  ) {
    const frames = new AsyncLocalStorage<Frame>();
    // Only the text/value query interface is exposed to existing domain readers.
    const query = async <R extends QueryResultRow>(
      text: string,
      values?: unknown[]
    ) => {
      const frame = frames.getStore();
      if (!frame)
        throw new Error("Portal shared read requires a source snapshot.");
      const result = frame.db
        ? await frame.db.query<R>(text, values)
        : await indexerTransaction(
            this.pool,
            async (db) => {
              await this.prepareQuery(db, frame);
              return db.query<R>(text, values);
            },
            true
          );
      for (const row of result.rows)
        for (const { name: column, dataTypeID } of result.fields)
          if (dataTypeID === 114 || dataTypeID === 3802)
            (row as QueryResultRow)[column] = legacyDecodedAddresses(
              row[column]
            );
      return result;
    };
    super(
      { query } as Pick<Pool, "query">,
      `${chain.deployment.chainId}:${chain.deployment.collection.toLowerCase()}:${chain.deployment.grading.toLowerCase()}`
    );
    this.frames = frames;
    if (
      !/^0x[0-9a-f]{64}$/.test(binding.releaseId) ||
      !/^0x[0-9a-f]{40}$/.test(binding.competition) ||
      !Number.isSafeInteger(binding.confirmations) ||
      binding.confirmations < 1
    )
      throw new Error("Invalid shared portal binding.");
    sqlIdentifier(binding.readSchema);
  }
  private async definitionAt(db: PoolClient) {
    if (this.definition && this.definition.expires > Date.now())
      return this.definition;
    const release = await loadIndexerRelease(db, this.binding.releaseId);
    const identity = portalReadIdentity(release, this.binding.readSchema);
    const marker = (
      await db.query<{
        identity: string;
        release_id: string;
        manifest_hash: string;
      }>(
        `SELECT * FROM ${sqlIdentifier(this.binding.readSchema)}._portal_read_release`
      )
    ).rows;
    if (
      release.schema === this.binding.readSchema ||
      marker.length !== 1 ||
      marker[0]?.identity !== identity ||
      marker[0]?.release_id !== release.id ||
      marker[0]?.manifest_hash !== release.manifestHash
    )
      throw new PortalSourceError(
        "source_identity_mismatch",
        "Portal shared read identity mismatch."
      );
    const expected = {
      ...this.chain.deployment,
      competition: this.binding.competition
    };
    // These emitters share one chain and confirmation policy. Validate every
    // definition, then read its common chain coverage once per HTTP snapshot.
    (Object.keys(sharedPortalEventAbis) as PortalEventSource[]).forEach(
      (kind) => {
        const source = release.manifest.sources.find(
          (row) => row.id === `portals:8453:${kind}`
        );
        const names = sharedPortalEventAbis[kind]
          .map((event) => event.name)
          .sort();
        if (
          !source?.enabled ||
          source.feature !== "portals" ||
          source.address !== expected[kind].toLowerCase() ||
          source.chainId !== this.chain.deployment.chainId ||
          source.abiHash !== manifestDigest(sharedPortalEventAbis[kind]) ||
          JSON.stringify(source.events) !== JSON.stringify(names) ||
          source.receiptRequirement !== "full" ||
          !source.policies.some(
            (policy) =>
              policy.kind === "depth" &&
              policy.subsequentBlocks === this.binding.confirmations
          )
        )
          throw new PortalSourceError(
            "source_definition_mismatch",
            "Portal shared source definition mismatch."
          );
      }
    );
    this.definition = { release, identity, expires: Date.now() + 30000 };
    return this.definition;
  }
  /** Startup checks configuration and grants, independently of indexing progress. */
  async validate() {
    await indexerTransaction(
      this.pool,
      async (db) => {
        await this.definitionAt(db);
      },
      true
    );
  }
  private async openFrame(): Promise<Frame> {
    return indexerTransaction(
      this.pool,
      async (db) => {
        const { release, identity } = await this.definitionAt(db);
        const status = await readIndexerSourceStatus(
          db,
          release,
          "portals:8453:collection",
          { kind: "depth", subsequentBlocks: this.binding.confirmations }
        );
        const anchor = status.anchor;
        if (
          !status.readiness.ready ||
          !anchor ||
          release.manifest.sources
            .filter((source) => source.feature === "portals" && source.enabled)
            .some(
              (source) =>
                source.startBlock === null ||
                BigInt(source.startBlock) > BigInt(anchor.number) ||
                (source.endBlock !== null &&
                  BigInt(source.endBlock) < BigInt(anchor.number))
            )
        )
          throw new PortalSourceError(
            "source_unavailable",
            `Portal shared source unavailable: ${status.readiness.reason}.`
          );
        // Compatibility generation identifies the immutable read release. Reorgs are
        // checked through source observations and exact receipt/block hashes, not UUIDs.
        const hex = identity.slice(2, 34);
        const generation = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
        const cursor = {
          block: anchor.number,
          hash: anchor.hash,
          generation,
          competition: this.binding.competition
        };
        const witness = (
          await db.query<{ number: string; hash: string }>(
            "SELECT witness_number::text AS number,witness_hash AS hash FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=$2",
            [release.id, this.chain.deployment.chainId]
          )
        ).rows[0];
        if (!witness)
          throw new PortalSourceError(
            "source_unavailable",
            "Portal source witness is unavailable."
          );
        const frame: Frame = {
          release,
          cursor,
          witness,
          identity,
          revision: String(status.observationRevision)
        };
        await this.prepareQuery(db, frame);
        const configured = (
          await db.query<{ competition: string }>(
            "SELECT value->>'competition' AS competition FROM portal_v5_state WHERE deployment=$1 AND source=$2 AND component='CompetitionConfigured' AND entity_id='current'",
            [this.deployment, this.chain.deployment.grading.toLowerCase()]
          )
        ).rows[0];
        if (
          configured &&
          configured.competition.toLowerCase() !== this.binding.competition
        )
          throw new PortalSourceError(
            "competition_unregistered",
            "The bound competition is not registered in this shared release."
          );
        return frame;
      },
      true
    );
  }
  private async prepareQuery(db: PoolClient, frame: Frame) {
    await db.query("SET LOCAL statement_timeout='5000ms'");
    const anchor = await db.query(
      `SELECT 1 FROM ${sqlIdentifier(frame.release.schema)}.chain_block
       WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
      [this.chain.deployment.chainId, frame.witness.number, frame.witness.hash]
    );
    if (anchor.rowCount !== 1)
      throw new PortalSourceError(
        "source_unavailable",
        "Portal read boundary changed."
      );
    await db.query("SELECT set_config('yunipals.portal_boundary',$1,true)", [
      frame.cursor.block
    ]);
    await db.query(
      `SET LOCAL search_path=${sqlIdentifier(this.binding.readSchema)},pg_catalog`
    );
  }
  async snapshot<T>(read: () => Promise<T>): Promise<T> {
    if (this.frames.getStore()) return read();
    const frame = await this.openFrame();
    const result = await this.frames.run(frame, read);
    // RPC/file work never holds a pool connection. Reject a response whose
    // canonical boundary or source readiness changed while it was assembled.
    await this.openFrame();
    await indexerTransaction(
      this.pool,
      (db) => this.prepareQuery(db, frame),
      true
    );
    return result;
  }
  /** Streaming parity cursors explicitly need one repeatable-read transaction. */
  async transactionSnapshot<T>(read: () => Promise<T>): Promise<T> {
    if (this.frames.getStore())
      throw new Error("Nested portal transaction snapshot.");
    const frame = await this.openFrame();
    return indexerTransaction(
      this.pool,
      async (db) => {
        await this.prepareQuery(db, frame);
        return this.frames.run({ ...frame, db }, read);
      },
      true
    );
  }
  override async cursor(): Promise<PortalLedgerCursor> {
    return this.frames.getStore()?.cursor ?? this.snapshot(() => this.cursor());
  }
  override async requiresReplay() {
    return false;
  }
  override async migrate(): Promise<void> {
    throw new Error(
      "Shared portal views are created by the release migration."
    );
  }
  override async apply(): Promise<never> {
    throw new Error("Only shared Ponder ingestion writes portal projections.");
  }
  override sourceIdentity() {
    const frame = this.frames.getStore();
    if (!frame) throw new Error("No shared source snapshot.");
    return {
      releaseId: this.binding.releaseId,
      readIdentity: frame.identity,
      observationRevision: frame.revision
    };
  }
}
