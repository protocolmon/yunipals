import { createHash } from "node:crypto";
import { mkdir, open, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { Pool, PoolClient } from "pg";
import { decodeEventLog, type Hex, type PublicClient } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import { readConfirmedBlock } from "@/confirmations";
import type { ArenaDeployment } from "./projector";
import { json, projectEvent } from "./projection";
import { sourceLeaseKey } from "./sourceSelection";

const tables = [
  "deployment",
  "chain_event",
  "tournament",
  "credit",
  "submission",
  "frozen_input",
  "fighter_snapshot",
  "provider_task",
  "transaction_intent",
  "adjudication",
  "media_job",
  "client_transaction",
  "admission"
] as const;
type Row = Record<string, unknown>;
type Snapshot = Record<(typeof tables)[number], Row[]>;
const integerColumns: Partial<Record<(typeof tables)[number], string[]>> = {
  deployment: ["start_block", "cursor"],
  chain_event: ["block_number"],
  tournament: ["id"],
  credit: ["amount"],
  submission: ["tournament_id"],
  frozen_input: ["tournament_id"],
  fighter_snapshot: ["tournament_id", "token_id"],
  provider_task: ["tournament_id", "reserved_microusd", "actual_microusd"],
  transaction_intent: ["tournament_id", "nonce"],
  adjudication: ["tournament_id"],
  media_job: ["tournament_id"],
  client_transaction: ["indexed_through_block"],
  admission: ["tournament_id", "token_id", "ownership_block", "expiry"]
};
type StoredEvent = {
  blockNumber: string;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  eventName: string;
  args: Record<string, unknown>;
};
export type ArenaRecoveryPlan = {
  version: "arena-recovery-v1";
  deployment: Omit<ArenaDeployment, "startBlock"> & { startBlock: string };
  originalCursor: string | null;
  originalHash: Hex | null;
  sourceHash: string;
  head: { number: string; hash: Hex };
  events: StoredEvent[];
  issues: string[];
  summary: {
    events: number;
    tournaments: number;
    creditWallets: number;
    rpcLogRanges: number;
  };
  hash: string;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)])
    );
  return typeof value === "bigint" ? value.toString() : value;
}
function hash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)) ?? "null")
    .digest("hex");
}
async function snapshot(db: PoolClient, deployment: string) {
  const result = {} as Snapshot;
  for (const table of tables) {
    const column = table === "deployment" ? "id" : "deployment";
    const integers = integerColumns[table]
      ?.flatMap((key) => [`'${key}'`, `r.${key}::text`])
      .join(",");
    result[table] = (
      await db.query<{ row: Row }>(
        `SELECT to_jsonb(r)${integers ? `||jsonb_build_object(${integers})` : ""} AS row FROM yunipals_arena.${table} r WHERE ${column}=$1 ORDER BY to_jsonb(r)::text`,
        [deployment]
      )
    ).rows.map(({ row }) => row);
  }
  // Freshness heartbeat is not part of the historical projection identity.
  result.deployment = result.deployment.map(
    ({ finalized_at: _heartbeat, ...row }) => row
  );
  return result;
}
function requireHalted(source: Snapshot, deployment: ArenaDeployment) {
  const row = source.deployment[0];
  if (row?.indexer_mode !== "legacy")
    throw new Error(
      "Legacy recovery cannot rewrite a native Arena deployment."
    );
  if (!row || row.halted !== true)
    throw new Error(
      "Recovery requires an already halted deployment; healthy indexing is never rewound."
    );
  if (
    row.contract !== deployment.contract.toLowerCase() ||
    String(row.start_block) !== deployment.startBlock.toString()
  )
    throw new Error(
      "Recovery deployment configuration differs from the journal."
    );
  return row;
}
async function lock(db: PoolClient, deployment: string, exclusive: boolean) {
  await db.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
    sourceLeaseKey(deployment)
  ]);
  const held = (
    await db.query<{ held: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS held",
      [`arena/project/${deployment}`]
    )
  ).rows[0]?.held;
  if (!held)
    throw new Error(
      "The projector still owns its lock; stop it before recovery."
    );
  if (exclusive)
    await db.query(
      `LOCK TABLE ${tables.map((table) => `yunipals_arena.${table}`).join(",")} IN EXCLUSIVE MODE`
    );
}
async function replay(
  db: PoolClient,
  deployment: string,
  events: StoredEvent[]
) {
  for (const table of [
    "chain_event",
    "tournament",
    "credit",
    "submission",
    "frozen_input",
    "deployment"
  ] as const) {
    await db.query(
      `CREATE TEMP TABLE ${table} (LIKE yunipals_arena.${table} INCLUDING ALL) ON COMMIT DROP`
    );
    if (["submission", "frozen_input", "deployment"].includes(table)) {
      const column = table === "deployment" ? "id" : "deployment";
      await db.query(
        `INSERT INTO pg_temp.${table} SELECT * FROM yunipals_arena.${table} WHERE ${column}=$1`,
        [deployment]
      );
    }
  }
  const target = new Proxy(db, {
    get(object, property) {
      if (property === "query")
        return (query: string, values: unknown[]) =>
          object.query(query.replaceAll("yunipals_arena.", "pg_temp."), values);
      return Reflect.get(object, property);
    }
  });
  for (const event of events)
    await projectEvent(target, deployment, {
      ...event,
      blockNumber: BigInt(event.blockNumber)
    });
  const states = (
    await db.query<{ id: string; state: ArenaTournament }>(
      "SELECT id::text,state FROM pg_temp.tournament WHERE deployment=$1 ORDER BY id",
      [deployment]
    )
  ).rows;
  const credits = (
    await db.query(
      "SELECT wallet,amount::text FROM pg_temp.credit WHERE deployment=$1 ORDER BY wallet",
      [deployment]
    )
  ).rows;
  return { states, credits };
}

