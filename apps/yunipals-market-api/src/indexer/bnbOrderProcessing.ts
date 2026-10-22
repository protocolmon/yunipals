import type { Pool, PoolClient } from "pg";
import type { Hex } from "viem";
import type { BnbOrderProcessing } from "@protopals/yunipals-market-core/bnbProcessing";
import { parseMarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  decodeValidatedPublication,
  validatedComponentsAtCounter
} from "@protopals/yunipals-market-core/bnbDiscovery";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@protopals/yunipals-market-core/seaportWire";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  indexerTransaction,
  sqlIdentifier
} from "@protopals/yunipals-indexer-server/database";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import type { bnbOrderSummary, OrderStatus } from "@/bnb/orders";
import { marketplaceOwnershipDefinition } from "./ownership";
import { assertSourceReadProvenance, type Marker } from "./ownershipSql";
import {
  readBnbDiscoveryBinding,
  type BnbDiscoveryQualification
} from "./bnbDiscoveryRead";

const protocol = seaportDeployment.address.toLowerCase();
const hashPattern = /^0x[0-9a-f]{64}$/;
const decimal = /^(0|[1-9][0-9]{0,77})$/;
const statuses = [
  "active",
  "unavailable",
  "filled",
  "cancelled",
  "expired",
  "counter-changed",
  "inconsistent"
];
type Db = Pick<PoolClient, "query">;
export type DiscoveredBnbOrderPoint = {
  summary: ReturnType<typeof bnbOrderSummary>;
  state: OrderStatus;
  state_observed_at: Date | null;
  order_hash: string;
  maker: string;
  contract_address: string;
  token_id: string;
  bound_lifecycle: number;
  published_counter: string | null;
  published_components: unknown;
  publication_block: string;
  publication_hash: string;
  publication_tx: string;
  publication_transaction_index: number | null;
  publication_log_index: number;
  publication_time: string;
  state_block: string | null;
  state_hash: string | null;
};
class InvalidProcessing extends Error {
  constructor(readonly reason: BnbOrderProcessing["reason"]) {
    super(reason);
  }
}
function fail(reason: BnbOrderProcessing["reason"]): never {
  throw new InvalidProcessing(reason);
}
function unqualified(
  reason: BnbOrderProcessing["reason"],
  state: "pending" | "unavailable" = "unavailable"
): BnbOrderProcessing {
  return {
    version: 1,
    state,
    reason,
    source: null,
    consumer: null,
    completed: null,
    sourceAvailableThroughBlock: null,
    publication: null,
    order: null,
    observation: null,
    observationReason: "not_observed"
  };
}
function uint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    decimal.test(value) &&
    BigInt(value) < 2n ** 256n
  );
}
function index(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
  );
}

// Both registration and the order must still belong to this exact point read.
// jsonb produces timestamp strings (hashing Date objects would lose the epoch).
async function fence(db: Db, orderHash: string) {
  const rows = (
    await db.query<{ value: unknown }>(
      `SELECT jsonb_build_object(
    'discovery',to_jsonb(d),'registration',to_jsonb(c),'order',to_jsonb(o)) AS value
    FROM yunipals_market.bnb_discovery_cursor d
    LEFT JOIN yunipals_market.shared_indexer_consumer c ON c.consumer='bnb-discovery'
    LEFT JOIN yunipals_market.bnb_discovered_order o ON o.protocol_address=$1 AND o.order_hash=$2
    WHERE d.singleton`,
      [protocol, orderHash]
    )
  ).rows;
  if (rows.length !== 1 || !rows[0]!.value) fail("state_changed");
  return manifestDigest(rows[0]!.value);
}

