import type { Pool, PoolClient } from "pg";
import {
  decodeEventLog,
  erc20Abi,
  isAddress,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import {
  ARENA_ENTRY_FEE,
  ARENA_USDC,
  supportedArenaNft,
  type ArenaTransactionAction,
  type ArenaTransactionStatus
} from "@protopals/yunipals-market-core/arena";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";
import { readConfirmedBlock } from "@/confirmations";
import { ArenaIntake, ArenaRequestError } from "./intake";

type Tracked = {
  hash: Hex;
  wallet: Address;
  action: ArenaTransactionAction;
  state: ArenaTransactionStatus["state"];
  result: ArenaTransactionStatus["result"];
  indexed_through_block: string | null;
  created_at: Date;
  tracking_until: Date;
};
const same = (a: unknown, b: unknown) =>
  String(a).toLowerCase() === String(b).toLowerCase();
const decimal = (v: unknown) =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,77}$/.test(v) &&
  BigInt(v) < 2n ** 256n;

export function transactionAction(value: unknown): ArenaTransactionAction {
  const a = value as Record<string, unknown> | null;
  if (!a || typeof a !== "object" || Array.isArray(a))
    throw new ArenaRequestError(400, "Invalid transaction action.");
  if (a.kind === "claim") return { kind: "claim" };
  if (!decimal(a.tournamentId))
    throw new ArenaRequestError(400, "Invalid tournament ID.");
  if (a.kind === "approval")
    return { kind: "approval", tournamentId: a.tournamentId as string };
  if (
    a.kind === "entry" &&
    typeof a.nftChainId === "number" &&
    typeof a.collection === "string" &&
    isAddress(a.collection) &&
    supportedArenaNft(a.nftChainId, a.collection) &&
    decimal(a.tokenId)
  )
    return {
      kind: "entry",
      tournamentId: a.tournamentId as string,
      nftChainId: a.nftChainId,
      collection: a.collection.toLowerCase() as Address,
      tokenId: a.tokenId as string
    };
  throw new ArenaRequestError(400, "Invalid transaction action.");
}

/** Only the background projector uses RPCs. HTTP registration/status are DB reads/writes. */
export class ArenaClientTransactions {
  constructor(
    private readonly service: ArenaIntake,
    private readonly paymentToken: Address = ARENA_USDC
  ) {}

  private async row(hash: Hex) {
    return (
      await this.service.pool.query<Tracked>(
        "SELECT * FROM yunipals_arena.client_transaction WHERE deployment=$1 AND hash=$2",
        [this.service.deployment, hash.toLowerCase()]
      )
    ).rows[0];
  }

  async read(wallet: Address, hash: Hex): Promise<ArenaTransactionStatus> {
    const row = await this.row(hash);
    if (!row || !same(row.wallet, wallet))
      throw new ArenaRequestError(
        404,
        "Transaction tracking was not found for this wallet."
      );
    return {
      hash: row.hash,
      action: row.action,
      state: row.state,
      indexedThroughBlock: row.indexed_through_block,
      result: row.result
    };
  }