function compatibility(
  source: Snapshot,
  states: { id: string; state: ArenaTournament }[]
) {
  const issues = new Set<string>();
  const next = new Map(states.map((row) => [row.id, row.state]));
  const prior = new Map(
    source.tournament.map((row) => [
      String(row.id),
      row.state as ArenaTournament
    ])
  );
  for (const table of [
    "submission",
    "frozen_input",
    "fighter_snapshot",
    "provider_task",
    "adjudication",
    "media_job"
  ] as const)
    for (const row of source[table])
      if (!next.has(String(row.tournament_id)))
        issues.add(`orphaned-${table}:${row.tournament_id}`);
  for (const row of source.submission) {
    const id = String(row.tournament_id),
      seat = Number(row.seat);
    const old = prior.get(id),
      current = next.get(id);
    if (
      hash(old?.seats[seat]) !== hash(current?.seats[seat]) ||
      old?.islandId !== current?.islandId ||
      old?.randomWord !== current?.randomWord ||
      old?.rulesHash !== current?.rulesHash ||
      old?.poolHash !== current?.poolHash
    )
      issues.add(`locked-strategy-context-changed:${id}:${seat}`);
  }
  for (const row of source.frozen_input) {
    const id = String(row.tournament_id),
      current = next.get(id),
      old = prior.get(id);
    if (
      hash(old?.seats) !== hash(current?.seats) ||
      old?.islandId !== current?.islandId ||
      old?.randomWord !== current?.randomWord ||
      old?.rulesHash !== current?.rulesHash ||
      old?.poolHash !== current?.poolHash
    )
      issues.add(`prepared-input-context-changed:${id}`);
    if (row.revealed_at && current?.inputHash !== row.input_hash)
      issues.add(`revealed-input-orphaned:${row.tournament_id}`);
  }
  for (const row of source.provider_task) {
    const id = String(row.tournament_id),
      old = prior.get(id),
      current = next.get(id);
    if (
      !old?.inputHash ||
      current?.inputHash !== old.inputHash ||
      hash(current?.commitments) !== hash(old.commitments)
    )
      issues.add(`paid-input-context-changed:${id}`);
    if (
      row.kind !== "referee" &&
      (!old?.resultHash || current?.resultHash !== old.resultHash)
    )
      issues.add(`paid-film-result-changed:${id}`);
  }
  for (const row of source.adjudication)
    if (next.get(String(row.tournament_id))?.inputHash !== row.input_hash)
      issues.add(`retained-adjudication-input-changed:${row.tournament_id}`);
  for (const row of source.media_job) {
    const id = String(row.tournament_id),
      old = prior.get(id),
      current = next.get(id);
    if (!old?.resultHash || current?.resultHash !== old.resultHash)
      issues.add(`retained-film-result-changed:${id}`);
  }
  return [...issues].sort();
}

