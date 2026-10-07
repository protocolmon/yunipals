import type { Pool } from "pg";
import { parseAbi } from "viem";
import { islandCollection, ZERO_ADDRESS } from "../constants.js";
import { sqlIdentifier } from "../offchain/sql.js";
import { ethereumCheckpointBlock } from "./readiness.js";

export const islandStakingAddress =
  "0x6baad25b4807860e9fc3a0d2b6d1da4c895cfca8";
export const islandStakingAbi = parseAbi([
  "function islandContract() view returns (address)",
  "function paused() view returns (bool)",
  "function stakedIslandsOf(address wallet) view returns (uint256[])",
  "function unstakeGenesisIslands(uint256[] islandIds)"
]);

export const stakingMigrations = [
  `CREATE TABLE IF NOT EXISTS metadata.island_staking_scan (
    schema_name text PRIMARY KEY, build_id text NOT NULL,
    state text NOT NULL CHECK(state IN ('ready','unavailable')),
    block_number numeric(78,0) NOT NULL, block_hash text NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.island_staking_position (
    schema_name text NOT NULL, build_id text NOT NULL,
    token_id text NOT NULL, lifecycle integer NOT NULL,
    deposit_event_id text NOT NULL, staker text,
    PRIMARY KEY(schema_name,token_id),
    CHECK(staker IS NULL OR staker ~ '^0x[0-9a-f]{40}$')
  )`
] as const;

export type StakingChainReader = {
  finalizedBlock(): Promise<{ number: bigint; hash: string }>;
  blockHash(block: bigint): Promise<string>;
  islandContract(block: bigint): Promise<string>;
  custodyBalance(block: bigint): Promise<bigint>;
  owners(ids: bigint[], block: bigint): Promise<string[]>;
  stakedIslands(
    wallet: `0x${string}`,
    block: bigint
  ): Promise<readonly bigint[]>;
};
type Deposit = {
  tokenId: string;
  lifecycle: number;
  eventId: string;
  depositor: string;
};

function depositQuery(schemaName: string) {
  return `SELECT token_id AS "tokenId",lifecycle,id AS "eventId","from" AS depositor FROM (
    SELECT DISTINCT ON(token_id) * FROM ${sqlIdentifier(schemaName)}.transfer_event
    WHERE collection=$1 AND chain_id=1 AND contract_address=$2 AND block_number<=$3::numeric
    ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC
  ) latest WHERE "to"=$4 ORDER BY token_id::numeric`;
}