async function currentBinding(
  db: Db,
  q: BnbDiscoveryQualification,
  marker: Marker,
  row: DiscoveredBnbOrderPoint,
  available: bigint,
  checkProvenance: typeof assertSourceReadProvenance
): Promise<boolean | null> {
  // Optional ownership readiness must not abort otherwise valid cancellation
  // evidence. The savepoint remains inside the same read-only source snapshot.
  await db.query("SAVEPOINT bnb_processing_ownership");
  try {
    const value = await (async () => {
      const definition = marketplaceOwnershipDefinition(
        q.reader.release,
        "bnb"
      );
      if (!Array.isArray(marker.definitions)) return null;
      const definitions = marker.definitions.filter(
        (item) => item.collection === "bnb"
      );
      if (
        definitions.length !== 1 ||
        manifestDigest(definitions[0]) !== manifestDigest(definition)
      )
        return null;
      await checkProvenance(db, q.reader.release, q.readSchema, marker);
      const schema = sqlIdentifier(q.readSchema);
      const statuses = (
        await db.query<{
          collection: string;
          source_id: string;
          release_id: string;
          manifest_hash: string;
          policy: string;
          ready: boolean;
          block_number: string;
        }>(`SELECT collection,source_id,release_id,manifest_hash,policy,ready,block_number::text
        FROM ${schema}.source_status WHERE collection='bnb' LIMIT 2`)
      ).rows;
      const status = statuses[0];
      const policy =
        definition.policy.kind === "depth"
          ? `depth:${definition.policy.subsequentBlocks}`
          : definition.policy.kind;
      if (
        statuses.length !== 1 ||
        !status ||
        !status.ready ||
        status.source_id !== definition.sourceId ||
        status.release_id !== q.reader.release.id ||
        status.manifest_hash !== q.reader.release.manifestHash ||
        status.policy !== policy ||
        !uint(status.block_number) ||
        BigInt(status.block_number) < BigInt(q.completed.number)
      )
        return null;
      const physical = sqlIdentifier(q.reader.release.schema);
      const source = q.reader.release.manifest.sources.find(
        (item) => item.id === definition.sourceId
      )!;
      const tokens = (
        await db.query<{
          owner: string;
          lifecycle: number;
          burned: boolean;
          last_transfer_block: string;
          last_transaction_hash: string;
          mint_block: string;
          mint_timestamp: string;
          lifecycle_mint_block: string | null;
          lifecycle_mint_timestamp: string | null;
          transfer_to: string | null;
          transfer_lifecycle: number | null;
          transfer_abi_hash: string | null;
          transfer_block_hash: string | null;
          mint_block_hash: string | null;
        }>(
          `SELECT t.owner,t.lifecycle,t.burned,t.last_transfer_block::text,t.last_transaction_hash,
          t.mint_block::text,t.mint_timestamp::text,l.mint_block::text AS lifecycle_mint_block,
          l.mint_timestamp::text AS lifecycle_mint_timestamp,e."to" AS transfer_to,
          e.lifecycle AS transfer_lifecycle,j.abi_hash AS transfer_abi_hash,
          j.block_hash AS transfer_block_hash,mint_proof.block_hash AS mint_block_hash
        FROM ${schema}.token t
        LEFT JOIN ${schema}.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
        LEFT JOIN LATERAL (SELECT e."to",e.lifecycle,e.block_number,e.transaction_hash,e.log_index
          FROM ${schema}.transfer_event e WHERE e.collection=t.collection AND e.chain_id=t.chain_id
            AND e.contract_address=t.contract_address AND e.token_id=t.token_id
            AND e.block_number=t.last_transfer_block AND e.transaction_hash=t.last_transaction_hash
          ORDER BY e.transaction_index DESC,e.log_index DESC LIMIT 1) e ON true
        LEFT JOIN ${physical}.canonical_event j ON j.source_id=$3 AND j.chain_id=t.chain_id
          AND j.address=t.contract_address AND j.transaction_hash=e.transaction_hash
          AND j.log_index=e.log_index AND j.block_number=e.block_number AND j.name='Transfer'
        LEFT JOIN LATERAL (SELECT j.block_hash FROM ${schema}.transfer_event m
          JOIN ${physical}.canonical_event j ON j.source_id=$3 AND j.chain_id=t.chain_id
            AND j.address=t.contract_address AND j.transaction_hash=m.transaction_hash
            AND j.log_index=m.log_index AND j.block_number=m.block_number
            AND j.name='Transfer' AND j.abi_hash=$4
          WHERE m.collection=t.collection AND m.chain_id=t.chain_id AND m.contract_address=t.contract_address
            AND m.token_id=t.token_id AND m.lifecycle=t.lifecycle AND m."from"='0x0000000000000000000000000000000000000000'
            AND m."to"=l.minted_to AND m.transaction_hash=l.mint_transaction_hash AND m.block_number=t.mint_block
          ORDER BY m.log_index LIMIT 1) mint_proof ON true
        WHERE t.collection='bnb' AND t.chain_id=56 AND t.contract_address=$1 AND t.token_id=$2 LIMIT 2`,
          [
            row.contract_address,
            row.token_id,
            definition.sourceId,
            source.abiHash
          ]
        )
      ).rows;
      const token = tokens[0];
      if (
        tokens.length !== 1 ||
        !token ||
        !/^0x[0-9a-f]{40}$/.test(token.owner) ||
        !index(token.lifecycle) ||
        token.lifecycle < 1 ||
        typeof token.burned !== "boolean" ||
        !uint(token.last_transfer_block) ||
        BigInt(token.last_transfer_block) > BigInt(status.block_number) ||
        BigInt(token.last_transfer_block) > available ||
        !hashPattern.test(token.last_transaction_hash) ||
        !uint(token.mint_block) ||
        !uint(token.mint_timestamp) ||
        token.lifecycle_mint_block !== token.mint_block ||
        token.lifecycle_mint_timestamp !== token.mint_timestamp ||
        token.transfer_to !== token.owner ||
        token.transfer_lifecycle !== token.lifecycle ||
        token.transfer_abi_hash !== source.abiHash ||
        !hashPattern.test(token.transfer_block_hash ?? "") ||
        !hashPattern.test(token.mint_block_hash ?? "") ||
        token.burned !== /^0x0{40}$/.test(token.owner)
      )
        return null;
      return (
        token.lifecycle === row.bound_lifecycle &&
        !token.burned &&
        !/^0x0{40}$/.test(token.owner) &&
        (row.summary.side === "listing"
          ? token.owner.toLowerCase() === row.maker
          : token.owner.toLowerCase() !== row.maker)
      );
    })();
    await db.query("RELEASE SAVEPOINT bnb_processing_ownership");
    return value;
  } catch {
    await db.query("ROLLBACK TO SAVEPOINT bnb_processing_ownership");
    await db.query("RELEASE SAVEPOINT bnb_processing_ownership");
    return null;
  }
}

