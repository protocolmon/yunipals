import type {
  ConfirmationPolicy,
  SourceDefinition
} from "../../yunipals-indexer-client/src/sources.js";
import type { IndexerReader } from "./readers.js";
import { sqlIdentifier } from "./database.js";
import { CanonicalSourceUnavailable } from "./paging.js";

const zero = "0x0000000000000000000000000000000000000000";
export type OwnershipReadDefinition = {
  collection: string;
  sourceId: string;
  policy: ConfirmationPolicy;
};
export type OwnershipReference = {
  schema: string;
  collection: string;
  source: SourceDefinition & { address: string; startBlock: string };
};

export function ownershipReference(
  schema: string,
  source: SourceDefinition,
  collection: string
): OwnershipReference {
  sqlIdentifier(schema);
  const island = /^([a-z]+)-islands(?:-v([1-9][0-9]*))?$/.exec(collection);
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(collection) ||
    !source.enabled ||
    !source.address ||
    !source.startBlock ||
    ![1, 56, 137, 8453].includes(source.chainId) ||
    !/^0x[0-9a-f]{40}$/.test(source.address) ||
    !/^(0|[1-9][0-9]*)$/.test(source.startBlock) ||
    !["ownership", "islands"].includes(source.feature) ||
    (source.feature === "ownership" &&
      source.id !== `ownership:${collection}`) ||
    (source.feature === "islands" &&
      (!island ||
        source.id !==
          `islands:${island[1]}${island[2] ? `:v${island[2]}` : ""}`)) ||
    !source.events.includes("Transfer")
  )
    throw new Error("Invalid ownership read source.");
  return {
    schema,
    source: {
      ...source,
      address: source.address,
      startBlock: source.startBlock
    },
    collection
  };
}

// Internal SQL construction accepts only a bound parameter or the installed
// read-schema boundary function, never caller-supplied SQL fragments.
function boundarySql(
  boundary: { parameter: number } | { readSchema: string; collection: string }
) {
  if ("parameter" in boundary) {
    if (!Number.isSafeInteger(boundary.parameter) || boundary.parameter < 1)
      throw new Error("Invalid ownership boundary parameter.");
    return `SELECT $${boundary.parameter}::bigint AS block_number`;
  }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(boundary.collection))
    throw new Error("Invalid ownership collection.");
  return `SELECT block_number FROM ${sqlIdentifier(boundary.readSchema)}.source_boundary('${boundary.collection}')`;
}
type Boundary = Parameters<typeof boundarySql>[0];

/** Reconstruct only tokens changed after the boundary; never drop their old owner. */
export function ownershipTokenSql(
  ref: OwnershipReference,
  boundary: Boundary
): string {
  ownershipReference(ref.schema, ref.source, ref.collection);
  const schema = sqlIdentifier(ref.schema);
  const scope = `t.collection='${ref.collection}' AND t.chain_id=${ref.source.chainId} AND t.contract_address='${ref.source.address}'`;
  return `WITH b AS MATERIALIZED (${boundarySql(boundary)})
    SELECT '${ref.collection}'::text AS collection,t.chain_id,t.contract_address,t.token_id,
      t.owner,t.burned,t.lifecycle,t.mint_block,t.mint_timestamp,
      t.last_transfer_block,t.last_transfer_timestamp,t.last_transaction_hash
    FROM ${schema}.token t CROSS JOIN b WHERE ${scope} AND t.last_transfer_block<=b.block_number
    UNION ALL
    SELECT '${ref.collection}'::text,t.chain_id,t.contract_address,t.token_id,
      e."to" AS owner,e."to"='${zero}' AS burned,e.lifecycle,l.mint_block,l.mint_timestamp,
      e.block_number,e.block_timestamp,e.transaction_hash
    FROM ${schema}.token t CROSS JOIN b
    JOIN LATERAL (
      SELECT e.* FROM ${schema}.transfer_event e
      WHERE e.collection=t.collection AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address
        AND e.token_id=t.token_id AND e.block_number<=b.block_number
      ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1
    ) e ON true
    JOIN ${schema}.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id
      AND l.lifecycle=e.lifecycle AND l.mint_block<=b.block_number
    WHERE ${scope} AND t.last_transfer_block>b.block_number`;
}

export function ownershipLifecycleSql(
  ref: OwnershipReference,
  boundary: Boundary
): string {
  ownershipReference(ref.schema, ref.source, ref.collection);
  return `WITH b AS MATERIALIZED (${boundarySql(boundary)})
    SELECT '${ref.collection}'::text AS collection,l.token_id,l.lifecycle,l.minted_to,l.mint_block,l.mint_timestamp,
      l.mint_transaction_hash,
      CASE WHEN l.burned_at_block<=b.block_number THEN l.burned_at_block END AS burned_at_block,
      CASE WHEN l.burned_at_block<=b.block_number THEN l.burned_at_timestamp END AS burned_at_timestamp,
      CASE WHEN l.burned_at_block<=b.block_number THEN l.burn_transaction_hash END AS burn_transaction_hash
    FROM ${sqlIdentifier(ref.schema)}.token_lifecycle l CROSS JOIN b
    WHERE l.collection='${ref.collection}' AND l.mint_block<=b.block_number`;
}