async function signedWorkIssues(source: Snapshot, rpc: PublicClient) {
  const issues: string[] = [];
  for (const row of source.transaction_intent) {
    try {
      const receipt = await rpc.getTransactionReceipt({
        hash: row.tx_hash as Hex
      });
      const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
      if (block.hash !== receipt.blockHash)
        issues.push(
          `signed-transaction-not-canonical:${row.purpose}:${row.tournament_id}`
        );
      const savedReceipt = row.receipt as { status?: string } | null;
      if (
        (savedReceipt?.status && savedReceipt.status !== receipt.status) ||
        (["mined", "confirmed"].includes(String(row.state)) &&
          receipt.status !== "success")
      )
        issues.push(
          `signed-transaction-outcome-changed:${row.purpose}:${row.tournament_id}`
        );
    } catch {
      issues.push(
        `signed-transaction-needs-reconciliation:${row.purpose}:${row.tournament_id}`
      );
    }
  }
  return issues;
}

/** Operator-only plan. Never changes live projections, reveals strategies, signs or spends. */
export async function planArenaRecovery(
  pool: Pool,
  rpc: PublicClient,
  deployment: ArenaDeployment,
  maxBlocks: number
) {
  if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 100000)
    throw new Error(
      "An explicit recovery scan bound of 1–100000 blocks is required."
    );
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await lock(db, deployment.id, false);
    const source = await snapshot(db, deployment.id);
    const original = requireHalted(source, deployment);
    if ((await rpc.getChainId()) !== 8453)
      throw new Error("Recovery requires Base.");
    const head = await readConfirmedBlock(rpc, 8453);
    const blocks = head.number - deployment.startBlock + 1n;
    if (blocks < 1n || blocks > BigInt(maxBlocks))
      throw new Error("Recovery scan exceeds its explicit RPC bound.");
    const events: StoredEvent[] = [];
    let ranges = 0;
    for (let from = deployment.startBlock; from <= head.number; from += 500n) {
      const to = from + 499n < head.number ? from + 499n : head.number;
      const logs = await rpc.getLogs({
        address: deployment.contract,
        fromBlock: from,
        toBlock: to
      });
      ranges++;
      for (const log of logs) {
        if (
          log.removed ||
          log.blockNumber === null ||
          !log.blockHash ||
          !log.transactionHash ||
          log.logIndex === null
        )
          throw new Error("Recovery received an incomplete canonical log.");
        const decoded = decodeEventLog({
          abi: arenaAbi,
          data: log.data,
          topics: log.topics,
          strict: true
        });
        events.push({
          blockNumber: log.blockNumber.toString(),
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          eventName: decoded.eventName,
          args: JSON.parse(json(decoded.args)) as Record<string, unknown>
        });
      }
    }
    events.sort((a, b) =>
      BigInt(a.blockNumber) < BigInt(b.blockNumber)
        ? -1
        : BigInt(a.blockNumber) > BigInt(b.blockNumber)
          ? 1
          : a.logIndex - b.logIndex
    );
    const blocksToCheck = new Map<string, Hex>();
    const uniqueLogs = new Map<string, string>();
    for (const event of events) {
      const previousHash = blocksToCheck.get(event.blockNumber);
      if (previousHash && previousHash !== event.blockHash)
        throw new Error("Recovery received mixed canonical block hashes.");
      blocksToCheck.set(event.blockNumber, event.blockHash);
      const key = `${event.transactionHash}/${event.logIndex}`,
        previousLog = uniqueLogs.get(key);
      if (previousLog && previousLog !== hash(event))
        throw new Error("Recovery received conflicting duplicate logs.");
      uniqueLogs.set(key, hash(event));
    }
    for (const [number, expected] of blocksToCheck)
      if (
        (await rpc.getBlock({ blockNumber: BigInt(number) })).hash !== expected
      )
        throw new Error("History changed during recovery planning.");
    const candidate = await replay(db, deployment.id, events);
    const issues = [
      ...compatibility(source, candidate.states),
      ...(await signedWorkIssues(source, rpc))
    ];
    if ((await rpc.getBlock({ blockNumber: head.number })).hash !== head.hash)
      throw new Error("Recovery head changed during planning.");
    const body = {
      version: "arena-recovery-v1" as const,
      deployment: {
        ...deployment,
        startBlock: deployment.startBlock.toString()
      },
      originalCursor: original.cursor === null ? null : String(original.cursor),
      originalHash: original.cursor_hash as Hex | null,
      sourceHash: hash(source),
      head: { number: head.number.toString(), hash: head.hash },
      events,
      issues,
      summary: {
        events: events.length,
        tournaments: candidate.states.length,
        creditWallets: candidate.credits.length,
        rpcLogRanges: ranges
      }
    };
    await db.query("ROLLBACK");
    return { ...body, hash: hash(body) };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