async function sourceProof(
  q: BnbDiscoveryQualification,
  row: DiscoveredBnbOrderPoint,
  now: number,
  checkProvenance: typeof assertSourceReadProvenance
): Promise<BnbOrderProcessing> {
  return q.reader.snapshot(
    "marketplace:bnb:seaport",
    { kind: "finalized" },
    async (db, { release, status }) => {
      if (
        !status.anchor ||
        !["ready", "catching_up"].includes(status.readiness.reason) ||
        status.errorCode !== null ||
        status.readiness.availableThroughBlock === null ||
        BigInt(q.completed.number) > status.readiness.availableThroughBlock
      )
        fail("source_unavailable");
      const schema = sqlIdentifier(release.schema),
        readSchema = sqlIdentifier(q.readSchema);
      const markers = (
        await db.query<{
          identity: string;
          release_id: string;
          manifest_hash: string;
          definitions: Marker["definitions"];
        }>(
          `SELECT identity,release_id,manifest_hash,definitions FROM ${readSchema}._unified_read_release WHERE singleton LIMIT 2`
        )
      ).rows;
      const marker = markers[0];
      if (
        markers.length !== 1 ||
        !marker ||
        !hashPattern.test(marker.identity) ||
        marker.release_id !== release.id ||
        marker.manifest_hash !== release.manifestHash
      )
        fail("source_unavailable");
      if (
        !uint(row.publication_block) ||
        !hashPattern.test(row.publication_hash) ||
        !hashPattern.test(row.publication_tx) ||
        !index(row.publication_transaction_index) ||
        !index(row.publication_log_index) ||
        !uint(row.publication_time) ||
        !uint(row.published_counter) ||
        BigInt(row.publication_block) > BigInt(q.completed.number)
      )
        fail("publication_invalid");
      const id = `56:${protocol}:${row.publication_tx}:${row.publication_log_index}`;
      const events = (
        await db.query<{
          id: string;
          source_id: string;
          chain_id: number;
          address: string;
          abi_hash: string;
          name: string;
          block_number: string;
          block_hash: string;
          transaction_hash: string;
          transaction_index: number;
          log_index: number;
          timestamp: string;
          topics: string | null;
          data: string | null;
        }>(
          `SELECT id,source_id,chain_id,address,abi_hash,name,block_number::text,block_hash,
        transaction_hash,transaction_index,log_index,timestamp::text,
        CASE WHEN octet_length(topics)+octet_length(data)<=262144 THEN topics END AS topics,
        CASE WHEN octet_length(topics)+octet_length(data)<=262144 THEN data END AS data
      FROM ${schema}.canonical_event WHERE id=$1 AND source_id='marketplace:bnb:seaport' LIMIT 2`,
          [id]
        )
      ).rows;
      const event = events[0];
      if (!event) fail("publication_history_unavailable");
      if (
        events.length !== 1 ||
        event.id !== id ||
        event.source_id !== status.source.id ||
        event.chain_id !== 56 ||
        event.address !== protocol ||
        event.abi_hash !== status.source.abiHash ||
        event.name !== "OrderValidated" ||
        event.block_number !== row.publication_block ||
        event.block_hash !== row.publication_hash ||
        event.transaction_hash !== row.publication_tx ||
        event.transaction_index !== row.publication_transaction_index ||
        event.log_index !== row.publication_log_index ||
        event.timestamp !== row.publication_time ||
        !event.topics ||
        !event.data
      )
        fail("publication_invalid");
      try {
        const topics: unknown = JSON.parse(event.topics);
        if (
          !Array.isArray(topics) ||
          topics.length < 1 ||
          topics.length > 4 ||
          topics.some(
            (topic) => typeof topic !== "string" || !hashPattern.test(topic)
          ) ||
          !/^0x(?:[0-9a-f]{2})*$/.test(event.data)
        )
          throw new Error();
        const publication = decodeValidatedPublication({
          topics: topics as Hex[],
          data: event.data as Hex
        });
        const components = validatedComponentsAtCounter(
          publication,
          BigInt(row.published_counter)
        );
        if (
          publication.orderHash.toLowerCase() !== row.order_hash ||
          !components ||
          components.offerer.toLowerCase() !== row.maker ||
          manifestDigest(encodeSeaportOrder(components)) !==
            manifestDigest(
              encodeSeaportOrder(decodeSeaportOrder(row.published_components))
            )
        )
          throw new Error();
        const summary = parseMarketOrder(row.summary);
        if (
          summary.orderHash.toLowerCase() !== row.order_hash ||
          summary.maker.toLowerCase() !== row.maker ||
          summary.protocolAddress.toLowerCase() !== protocol ||
          summary.asset.chain !== "bnb" ||
          summary.asset.chainId !== 56 ||
          summary.asset.contractAddress.toLowerCase() !==
            row.contract_address ||
          row.contract_address !==
            marketplaceChains.bnb.contractAddress.toLowerCase() ||
          summary.asset.tokenId !== row.token_id ||
          summary.lifecycle !== row.bound_lifecycle ||
          !index(row.bound_lifecycle) ||
          summary.source !== "yunipals" ||
          !statuses.includes(row.state)
        )
          throw new Error();
      } catch {
        fail("order_binding_invalid");
      }
      const proof: BnbOrderProcessing = {
        version: 1,
        state: "qualified",
        reason: "publication_processed",
        source: {
          releaseId: release.id,
          readIdentity: marker.identity,
          manifestHash: release.manifestHash,
          buildId: release.buildId
        },
        consumer: {
          id: "bnb-discovery",
          sourceId: "marketplace:bnb:seaport",
          policy: "finalized",
          configurationHash: q.configurationHash,
          policyFingerprint: q.policyFingerprint,
          epoch: q.epoch,
          generation: q.generation,
          mode: "live",
          readerMode: "unified"
        },
        completed: q.completed,
        sourceAvailableThroughBlock:
          status.readiness.availableThroughBlock.toString(),
        publication: {
          blockNumber: row.publication_block,
          blockHash: row.publication_hash,
          transactionHash: row.publication_tx,
          transactionIndex: row.publication_transaction_index,
          logIndex: row.publication_log_index
        },
        order: {
          orderHash: row.order_hash,
          maker: row.maker,
          lifecycle: row.bound_lifecycle,
          status: row.state,
          bindingCurrent: await currentBinding(
            db,
            q,
            marker,
            row,
            status.readiness.availableThroughBlock,
            checkProvenance
          )
        },
        observation: null,
        observationReason: "not_observed"
      };
      if (
        !row.state_observed_at ||
        !uint(row.state_block) ||
        !row.state_hash ||
        !hashPattern.test(row.state_hash)
      )
        return proof;
      const observedAt = row.state_observed_at.getTime();
      if (
        !Number.isFinite(observedAt) ||
        observedAt > now + 30_000 ||
        now - observedAt > 720_000
      ) {
        proof.observationReason = "stale";
        return proof;
      }
      if (
        BigInt(row.state_block) > status.readiness.availableThroughBlock ||
        BigInt(row.state_block) < BigInt(row.publication_block)
      ) {
        proof.observationReason = "outside_coverage";
        return proof;
      }
      const witnesses = (
        await db.query<{ block_hash: string }>(
          `SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=56 AND block_number=$1::bigint LIMIT 2`,
          [row.state_block]
        )
      ).rows;
      let canonicalHash: string | null =
        witnesses.length === 1 ? witnesses[0]!.block_hash : null;
      if (witnesses.length > 1) fail("source_unavailable");
      if (!canonicalHash && row.state_block === status.anchor.number)
        canonicalHash = status.anchor.hash;
      if (!canonicalHash && row.state_block === event.block_number)
        canonicalHash = event.block_hash;
      if (!canonicalHash) {
        const retained = (
          await db.query<{
            block_hash: string;
            witness_hash: string;
            canonical_witness: string | null;
          }>(
            `SELECT a.block_hash,a.witness_hash,b.block_hash AS canonical_witness
        FROM yunipals_indexer_control.chain_anchor a LEFT JOIN ${schema}.chain_block b
        ON b.chain_id=a.chain_id AND b.block_number=a.witness_number
        WHERE a.release_id=$1 AND a.chain_id=56 AND a.block_number=$2::bigint LIMIT 2`,
            [release.id, row.state_block]
          )
        ).rows;
        if (retained.length > 1) fail("source_unavailable");
        const anchor = retained[0];
        if (anchor && anchor.witness_hash === anchor.canonical_witness)
          canonicalHash = anchor.block_hash;
      }
      if (!canonicalHash || canonicalHash !== row.state_hash) {
        proof.observationReason = canonicalHash
          ? "canonical_mismatch"
          : "history_unavailable";
        return proof;
      }
      proof.observation = {
        blockNumber: row.state_block,
        blockHash: row.state_hash,
        observedAt: row.state_observed_at.toISOString()
      };
      proof.observationReason = null;
      return proof;
    }
  );
}