  async register(wallet: Address, hash: Hex, action: ArenaTransactionAction) {
    const address = wallet.toLowerCase();
    await transaction(this.service.pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `arena/client-tx/${this.service.deployment}`
      ]);
      const prior = (
        await db.query<Tracked>(
          "SELECT * FROM yunipals_arena.client_transaction WHERE deployment=$1 AND hash=$2",
          [this.service.deployment, hash.toLowerCase()]
        )
      ).rows[0];
      if (prior) {
        if (
          !same(prior.wallet, wallet) ||
          canonicalJson(prior.action) !== canonicalJson(action)
        )
          throw new ArenaRequestError(
            409,
            "This transaction already tracks a different action."
          );
        if (prior.state === "delayed") {
          const active = await db.query(
            `SELECT 1 FROM yunipals_arena.client_transaction WHERE deployment=$1
            AND wallet=$2 AND state IN ('submitted','confirming','indexing') LIMIT 4`,
            [this.service.deployment, address]
          );
          if (active.rowCount! >= 4)
            throw new ArenaRequestError(
              503,
              "Finish checking the other pending transactions first."
            );
          await db.query(
            `UPDATE yunipals_arena.client_transaction SET state='submitted',next_check_at=now(),
            tracking_until=now()+interval '10 minutes' WHERE deployment=$1 AND hash=$2`,
            [this.service.deployment, hash.toLowerCase()]
          );
        }
        return;
      }
      // An authenticated arbitrary hash must not cause unlimited upstream reads.
      const limits = (
        await db.query<{
          pending: string;
          wallet_pending: string;
          recent: string;
        }>(
          `SELECT count(*) FILTER(WHERE state IN ('submitted','confirming','indexing'))::text AS pending,
          count(*) FILTER(WHERE wallet=$2 AND state IN ('submitted','confirming','indexing'))::text AS wallet_pending,
          count(*) FILTER(WHERE wallet=$2 AND created_at>now()-interval '1 hour')::text AS recent
         FROM yunipals_arena.client_transaction WHERE deployment=$1`,
          [this.service.deployment, address]
        )
      ).rows[0]!;
      if (
        +limits.pending >= 64 ||
        +limits.wallet_pending >= 4 ||
        +limits.recent >= 20
      )
        throw new ArenaRequestError(
          503,
          "Transaction tracking is busy. Your transaction is retained; check again shortly."
        );
      if (action.kind === "claim") {
        const balance = (
          await db.query<{ amount: string }>(
            "SELECT amount FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
            [this.service.deployment, address]
          )
        ).rows[0];
        const recorded = await db.query(
          "SELECT 1 FROM yunipals_arena.chain_event WHERE deployment=$1 AND transaction_hash=$2 AND event_name='Claimed' AND lower(args->>'player')=$3",
          [this.service.deployment, hash.toLowerCase(), address]
        );
        if (!balance || (BigInt(balance.amount) === 0n && !recorded.rowCount))
          throw new ArenaRequestError(
            409,
            "There is no indexed claim balance for this wallet."
          );
      } else {
        const permit = await db.query(
          `SELECT 1 FROM yunipals_arena.admission WHERE deployment=$1 AND tournament_id=$2 AND wallet=$3
          ${action.kind === "entry" ? "AND nft_chain_id=$4 AND collection=$5 AND token_id=$6" : ""} LIMIT 1`,
          action.kind === "entry"
            ? [
                this.service.deployment,
                action.tournamentId,
                address,
                action.nftChainId,
                action.collection,
                action.tokenId
              ]
            : [this.service.deployment, action.tournamentId, address]
        );
        if (!permit.rowCount)
          throw new ArenaRequestError(
            409,
            "A verified entry permit is required before tracking this transaction."
          );
      }
      await db.query(
        "INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action) VALUES($1,$2,$3,$4)",
        [this.service.deployment, hash.toLowerCase(), address, action]
      );
    });
    return this.read(wallet, hash);
  }

  async reconcileBatch(client: PublicClient) {
    const rows = (
      await this.service.pool.query<Tracked>(
        `SELECT * FROM yunipals_arena.client_transaction
      WHERE deployment=$1 AND state IN ('submitted','confirming','indexing') AND next_check_at<=now()
      ORDER BY next_check_at LIMIT 8`,
        [this.service.deployment]
      )
    ).rows;
    if (!rows.length) return;
    const finalized = await readConfirmedBlock(client, 8453);
    for (const row of rows) {
      // Persist backoff before network I/O, including failed/ambiguous reads.
      await this.service.pool.query(
        "UPDATE yunipals_arena.client_transaction SET next_check_at=now()+interval '30 seconds' WHERE deployment=$1 AND hash=$2",
        [this.service.deployment, row.hash]
      );
      if (Date.now() > row.tracking_until.getTime()) {
        await this.save(row, "delayed");
        continue;
      }
      try {
        await this.reconcile(row, client, finalized.number);
      } catch (error) {
        if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
      }
    }
  }

  private async save(
    row: Tracked,
    state: Tracked["state"],
    result: Tracked["result"] = null,
    cursor: string | null = null,
    db: Pick<Pool | PoolClient, "query"> = this.service.pool
  ) {
    await db.query(
      `UPDATE yunipals_arena.client_transaction SET state=$3,result=$4,indexed_through_block=$5,checked_at=now()
      WHERE deployment=$1 AND hash=$2`,
      [this.service.deployment, row.hash, state, result, cursor]
    );
  }

  private evidence(
    row: Tracked,
    receipt: TransactionReceipt
  ): NonNullable<Tracked["result"]> | null {
    for (const log of receipt.logs) {
      if (
        log.removed ||
        log.logIndex === null ||
        !Number.isInteger(log.logIndex) ||
        log.logIndex < 0
      )
        continue;
      try {
        if (row.action.kind === "approval") {
          if (!same(log.address, this.paymentToken)) continue;
          const decoded = decodeEventLog({
            abi: erc20Abi,
            data: log.data,
            topics: log.topics,
            strict: true
          });
          if (
            decoded.eventName === "Approval" &&
            same(decoded.args.owner, row.wallet) &&
            same(decoded.args.spender, this.service.contract) &&
            decoded.args.value >= ARENA_ENTRY_FEE
          )
            return {
              event: "Approval",
              amount: decoded.args.value.toString(),
              blockNumber: receipt.blockNumber.toString(),
              logIndex: log.logIndex!
            };
        } else {
          if (!same(log.address, this.service.contract)) continue;
          const decoded = decodeEventLog({
            abi: arenaAbi,
            data: log.data,
            topics: log.topics,
            strict: true
          });
          if (
            row.action.kind === "entry" &&
            decoded.eventName === "Entered" &&
            same(decoded.args.player, row.wallet) &&
            decoded.args.id.toString() === row.action.tournamentId &&
            Number(decoded.args.nftChainId) === row.action.nftChainId &&
            same(decoded.args.collection, row.action.collection) &&
            decoded.args.tokenId.toString() === row.action.tokenId
          )
            return {
              event: "Entered",
              seat: decoded.args.seat,
              blockNumber: receipt.blockNumber.toString(),
              logIndex: log.logIndex!
            };
          if (
            row.action.kind === "claim" &&
            decoded.eventName === "Claimed" &&
            same(decoded.args.player, row.wallet) &&
            same(decoded.args.recipient, row.wallet)
          )
            return {
              event: "Claimed",
              amount: decoded.args.amount.toString(),
              blockNumber: receipt.blockNumber.toString(),
              logIndex: log.logIndex!
            };
        }
      } catch {
        /* Other contracts/events never satisfy a tracked action. */
      }
    }
    return null;
  }

  private async reconcile(
    row: Tracked,
    client: PublicClient,
    finalized: bigint
  ) {
    const receipt = await client.getTransactionReceipt({ hash: row.hash });
    if (!same(receipt.transactionHash, row.hash))
      throw new Error("Transaction receipt identity mismatch.");
    if (receipt.blockNumber > finalized) {
      await this.save(row, "confirming");
      return;
    }
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) {
      await this.save(row, "confirming");
      return;
    }
    const result = this.evidence(row, receipt);
    if (receipt.status !== "success" || !result) {
      await this.save(row, "failed");
      return;
    }
    // Read journal and cursor together: projection commits them in one transaction.
    await transaction(this.service.pool, async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const projection = (
        await db.query<{ cursor: string | null; halted: boolean }>(
          "SELECT cursor,halted FROM yunipals_arena.deployment WHERE id=$1",
          [this.service.deployment]
        )
      ).rows[0]!;
      if (
        projection.halted ||
        projection.cursor === null ||
        BigInt(projection.cursor) < receipt.blockNumber
      ) {
        await this.save(row, "indexing", result, null, db);
        return;
      }
      if (row.action.kind !== "approval") {
        const indexed = await db.query(
          `SELECT 1 FROM yunipals_arena.chain_event WHERE deployment=$1 AND transaction_hash=$2
          AND log_index=$3 AND event_name=$4 AND block_hash=$5`,
          [
            this.service.deployment,
            row.hash,
            result.logIndex,
            result.event,
            receipt.blockHash
          ]
        );
        if (!indexed.rowCount) {
          await this.save(row, "indexing", result, null, db);
          return;
        }
      }
      if (row.action.kind === "entry") {
        const view = await db.query(
          `SELECT 1 FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE (s->>'seat')::int=$3
            AND lower(s->>'player')=$4 AND (s->>'nftChainId')::int=$5 AND lower(s->>'collection')=$6 AND s->>'tokenId'=$7)`,
          [
            this.service.deployment,
            row.action.tournamentId,
            result.seat,
            row.wallet.toLowerCase(),
            row.action.nftChainId,
            row.action.collection.toLowerCase(),
            row.action.tokenId
          ]
        );
        if (!view.rowCount) {
          await this.save(row, "indexing", result, null, db);
          return;
        }
      }
      await this.save(row, "indexed", result, projection.cursor, db);
    });
  }
}