/** All RPC reads share one finalized block. Failed scans never publish partial ownership. */
export async function syncIslandStaking(
  pool: Pick<Pool, "query" | "connect">,
  schemaName: string,
  chain: StakingChainReader
) {
  const block = await chain.finalizedBlock();
  if (
    (await chain.islandContract(block.number)).toLowerCase() !==
    islandCollection.address
  )
    throw new Error("staking_collection_mismatch");
  const schema = sqlIdentifier(schemaName);
  const readBuild = async () =>
    (
      await pool.query<{ build: string; ready: string; checkpoint: string }>(
        `SELECT value->>'build_id' AS build,value->>'is_ready' AS ready,
    (SELECT latest_checkpoint FROM ${schema}._ponder_checkpoint WHERE chain_id=1) AS checkpoint
    FROM ${schema}._ponder_meta WHERE key='app'`
      )
    ).rows[0];
  const build = await readBuild();
  const indexed = ethereumCheckpointBlock(build?.checkpoint);
  if (
    !build?.build ||
    build.ready !== "1" ||
    indexed === null ||
    indexed < block.number
  )
    throw new Error("staking_indexer_catching_up");
  const params = [
    islandCollection.slug,
    islandCollection.address,
    block.number.toString(),
    islandStakingAddress
  ];
  const deposits = (await pool.query<Deposit>(depositQuery(schemaName), params))
    .rows;
  if (BigInt(deposits.length) !== (await chain.custodyBalance(block.number)))
    throw new Error("staking_custody_count_mismatch");
  for (let offset = 0; offset < deposits.length; offset += 40) {
    const batch = deposits.slice(offset, offset + 40);
    const owners = await chain.owners(
      batch.map((d) => BigInt(d.tokenId)),
      block.number
    );
    if (
      owners.length !== batch.length ||
      owners.some((owner) => owner.toLowerCase() !== islandStakingAddress)
    )
      throw new Error("staking_custody_mismatch");
  }
  const wallets = [
    ...new Set(
      deposits.map((d) => d.depositor).filter((w) => w !== ZERO_ADDRESS)
    )
  ];
  const memberships = new Map<string, Set<string>>();
  for (let offset = 0; offset < wallets.length; offset += 8) {
    await Promise.all(
      wallets.slice(offset, offset + 8).map(async (wallet) => {
        const ids = await chain.stakedIslands(
          wallet as `0x${string}`,
          block.number
        );
        memberships.set(wallet, new Set(ids.map(String)));
      })
    );
  }
  if (
    (await chain.blockHash(block.number)).toLowerCase() !==
    block.hash.toLowerCase()
  )
    throw new Error("staking_finalized_block_changed");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const currentBuild = (
      await client.query<{ build: string }>(
        `SELECT value->>'build_id' AS build FROM ${schema}._ponder_meta WHERE key='app'`
      )
    ).rows[0]?.build;
    const currentDeposits = (
      await client.query<Deposit>(depositQuery(schemaName), params)
    ).rows;
    if (
      currentBuild !== build.build ||
      JSON.stringify(deposits) !== JSON.stringify(currentDeposits)
    )
      throw new Error("staking_indexed_history_changed");
    await client.query(
      "DELETE FROM metadata.island_staking_position WHERE schema_name=$1",
      [schemaName]
    );
    let verified = 0;
    for (const deposit of deposits) {
      const staker = memberships.get(deposit.depositor)?.has(deposit.tokenId)
        ? deposit.depositor
        : null;
      if (staker) verified++;
      await client.query(
        `INSERT INTO metadata.island_staking_position
        (schema_name,build_id,token_id,lifecycle,deposit_event_id,staker) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          schemaName,
          build.build,
          deposit.tokenId,
          deposit.lifecycle,
          deposit.eventId,
          staker
        ]
      );
    }
    await client.query(
      `INSERT INTO metadata.island_staking_scan
      (schema_name,build_id,state,block_number,block_hash) VALUES($1,$2,'ready',$3,$4)
      ON CONFLICT(schema_name) DO UPDATE SET build_id=EXCLUDED.build_id,state='ready',
      block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,verified_at=now()`,
      [schemaName, build.build, block.number.toString(), block.hash]
    );
    await client.query("COMMIT");
    return {
      block: block.number.toString(),
      custody: deposits.length,
      verified,
      unverified: deposits.length - verified
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Join only a fresh scan from this Ponder build and the token's exact latest transfer. */
export function stakingRelation(schemaName: string) {
  const schema = sqlIdentifier(schemaName);
  return `LEFT JOIN metadata.island_staking_scan ss ON ss.schema_name='${schemaName}'
    AND ss.build_id=(SELECT value->>'build_id' FROM ${schema}._ponder_meta WHERE key='app')
    AND ss.state='ready' AND ss.verified_at>now()-interval '15 minutes'
    LEFT JOIN metadata.island_staking_position sp ON sp.schema_name=ss.schema_name AND sp.build_id=ss.build_id
    AND sp.token_id=t.token_id AND sp.lifecycle=t.lifecycle AND NOT t.burned AND t.owner='${islandStakingAddress}'
    AND sp.deposit_event_id=(SELECT e.id FROM ${schema}.transfer_event e
      WHERE e.collection=t.collection AND e.token_id=t.token_id AND e.lifecycle=t.lifecycle
      AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address
      ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1)`;
}

export const stakingColumns = `jsonb_build_object(
  'status',CASE WHEN t.burned OR t.owner<>'${islandStakingAddress}' THEN 'none'
    WHEN sp.staker IS NOT NULL THEN 'staked' ELSE 'unverified' END,
  'staker',sp.staker,'contractAddress','${islandStakingAddress}',
  'checkedBlock',ss.block_number::text) AS staking`;

export async function stakingReadiness(
  pool: Pick<Pool, "query">,
  schemaName: string,
  enabled: boolean
) {
  if (!enabled)
    return {
      enabled: false,
      ready: false,
      checkedBlock: null,
      reason: "disabled"
    };
  const schema = sqlIdentifier(schemaName);
  const scan = (
    await pool.query<{ ready: boolean; block: string }>(
      `SELECT s.state='ready' AND s.verified_at>now()-interval '15 minutes'
    AND NOT EXISTS(SELECT 1 FROM ${schema}.token t ${stakingRelation(schemaName)}
      WHERE t.collection='${islandCollection.slug}' AND t.chain_id=1 AND t.contract_address='${islandCollection.address}'
      AND t.owner='${islandStakingAddress}' AND NOT t.burned AND sp.token_id IS NULL)
    AS ready,s.block_number::text AS block
    FROM metadata.island_staking_scan s WHERE s.schema_name=$1
    AND s.build_id=(SELECT value->>'build_id' FROM ${schema}._ponder_meta WHERE key='app')`,
      [schemaName]
    )
  ).rows[0];
  return {
    enabled: true,
    ready: scan?.ready === true,
    checkedBlock: scan?.block ?? null,
    reason: scan?.ready ? null : "verification_unavailable"
  };
}