/** Adds optional processing provenance to the existing point lookup. Legacy
 * behavior remains unchanged. A caller still needs separate exact action proof. */
export async function readDiscoveredBnbOrderPoint(
  pool: Pool,
  orderHash: Hex,
  options: {
    now?: () => number;
    readBinding?: typeof readBnbDiscoveryBinding;
    checkOwnershipProvenance?: typeof assertSourceReadProvenance;
  } = {}
): Promise<{
  row: DiscoveredBnbOrderPoint | null;
  processing?: BnbOrderProcessing;
}> {
  const now = options.now ?? Date.now;
  const value = await indexerTransaction(
    pool,
    async (db) => {
      await db.query("SET LOCAL statement_timeout = '2000ms'");
      const selected = (
        await db.query<{ mode: string; reader_mode: string }>(
          "SELECT mode,reader_mode FROM yunipals_market.bnb_discovery_cursor WHERE singleton"
        )
      ).rows[0];
      const row = (
        await db.query<DiscoveredBnbOrderPoint>(
          `SELECT summary,state,state_observed_at,
      order_hash,maker,contract_address,token_id::text,bound_lifecycle,published_counter::text,published_components,
      publication_block::text,publication_hash,publication_tx,publication_transaction_index,publication_log_index,publication_time::text,
      state_block::text,state_hash FROM yunipals_market.bnb_discovered_order
      WHERE protocol_address=$1 AND order_hash=$2 AND bound_lifecycle IS NOT NULL LIMIT 2`,
          [protocol, orderHash]
        )
      ).rows;
      if (row.length > 1) throw new Error("Ambiguous order point.");
      const result = { row: row[0] ?? null };
      if (
        !result.row ||
        selected?.mode !== "live" ||
        selected.reader_mode !== "unified"
      )
        return result;
      try {
        const initialFence = await fence(db, orderHash);
        const bound = await (options.readBinding ?? readBnbDiscoveryBinding)(
          db
        );
        if (!bound.native || !bound.qualification)
          return {
            ...result,
            processing: unqualified("consumer_not_completed", "pending")
          };
        const qualification = bound.qualification;
        const processing = await sourceProof(
          qualification,
          result.row,
          now(),
          options.checkOwnershipProvenance ?? assertSourceReadProvenance
        );
        return { ...result, processing, qualification, initialFence };
      } catch (error) {
        return {
          ...result,
          processing: unqualified(
            error instanceof InvalidProcessing
              ? error.reason
              : "source_unavailable"
          )
        };
      }
    },
    true
  );
  if (
    "qualification" in value &&
    value.qualification &&
    value.processing?.state === "qualified"
  ) {
    try {
      const q = value.qualification;
      await q.reader.page(
        "marketplace:bnb:seaport",
        { kind: "finalized" },
        { cursor: q.cursor, limit: 1, includeReceipts: false }
      );
      // A reconciliation observation can be newer than the completed discovery
      // cursor. Recheck its own canonical witness, not just the cursor anchor.
      value.processing = await sourceProof(
        q,
        value.row!,
        now(),
        options.checkOwnershipProvenance ?? assertSourceReadProvenance
      );
      if ((await fence(pool, orderHash)) !== value.initialFence)
        fail("state_changed");
    } catch (error) {
      return {
        row: value.row,
        processing: unqualified(
          error instanceof InvalidProcessing
            ? error.reason
            : "source_unavailable"
        )
      };
    }
  }
  return {
    row: value.row,
    ...("processing" in value ? { processing: value.processing } : {})
  };
}
