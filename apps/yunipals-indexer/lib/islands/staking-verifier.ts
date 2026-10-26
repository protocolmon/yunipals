import type { Pool, PoolClient } from "pg";
import { islandCollection, ZERO_ADDRESS } from "../constants.js";
import {
  ownershipReadConfig,
  physicalPonderSchemaName,
  sqlIdentifier,
  unifiedOwnershipReads
} from "../offchain/sql.js";
import {
  ownershipReadIdentity,
  unifiedOwnershipStatus
} from "../ownership/readiness.js";
import { islandStakingAddress } from "./staking-read.js";

/** Explicit owner migration only. APIs and verifier tasks never run this DDL. */
export const nativeStakingSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS metadata.island_staking_scan (
    schema_name text PRIMARY KEY,build_id text NOT NULL,
    state text NOT NULL CHECK(state IN('ready','unavailable')),
    block_number numeric(78,0) NOT NULL,block_hash text NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS metadata.island_staking_position (
    schema_name text NOT NULL,build_id text NOT NULL,token_id text NOT NULL,
    lifecycle integer NOT NULL,deposit_event_id text NOT NULL,staker text,
    PRIMARY KEY(schema_name,token_id),CHECK(staker IS NULL OR staker ~ '^0x[0-9a-f]{40}$'))`,
  `ALTER TABLE metadata.island_staking_scan ADD COLUMN IF NOT EXISTS ownership_release_id text`,
  `ALTER TABLE metadata.island_staking_scan ADD COLUMN IF NOT EXISTS ownership_read_identity text`
] as const;

/** The configured caller supplies an approved budget-proxy adapter. These are
 * bounded logical reads, not an alternative CU accounting/provider authority.
 * No adapter or provider is constructed by this module or an API request.
 */
export type NativeStakingChainReader = {
  contractAddress: string;
  finalizedBlock(): Promise<{ number: bigint; hash: string }>;
  blockHash(block: bigint): Promise<string>;
  islandContract(block: bigint): Promise<string>;
  custodyBalance(block: bigint): Promise<bigint>;
  owners(ids: bigint[], block: bigint): Promise<string[]>;
  stakedIslands(
    wallet: `0x${string}`,
    block: bigint
  ): Promise<readonly bigint[]>;
  stakedIslandsMany?(
    wallets: readonly `0x${string}`[],
    block: bigint
  ): Promise<readonly (readonly bigint[])[]>;
};
export type NativeStakingLimits = { maxTokens: number; maxReadCalls: number };
type Deposit = {
  tokenId: string;
  lifecycle: number;
  eventId: string;
  depositor: string;
};

async function sourceProof(
  db: Pick<PoolClient, "query">,
  readSchema: string,
  block: { number: bigint; hash: string },
  limit: number
) {
  const identity = await ownershipReadIdentity(db);
  const status = await unifiedOwnershipStatus(db, [islandCollection.slug]);
  if (
    !identity ||
    !status?.ready ||
    BigInt(status.collections[0]!.block_number!) < block.number
  )
    throw new Error("staking_source_unavailable");
  const build = (
    await db.query<{ build_id: string }>(
      `SELECT r.build_id FROM yunipals_indexer_control.release r
      JOIN ${sqlIdentifier(physicalPonderSchemaName)}.chain_block anchor
        ON anchor.chain_id=1 AND anchor.block_number=$2::bigint AND anchor.block_hash=$3
      WHERE r.id=$1 AND r.physical_schema=$4`,
      [
        identity.release_id,
        block.number.toString(),
        block.hash,
        physicalPonderSchemaName
      ]
    )
  ).rows[0]?.build_id;
  if (!build) throw new Error("staking_canonical_anchor_unavailable");
  const deposits = (
    await db.query<Deposit>(
      `SELECT token_id AS "tokenId",lifecycle,id AS "eventId","from" AS depositor FROM (
      SELECT DISTINCT ON(token_id) * FROM ${sqlIdentifier(readSchema)}.transfer_event
      WHERE collection=$1 AND chain_id=1 AND contract_address=$2 AND block_number<=$3::bigint
      ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC
    ) latest WHERE "to"=$4 ORDER BY token_id::numeric LIMIT $5`,
      [
        islandCollection.slug,
        islandCollection.address,
        block.number.toString(),
        islandStakingAddress,
        limit + 1
      ]
    )
  ).rows;
  if (
    deposits.length > limit ||
    deposits.some(
      (row) =>
        !/^(0|[1-9][0-9]*)$/.test(row.tokenId) ||
        !/^0x[0-9a-f]{40}$/.test(row.depositor) ||
        row.depositor === ZERO_ADDRESS
    )
  )
    throw new Error("staking_deposit_limit_or_identity_invalid");
  return { identity, build, deposits };
}

/** One explicitly invoked operational projection task over the shared journal.
 * Reads one finalized contract-state snapshot and publishes only after fresh
 * release/build/anchor/deposit checks. It never indexes logs or selects a source.
 */
export async function verifyNativeIslandStaking(
  pool: Pick<Pool, "connect">,
  readSchema: string,
  chain: NativeStakingChainReader,
  limits: NativeStakingLimits
) {
  if (
    !unifiedOwnershipReads ||
    readSchema !== ownershipReadConfig.readSchema ||
    chain.contractAddress.toLowerCase() !== islandStakingAddress ||
    !Number.isSafeInteger(limits.maxTokens) ||
    limits.maxTokens < 1 ||
    limits.maxTokens > 10000 ||
    !Number.isSafeInteger(limits.maxReadCalls) ||
    limits.maxReadCalls < 1 ||
    limits.maxReadCalls > 5000
  )
    throw new Error("staking_verifier_configuration_invalid");
  let readCalls = 0;
  const point = async <T>(task: () => Promise<T>): Promise<T> => {
    if (readCalls >= limits.maxReadCalls)
      throw new Error("staking_point_read_limit");
    readCalls++;
    return task();
  };
  const block = await point(() => chain.finalizedBlock());
  if (
    block.number < BigInt(islandCollection.deploymentBlock) ||
    !/^0x[0-9a-f]{64}$/.test(block.hash)
  )
    throw new Error("staking_finalized_anchor_invalid");
  const first = await pool.connect();
  let proof: Awaited<ReturnType<typeof sourceProof>>;
  try {
    await first.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await first.query("SET LOCAL statement_timeout='8s'");
    await first.query("SET LOCAL lock_timeout='1s'");
    proof = await sourceProof(first, readSchema, block, limits.maxTokens);
    await first.query("COMMIT");
  } catch (error) {
    await first.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    first.release();
  }
  if (
    (await point(() => chain.islandContract(block.number))).toLowerCase() !==
    islandCollection.address
  )
    throw new Error("staking_collection_mismatch");
  if (
    (await point(() => chain.custodyBalance(block.number))) !==
    BigInt(proof.deposits.length)
  )
    throw new Error("staking_custody_count_mismatch");
  for (let offset = 0; offset < proof.deposits.length; offset += 40) {
    const batch = proof.deposits.slice(offset, offset + 40);
    const owners = await point(() =>
      chain.owners(
        batch.map((row) => BigInt(row.tokenId)),
        block.number
      )
    );
    if (
      owners.length !== batch.length ||
      owners.some((owner) => owner.toLowerCase() !== islandStakingAddress)
    )
      throw new Error("staking_owner_mismatch");
  }
  const memberships = new Map<string, Set<string>>();
  const wallets = [
    ...new Set(proof.deposits.map((row) => row.depositor))
  ] as `0x${string}`[];
  const membership = (wallet: string, ids: readonly bigint[]) => {
    if (!Array.isArray(ids) || ids.length > limits.maxTokens)
      throw new Error("staking_membership_limit");
    for (const token of ids) {
      if (typeof token !== "bigint" || token < 0n)
        throw new Error("staking_membership_limit");
    }
    memberships.set(wallet, new Set(ids.map(String)));
  };
  const readMany = chain.stakedIslandsMany;
  if (readMany) {
    for (let offset = 0; offset < wallets.length; offset += 40) {
      const batch = wallets.slice(offset, offset + 40);
      const rows = await point(() => readMany.call(chain, batch, block.number));
      if (!Array.isArray(rows) || rows.length !== batch.length)
        throw new Error("staking_membership_batch_mismatch");
      for (let index = 0; index < batch.length; index++)
        membership(batch[index]!, rows[index]!);
    }
  } else {
    for (const wallet of wallets) {
      const ids = await point(() => chain.stakedIslands(wallet, block.number));
      membership(wallet, ids);
    }
  }
  if (
    (await point(() => chain.blockHash(block.number))).toLowerCase() !==
    block.hash
  )
    throw new Error("staking_finalized_block_changed");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SET LOCAL statement_timeout='8s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    const locked = (
      await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('native-island-staking'),hashtext($1)) AS locked",
        [physicalPonderSchemaName]
      )
    ).rows[0]?.locked;
    if (!locked) throw new Error("staking_verification_busy");
    const current = await sourceProof(
      client,
      readSchema,
      block,
      limits.maxTokens
    );
    if (JSON.stringify(current) !== JSON.stringify(proof))
      throw new Error("staking_indexed_history_changed");
    await client.query(
      "DELETE FROM metadata.island_staking_position WHERE schema_name=$1",
      [physicalPonderSchemaName]
    );
    let verified = 0;
    for (const deposit of proof.deposits) {
      const staker = memberships.get(deposit.depositor)?.has(deposit.tokenId)
        ? deposit.depositor
        : null;
      if (staker) verified++;
      await client.query(
        `INSERT INTO metadata.island_staking_position
        (schema_name,build_id,token_id,lifecycle,deposit_event_id,staker) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          physicalPonderSchemaName,
          proof.build,
          deposit.tokenId,
          deposit.lifecycle,
          deposit.eventId,
          staker
        ]
      );
    }
    await client.query(
      `INSERT INTO metadata.island_staking_scan
      (schema_name,build_id,state,block_number,block_hash,ownership_release_id,ownership_read_identity)
      VALUES($1,$2,'ready',$3,$4,$5,$6) ON CONFLICT(schema_name) DO UPDATE SET build_id=EXCLUDED.build_id,
        state='ready',block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,
        ownership_release_id=EXCLUDED.ownership_release_id,ownership_read_identity=EXCLUDED.ownership_read_identity,verified_at=now()`,
      [
        physicalPonderSchemaName,
        proof.build,
        block.number.toString(),
        block.hash,
        proof.identity.release_id,
        proof.identity.identity
      ]
    );
    await client.query("COMMIT");
    return {
      block: block.number.toString(),
      custody: proof.deposits.length,
      verified,
      unverified: proof.deposits.length - verified,
      readCalls,
      releaseId: proof.identity.release_id,
      readIdentity: proof.identity.identity
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