export function ownershipHistorySql(
  ref: OwnershipReference,
  relation: "transfer_event" | "admin_role_event" | "contract_owner_event",
  boundary: Boundary
): string {
  ownershipReference(ref.schema, ref.source, ref.collection);
  if (
    !["transfer_event", "admin_role_event", "contract_owner_event"].includes(
      relation
    )
  )
    throw new Error("Invalid ownership history relation.");
  return `WITH b AS MATERIALIZED (${boundarySql(boundary)})
    SELECT e.* FROM ${sqlIdentifier(ref.schema)}.${relation} e CROSS JOIN b
    WHERE e.collection='${ref.collection}' AND e.chain_id=${ref.source.chainId}
      AND e.contract_address='${ref.source.address}' AND e.block_number<=b.block_number`;
}

type TokenRow = {
  owner: string;
  burned: boolean;
  lifecycle: number;
  mint_block: string;
  mint_timestamp: string;
  last_transfer_block: string;
  last_transfer_timestamp: string;
  last_transaction_hash: string;
  minted_to: string;
  mint_transaction_hash: string;
  lifecycle_mint_block: string;
  lifecycle_mint_timestamp: string;
  mint_block_hash: string;
  event_abi_hash: string;
  event_id: string;
  event_block_hash: string;
  event_transaction_index: number;
  event_log_index: number;
  event_from: string;
  event_to: string;
  event_lifecycle: number;
  event_transaction_hash: string;
  event_block_number: string;
};

export async function readOwnershipToken(
  reader: IndexerReader,
  definition: OwnershipReadDefinition,
  tokenId: string,
  options: { requireReady?: boolean } = {}
) {
  if (!/^(0|[1-9][0-9]*)$/.test(tokenId) || BigInt(tokenId) >= 2n ** 256n)
    throw new Error("Invalid ownership token ID.");
  return reader.snapshot(
    definition.sourceId,
    definition.policy,
    async (db, context) => {
      const { release, status } = context;
      if (
        !status.anchor ||
        status.readiness.availableThroughBlock === null ||
        !["ready", "catching_up"].includes(status.readiness.reason) ||
        (options.requireReady && !status.readiness.ready)
      )
        throw new CanonicalSourceUnavailable(
          status.errorCode ?? status.readiness.reason
        );
      const ref = ownershipReference(
        release.schema,
        status.source,
        definition.collection
      );
      const schema = sqlIdentifier(release.schema);
      const token =
        (
          await db.query<TokenRow>(
            `SELECT t.owner,t.burned,t.lifecycle,t.mint_block::text,t.mint_timestamp::text,
        t.last_transfer_block::text,t.last_transfer_timestamp::text,t.last_transaction_hash,
        l.minted_to,l.mint_transaction_hash,l.mint_block::text AS lifecycle_mint_block,
        l.mint_timestamp::text AS lifecycle_mint_timestamp,mint_proof.block_hash AS mint_block_hash,j.abi_hash AS event_abi_hash,
        e.id AS event_id,j.block_hash AS event_block_hash,e.transaction_index AS event_transaction_index,
        e.log_index AS event_log_index,e."from" AS event_from,e."to" AS event_to,e.lifecycle AS event_lifecycle,
        e.transaction_hash AS event_transaction_hash,e.block_number::text AS event_block_number
      FROM (${ownershipTokenSql(ref, { parameter: 1 })}) t
      LEFT JOIN ${schema}.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      LEFT JOIN LATERAL (SELECT * FROM ${schema}.transfer_event e
        WHERE e.collection=t.collection AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address
          AND e.token_id=t.token_id AND e.block_number<=$1::bigint
        ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1) e ON true
      LEFT JOIN ${schema}.canonical_event j ON j.source_id=$3 AND j.chain_id=t.chain_id
        AND j.address=t.contract_address AND j.transaction_hash=e.transaction_hash AND j.log_index=e.log_index
        AND j.block_number=e.block_number AND j.name='Transfer'
      LEFT JOIN LATERAL (SELECT j.block_hash FROM ${schema}.transfer_event m
        JOIN ${schema}.canonical_event j ON j.source_id=$3 AND j.chain_id=t.chain_id AND j.address=t.contract_address
          AND j.transaction_hash=m.transaction_hash AND j.log_index=m.log_index AND j.block_number=m.block_number
          AND j.name='Transfer' AND j.abi_hash=$4
        WHERE m.collection=t.collection AND m.chain_id=t.chain_id AND m.contract_address=t.contract_address
          AND m.token_id=t.token_id AND m.lifecycle=t.lifecycle AND m."from"='${zero}' AND m."to"=l.minted_to
          AND m.transaction_hash=l.mint_transaction_hash AND m.block_number=t.mint_block
        ORDER BY m.log_index LIMIT 1) mint_proof ON true
      WHERE t.token_id=$2`,
            [
              status.anchor.number,
              tokenId,
              definition.sourceId,
              status.source.abiHash
            ]
          )
        ).rows[0] ?? null;
      if (
        token &&
        (!/^0x[0-9a-f]{40}$/.test(token.owner) ||
          !Number.isSafeInteger(token.lifecycle) ||
          token.lifecycle < 1 ||
          !token.minted_to ||
          !token.mint_transaction_hash ||
          !token.event_block_hash ||
          !token.mint_block_hash ||
          token.event_abi_hash !== status.source.abiHash ||
          token.lifecycle_mint_block !== token.mint_block ||
          token.lifecycle_mint_timestamp !== token.mint_timestamp ||
          token.event_lifecycle !== token.lifecycle ||
          token.event_to !== token.owner ||
          token.event_transaction_hash !== token.last_transaction_hash ||
          token.event_block_number !== token.last_transfer_block ||
          token.burned !== (token.owner === zero))
      )
        throw new CanonicalSourceUnavailable(
          "Ownership history proof is incomplete."
        );
      return { release, status, anchor: status.anchor, token };
    }
  );
}