/** Apply a reviewed plan atomically. Unsafe orphaned work stays fenced for reconciliation. */
export async function applyArenaRecovery(
  pool: Pool,
  rpc: PublicClient,
  plan: ArenaRecoveryPlan,
  expectedHash: string,
  archivePath: string
) {
  const { hash: actualHash, ...body } = plan;
  if (
    plan.version !== "arena-recovery-v1" ||
    actualHash !== expectedHash ||
    hash(body) !== expectedHash
  )
    throw new Error("Recovery plan hash differs from the exact reviewed plan.");
  if (plan.issues.length)
    throw new Error(
      "Recovery is blocked by unreconciled work; retain the fence."
    );
  if (!isAbsolute(archivePath))
    throw new Error("Recovery archive must use a private absolute path.");
  await mkdir(dirname(archivePath), { recursive: true, mode: 0o700 });
  if ((await stat(dirname(archivePath))).mode & 0o077)
    throw new Error("Recovery archive directory must be private (0700).");
  if ((await rpc.getChainId()) !== 8453)
    throw new Error("Recovery requires Base.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await lock(db, plan.deployment.id, true);
    const source = await snapshot(db, plan.deployment.id);
    requireHalted(source, {
      ...plan.deployment,
      startBlock: BigInt(plan.deployment.startBlock)
    });
    if (hash(source) !== plan.sourceHash)
      throw new Error("Live records changed; prepare a new recovery plan.");
    if (
      (await rpc.getBlock({ blockNumber: BigInt(plan.head.number) })).hash !==
      plan.head.hash
    )
      throw new Error("Canonical recovery head changed; prepare a new plan.");
    const candidate = await replay(db, plan.deployment.id, plan.events);
    if (
      compatibility(source, candidate.states).length ||
      (await signedWorkIssues(source, rpc)).length
    )
      throw new Error("Recovery reconciliation no longer holds.");
    // Contains encrypted submissions and retained signing intents. Never serve or publish it.
    const archive = await open(archivePath, "wx", 0o600);
    try {
      await archive.writeFile(
        json({
          version: "arena-recovery-archive-v1",
          planHash: expectedHash,
          source
        }) + "\n"
      );
      await archive.sync();
    } finally {
      await archive.close();
    }
    const directory = await open(dirname(archivePath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    for (const table of ["chain_event", "credit"] as const) {
      await db.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [plan.deployment.id]
      );
      await db.query(
        `INSERT INTO yunipals_arena.${table} SELECT * FROM pg_temp.${table}`
      );
    }
    for (const row of candidate.states)
      await db.query(
        "INSERT INTO yunipals_arena.tournament(deployment,id,state) VALUES($1,$2,$3) ON CONFLICT(deployment,id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()",
        [plan.deployment.id, row.id, json(row.state)]
      );
    await db.query(
      "DELETE FROM yunipals_arena.tournament WHERE deployment=$1 AND id NOT IN (SELECT id FROM pg_temp.tournament)",
      [plan.deployment.id]
    );
    await db.query(
      "UPDATE yunipals_arena.frozen_input f SET revealed_at=coalesce(f.revealed_at,t.revealed_at) FROM pg_temp.frozen_input t WHERE f.deployment=$1 AND f.deployment=t.deployment AND f.tournament_id=t.tournament_id AND f.input_hash=t.input_hash",
      [plan.deployment.id]
    );
    await db.query(
      "UPDATE yunipals_arena.client_transaction SET state='submitted',result=NULL,indexed_through_block=NULL,next_check_at=now(),tracking_until=now()+interval '2 hours' WHERE deployment=$1",
      [plan.deployment.id]
    );
    await db.query("DELETE FROM yunipals_arena.capacity WHERE deployment=$1", [
      plan.deployment.id
    ]);
    // Recheck immediately before the atomic cursor/unfence commit.
    if (
      (await rpc.getBlock({ blockNumber: BigInt(plan.head.number) })).hash !==
      plan.head.hash
    )
      throw new Error("Recovery head changed before commit; fence retained.");
    await db.query(
      "UPDATE yunipals_arena.deployment SET cursor=$2,cursor_hash=$3,halted=false,halt_reason=NULL,finalized_at=NULL WHERE id=$1",
      [plan.deployment.id, plan.head.number, plan.head.hash]
    );
    await db.query("COMMIT");
    return {
      status: "recovered-awaiting-catchup" as const,
      planHash: expectedHash,
      archivePath,
      ...plan.summary
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
