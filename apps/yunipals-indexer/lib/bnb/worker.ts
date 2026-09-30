import {
  createPublicClient,
  decodeEventLog,
  hexToNumber,
  http,
  toEventSelector,
  type Hex
} from "viem";
import { bsc } from "viem/chains";
import type { PoolClient } from "pg";
import { collectionAbi, collectionAddress, ZERO_ADDRESS } from "./config.js";
import { pool } from "./db.js";
import { bnbSchema } from "./schema.js";
import { safeErrorMessage } from "./safe-error.js";
import { createShutdownDeadline } from "./shutdown-deadline.mjs";
import { acquireBnbWriterLock, releaseBnbWriterLock } from "./writer-lock.js";

type RawLog = {
  address: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  data: Hex;
  logIndex: Hex;
  topics: Hex[];
  transactionHash: Hex;
  transactionIndex: Hex;
};

type SyncState = {
  nextBlock: string;
  lastScannedBlock: string | null;
  lastScannedHash: string | null;
};

type TokenState = {
  token_id: string;
  owner: string;
  burned: boolean;
  lifecycle: number;
  mint_block: string;
  mint_timestamp: string;
  last_transfer_block: string;
  last_transfer_timestamp: string;
  last_transaction_hash: string;
};

const definition = { address: collectionAddress, chainId: 56 };
function integerSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`Invalid ${name}`);
  return value;
}

const maxRange = integerSetting("BNB_LOG_BLOCK_RANGE", 100_000, 1, 100_000);
const confirmations = integerSetting("BNB_CONFIRMATIONS", 20, 1, 1_000);
const reconcileMs = integerSetting("BNB_RECONCILE_MS", 300_000, 10_000, 3_600_000);
const blockConcurrency = integerSetting("BNB_BLOCK_CONCURRENCY", 20, 1, 50);
function endBlockSetting(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("Invalid BNB_END_BLOCK");
  return BigInt(value);
}
const configuredEndBlock = endBlockSetting(process.env.BNB_END_BLOCK);
const rpcUrl = process.env.BNB_RPC_URL;
if (!rpcUrl) throw new Error("BNB_RPC_URL is required");
const rpcEndpoint = new URL(rpcUrl);
if (
  rpcEndpoint.protocol !== "https:" &&
  !(rpcEndpoint.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(rpcEndpoint.hostname))
) throw new Error("BNB_RPC_URL must use HTTPS or loopback HTTP");
const client = createPublicClient({ chain: bsc, transport: http(rpcUrl, { timeout: 20_000 }) });
const eventTopics = [
  toEventSelector("Transfer(address,address,uint256)"),
  toEventSelector("RoleGranted(bytes32,address,address)"),
  toEventSelector("RoleRevoked(bytes32,address,address)")
] as Hex[];

let stopping = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const eventId = (transactionHash: string, logIndex: number) => `bnb:${transactionHash}:${logIndex}`;
const isRateLimitError = (error: unknown) => /429|compute units per second|rate limit/i.test(safeErrorMessage(error));
let rpcBackoffUntil = 0;

function jsonRows(rows: unknown[]) {
  return JSON.stringify(rows);
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const current = index++;
      results[current] = await task(values[current]!);
    }
  }));
  return results;
}

async function rawGetLogs(fromBlock: bigint, toBlock: bigint) {
  return await client.request({
    method: "eth_getLogs",
    params: [{
      address: definition.address,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [eventTopics]
    }]
  }) as RawLog[];
}

async function getLogsAdaptive(fromBlock: bigint, toBlock: bigint): Promise<RawLog[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (Date.now() < rpcBackoffUntil) await sleep(rpcBackoffUntil - Date.now());
      return await rawGetLogs(fromBlock, toBlock);
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) && attempt >= 2) break;
      const delay = Math.min(5_000, 500 * (attempt + 1));
      if (isRateLimitError(error)) rpcBackoffUntil = Math.max(rpcBackoffUntil, Date.now() + delay);
      await sleep(delay);
    }
  }
  if (fromBlock === toBlock) throw lastError;
  const middle = (fromBlock + toBlock) / 2n;
  const [left, right] = await Promise.all([
    getLogsAdaptive(fromBlock, middle),
    getLogsAdaptive(middle + 1n, toBlock)
  ]);
  return [...left, ...right];
}

async function getBlockResilient(blockNumber: bigint) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      if (Date.now() < rpcBackoffUntil) await sleep(rpcBackoffUntil - Date.now());
      return await client.getBlock({ blockNumber, includeTransactions: false });
    } catch (error) {
      lastError = error;
      const delay = Math.min(5_000, 500 * (attempt + 1));
      if (isRateLimitError(error)) rpcBackoffUntil = Math.max(rpcBackoffUntil, Date.now() + delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function syncState(database = pool) {
  const result = await database.query<SyncState>(`SELECT next_block::text AS "nextBlock",
    last_scanned_block::text AS "lastScannedBlock", last_scanned_hash AS "lastScannedHash"
    FROM ${bnbSchema}.sync_state WHERE singleton`);
  if (!result.rows[0]) throw new Error("BNB sync state is missing; run db:migrate");
  return result.rows[0];
}

async function validateCursor() {
  const state = await syncState();
  if (!state.lastScannedBlock || !state.lastScannedHash) return;
  const block = await getBlockResilient(BigInt(state.lastScannedBlock));
  if (block.hash.toLowerCase() !== state.lastScannedHash.toLowerCase()) {
    throw new Error(`Finalized BNB cursor hash mismatch at block ${state.lastScannedBlock}`);
  }
}

async function applyRange(fromBlock: bigint, toBlock: bigint, caughtUp: boolean) {
  const started = Date.now();
  const logs = (await getLogsAdaptive(fromBlock, toBlock)).sort((a, b) =>
    hexToNumber(a.blockNumber) - hexToNumber(b.blockNumber)
      || hexToNumber(a.transactionIndex) - hexToNumber(b.transactionIndex)
      || hexToNumber(a.logIndex) - hexToNumber(b.logIndex));

  const blockNumbers = [...new Set([...logs.map((log) => BigInt(log.blockNumber)), toBlock])];
  const blocks = await mapConcurrent(blockNumbers, blockConcurrency, async (blockNumber) => {
    const block = await getBlockResilient(blockNumber);
    return [blockNumber.toString(), { timestamp: block.timestamp.toString(), hash: block.hash }] as const;
  });
  const blockData = new Map(blocks);

  const ids = logs.map((log) => eventId(log.transactionHash, hexToNumber(log.logIndex)));
  const [existingTransfers, existingRoles] = ids.length ? await Promise.all([
    pool.query<{ id: string }>(`SELECT id FROM ${bnbSchema}.transfer_event WHERE id=ANY($1::text[])`, [ids]),
    pool.query<{ id: string }>(`SELECT id FROM ${bnbSchema}.admin_role_event WHERE id=ANY($1::text[])`, [ids])
  ]) : [{ rows: [] }, { rows: [] }];
  const seenTransfers = new Set(existingTransfers.rows.map((row) => row.id));
  const seenRoles = new Set(existingRoles.rows.map((row) => row.id));

  const decoded = logs.map((log) => ({
    log,
    id: eventId(log.transactionHash, hexToNumber(log.logIndex)),
    event: decodeEventLog({ abi: collectionAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
  }));
  const tokenIds = [...new Set(decoded.flatMap((item) =>
    item.event.eventName === "Transfer" && !seenTransfers.has(item.id)
      ? [String(item.event.args.tokenId)]
      : []))];
  const existingTokens = tokenIds.length
    ? await pool.query<TokenState>(`SELECT token_id, owner, burned, lifecycle, mint_block::text,
        mint_timestamp::text, last_transfer_block::text, last_transfer_timestamp::text,
        last_transaction_hash FROM ${bnbSchema}.token WHERE collection='bnb' AND token_id=ANY($1::text[])`, [tokenIds])
    : { rows: [] as TokenState[] };
  const tokens = new Map(existingTokens.rows.map((row) => [row.token_id, { ...row }]));

  const lifecycleMints: Record<string, unknown>[] = [];
  const lifecycleBurns: Record<string, unknown>[] = [];
  const transfers: Record<string, unknown>[] = [];
  const roles: Record<string, unknown>[] = [];

  for (const item of decoded) {
    const blockNumber = BigInt(item.log.blockNumber).toString();
    const blockTimestamp = blockData.get(blockNumber)!.timestamp;
    const logIndex = hexToNumber(item.log.logIndex);
    if (item.event.eventName === "Transfer") {
      if (seenTransfers.has(item.id)) continue;
      const tokenId = String(item.event.args.tokenId);
      const from = String(item.event.args.from).toLowerCase();
      const to = String(item.event.args.to).toLowerCase();
      const existing = tokens.get(tokenId);
      const isMint = from === ZERO_ADDRESS;
      const isBurn = to === ZERO_ADDRESS;
      const lifecycle = isMint ? (existing?.lifecycle ?? 0) + 1 : existing?.lifecycle;
      if (!lifecycle) throw new Error(`Transfer before mint for bnb token ${tokenId}`);

      if (isMint) lifecycleMints.push({
        collection: "bnb", token_id: tokenId, lifecycle, minted_to: to,
        mint_block: blockNumber, mint_timestamp: blockTimestamp,
        mint_transaction_hash: item.log.transactionHash
      });
      if (isBurn) lifecycleBurns.push({
        collection: "bnb", token_id: tokenId, lifecycle,
        burned_at_block: blockNumber, burned_at_timestamp: blockTimestamp,
        burn_transaction_hash: item.log.transactionHash
      });

      tokens.set(tokenId, {
        token_id: tokenId,
        owner: to,
        burned: isBurn,
        lifecycle,
        mint_block: isMint ? blockNumber : existing!.mint_block,
        mint_timestamp: isMint ? blockTimestamp : existing!.mint_timestamp,
        last_transfer_block: blockNumber,
        last_transfer_timestamp: blockTimestamp,
        last_transaction_hash: item.log.transactionHash
      });
      transfers.push({
        id: item.id, collection: "bnb", chain_id: definition.chainId,
        contract_address: definition.address, token_id: tokenId, lifecycle, from, to,
        block_number: blockNumber, block_timestamp: blockTimestamp,
        transaction_hash: item.log.transactionHash,
        transaction_index: hexToNumber(item.log.transactionIndex), log_index: logIndex
      });
      continue;
    }

    if ((item.event.eventName === "RoleGranted" || item.event.eventName === "RoleRevoked") && !seenRoles.has(item.id)) {
      roles.push({
        id: item.id, collection: "bnb", chain_id: definition.chainId,
        contract_address: definition.address, role: item.event.args.role,
        account: String(item.event.args.account).toLowerCase(),
        sender: String(item.event.args.sender).toLowerCase(),
        granted: item.event.eventName === "RoleGranted", block_number: blockNumber,
        transaction_hash: item.log.transactionHash, log_index: logIndex
      });
    }
  }

  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    if (lifecycleMints.length) await database.query(`INSERT INTO ${bnbSchema}.token_lifecycle
      (collection, token_id, lifecycle, minted_to, mint_block, mint_timestamp, mint_transaction_hash)
      SELECT collection, token_id, lifecycle, minted_to, mint_block, mint_timestamp, mint_transaction_hash
      FROM jsonb_to_recordset($1::jsonb) AS x(collection text, token_id text, lifecycle integer,
        minted_to text, mint_block bigint, mint_timestamp bigint, mint_transaction_hash text)
      ON CONFLICT DO NOTHING`, [jsonRows(lifecycleMints)]);
    if (lifecycleBurns.length) await database.query(`UPDATE ${bnbSchema}.token_lifecycle lifecycle SET
      burned_at_block=x.burned_at_block, burned_at_timestamp=x.burned_at_timestamp,
      burn_transaction_hash=x.burn_transaction_hash
      FROM jsonb_to_recordset($1::jsonb) AS x(collection text, token_id text, lifecycle integer,
        burned_at_block bigint, burned_at_timestamp bigint, burn_transaction_hash text)
      WHERE lifecycle.collection=x.collection AND lifecycle.token_id=x.token_id
        AND lifecycle.lifecycle=x.lifecycle`, [jsonRows(lifecycleBurns)]);
    if (tokens.size) await database.query(`INSERT INTO ${bnbSchema}.token
      (collection, chain_id, contract_address, token_id, owner, burned, lifecycle, mint_block,
        mint_timestamp, last_transfer_block, last_transfer_timestamp, last_transaction_hash)
      SELECT 'bnb', $2, $3, token_id, owner, burned, lifecycle, mint_block, mint_timestamp,
        last_transfer_block, last_transfer_timestamp, last_transaction_hash
      FROM jsonb_to_recordset($1::jsonb) AS x(token_id text, owner text, burned boolean,
        lifecycle integer, mint_block bigint, mint_timestamp bigint, last_transfer_block bigint,
        last_transfer_timestamp bigint, last_transaction_hash text)
      ON CONFLICT (collection, token_id) DO UPDATE SET owner=excluded.owner, burned=excluded.burned,
        lifecycle=excluded.lifecycle, mint_block=excluded.mint_block, mint_timestamp=excluded.mint_timestamp,
        last_transfer_block=excluded.last_transfer_block, last_transfer_timestamp=excluded.last_transfer_timestamp,
        last_transaction_hash=excluded.last_transaction_hash`, [jsonRows([...tokens.values()]), definition.chainId, definition.address]);
    if (transfers.length) await database.query(`INSERT INTO ${bnbSchema}.transfer_event
      (id, collection, chain_id, contract_address, token_id, lifecycle, "from", "to", block_number,
        block_timestamp, transaction_hash, transaction_index, log_index)
      SELECT id, collection, chain_id, contract_address, token_id, lifecycle, "from", "to", block_number,
        block_timestamp, transaction_hash, transaction_index, log_index
      FROM jsonb_to_recordset($1::jsonb) AS x(id text, collection text, chain_id integer,
        contract_address text, token_id text, lifecycle integer, "from" text, "to" text,
        block_number bigint, block_timestamp bigint, transaction_hash text,
        transaction_index integer, log_index integer) ON CONFLICT DO NOTHING`, [jsonRows(transfers)]);
    if (roles.length) await database.query(`INSERT INTO ${bnbSchema}.admin_role_event
      (id, collection, chain_id, contract_address, role, account, sender, granted,
        block_number, transaction_hash, log_index)
      SELECT id, collection, chain_id, contract_address, role, account, sender, granted,
        block_number, transaction_hash, log_index
      FROM jsonb_to_recordset($1::jsonb) AS x(id text, collection text, chain_id integer,
        contract_address text, role text, account text, sender text, granted boolean,
        block_number bigint, transaction_hash text, log_index integer) ON CONFLICT DO NOTHING`, [jsonRows(roles)]);
    await database.query(`UPDATE ${bnbSchema}.sync_state SET next_block=$1,
      last_scanned_block=$2, last_scanned_hash=$3,
      caught_up_at=CASE WHEN $4::boolean THEN now() ELSE NULL END,
      last_error=NULL, updated_at=now()
      WHERE singleton`, [(toBlock + 1n).toString(), toBlock.toString(), blockData.get(toBlock.toString())!.hash, caughtUp]);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }

  console.log("BNB range indexed", {
    fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), logs: logs.length,
    transfers: transfers.length, roles: roles.length, durationMs: Date.now() - started
  });
}

async function reconcileToFinalized() {
  await validateCursor();
  const head = await client.getBlockNumber();
  const finalizedTarget = head > BigInt(confirmations) ? head - BigInt(confirmations) : 0n;
  const target = configuredEndBlock !== undefined && configuredEndBlock < finalizedTarget
    ? configuredEndBlock
    : finalizedTarget;
  let state = await syncState();
  while (!stopping && BigInt(state.nextBlock) <= target) {
    const fromBlock = BigInt(state.nextBlock);
    const toBlock = fromBlock + BigInt(maxRange - 1) < target
      ? fromBlock + BigInt(maxRange - 1)
      : target;
    // Publish the final cursor and caught-up marker in one transaction. A
    // separate marker write exposed a millisecond-long false recovery state
    // that catalog snapshots could retain for their full cache lifetime.
    await applyRange(fromBlock, toBlock, toBlock === target);
    state = await syncState();
  }
  if (BigInt(state.nextBlock) > target) {
    await pool.query(`UPDATE ${bnbSchema}.sync_state SET caught_up_at=now(), last_error=NULL,
      updated_at=now() WHERE singleton`);
  }
}

const beginShutdown = createShutdownDeadline();
let writerLock: PoolClient | undefined;
const onWriterLockLost = () => {
  console.error("BNB writer lock connection lost; stopping before another range");
  process.exit(1);
};
process.on("SIGTERM", () => { beginShutdown(0); stopping = true; });
process.on("SIGINT", () => { beginShutdown(0); stopping = true; });

try {
  writerLock = await acquireBnbWriterLock(pool);
  writerLock.on("error", onWriterLockLost);
  writerLock.on("end", onWriterLockLost);
  await reconcileToFinalized();
  let nextPeriodic = Date.now() + reconcileMs;
  while (!stopping) {
    const now = Date.now();
    if (now >= nextPeriodic) {
      nextPeriodic = now + reconcileMs;
      await reconcileToFinalized();
    }
    await sleep(1_000);
  }
} catch (error) {
  beginShutdown(1);
  const message = safeErrorMessage(error);
  if (writerLock) {
    await pool.query(`UPDATE ${bnbSchema}.sync_state SET last_error=$1, updated_at=now() WHERE singleton`, [message.slice(0, 2_000)]).catch(() => undefined);
  }
  console.error("BNB worker failed", message);
  process.exitCode = 1;
} finally {
  beginShutdown(process.exitCode ? 1 : 0);
  if (writerLock) {
    writerLock.off("error", onWriterLockLost);
    writerLock.off("end", onWriterLockLost);
    await releaseBnbWriterLock(writerLock);
  }
  await pool.end();
}
