import type { PoolClient } from "pg";
import {
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import type {
  ArenaTransactionAction,
  ArenaTransactionStatus
} from "@protopals/yunipals-market-core/arena";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { arenaClientReceiptEvidence } from "./clientReceiptEvidence";
import { json } from "./projection";
import type { NativeArenaSource } from "./nativeSource";

type Tracked = {
  hash: Hex;
  wallet: Address;
  action: ArenaTransactionAction;
  state: ArenaTransactionStatus["state"];
  result: ArenaTransactionStatus["result"];
  reader_mode: "legacy" | "unified";
  tournament_id: string | null;
  incarnation: Hex | null;
  indexed_through_block: string | null;
  receipt_block_number: string | null;
  receipt_block_hash: Hex | null;
  receipt_finalized: boolean;
  proof_event_id: string | null;
  tracking_until: Date;
};
type Proof = Awaited<ReturnType<NativeArenaSource["transaction"]>>;
type Queryable = Pick<PoolClient, "query">;
const same = (a: unknown, b: unknown) =>
  String(a).toLowerCase() === String(b).toLowerCase();
const semantics = (action: ArenaTransactionAction) => {
  if (action.kind === "claim") return action;
  const { incarnation: _origin, ...body } = action;
  return body;
};

/** Tracks user-owned hashes. No signer, broadcasts, public projection or log
 * cursor. Receipt point reads are bounded; HTTP uses only native evidence. */
export class NativeArenaClientTransactions {
  constructor(
    readonly service: ArenaIntake,
    readonly paymentToken: Address
  ) {
    if (!service.nativeSource?.transaction || !service.nativeSource.credit)
      throw new Error(
        "Native client tracking requires transaction and credit readers."
      );
  }
  private async row(hash: Hex) {
    return (
      await this.service.pool.query<Tracked>(
        "SELECT * FROM yunipals_arena.client_transaction WHERE deployment=$1 AND hash=$2",
        [this.service.deployment, hash.toLowerCase()]
      )
    ).rows[0];
  }
  private proof(row: Tracked, receipt?: TransactionReceipt) {
    return this.service.nativeSource!.transaction!(row.hash, {
      // Approval remains usable even if the lobby it was requested for changes.
      ...(row.action.kind === "entry"
        ? { tournamentId: row.action.tournamentId }
        : {}),
      ...(receipt
        ? { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash }
        : row.receipt_block_number !== null && row.receipt_block_hash
          ? {
              blockNumber: BigInt(row.receipt_block_number),
              blockHash: row.receipt_block_hash
            }
          : {})
    });
  }
  private changed(row: Tracked, proof: Proof) {
    return (
      proof.inclusion === "changed" ||
      (proof.inclusion !== "not_indexed" &&
        row.action.kind === "entry" &&
        proof.origin?.incarnation !== row.incarnation)
    );
  }
  private event(
    row: Tracked,
    result: NonNullable<Tracked["result"]>,
    proof: Proof
  ) {
    return proof.events.find(
      (event) =>
        event.name === result.event &&
        event.logIndex === result.logIndex &&
        event.blockNumber === result.blockNumber &&
        event.blockHash === row.receipt_block_hash &&
        (row.action.kind === "entry"
          ? String(event.args.id) === row.action.tournamentId &&
            same(event.args.player, row.wallet) &&
            Number(event.args.seat) === result.seat &&
            Number(event.args.nftChainId) === row.action.nftChainId &&
            same(event.args.collection, row.action.collection) &&
            String(event.args.tokenId) === row.action.tokenId
          : row.action.kind === "claim" &&
            same(event.args.player, row.wallet) &&
            same(event.args.recipient, row.wallet) &&
            String(event.args.amount) === result.amount)
    );
  }
  private status(row: Tracked): ArenaTransactionStatus {
    return {
      hash: row.hash,
      action: row.action,
      state: row.state,
      result: row.result,
      indexedThroughBlock: row.indexed_through_block,
      finalized: row.receipt_finalized,
      receiptBlockHash: row.receipt_block_hash,
      trackingExpiresAt: row.tracking_until.toISOString()
    };
  }
  private async haltFinalized(): Promise<never> {
    await this.service.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true,halt_reason='native_client_finalized_receipt_changed' WHERE id=$1",
      [this.service.deployment]
    );
    throw new ArenaRequestError(
      503,
      "Arena transaction evidence needs reconciliation."
    );
  }
  async read(wallet: Address, hash: Hex): Promise<ArenaTransactionStatus> {
    await this.service.ready();
    const row = await this.row(hash);
    if (!row || !same(row.wallet, wallet))
      throw new ArenaRequestError(
        404,
        "Transaction tracking was not found for this wallet."
      );
    if (row.reader_mode !== "unified")
      return this.status({
        ...row,
        state: "delayed",
        result: null,
        indexed_through_block: null,
        receipt_finalized: false
      });
    const proof = await this.proof(row);
    if (this.changed(row, proof)) {
      if (row.receipt_finalized) return this.haltFinalized();
      return this.status({
        ...row,
        state: row.state === "delayed" ? "delayed" : "reorged",
        result: null,
        indexed_through_block: null
      });
    }
    // Fresh source proof is checked even after the worker reported success.
    if (row.state === "indexed" || row.state === "failed") {
      const covered =
        proof.inclusion === "canonical" ||
        (proof.inclusion === "expired" && row.receipt_finalized);
      const effect =
        row.state === "failed" ||
        (row.result &&
          (row.action.kind === "approval" ||
            this.event(row, row.result, proof)));
      if (!covered || !effect)
        return this.status({
          ...row,
          state: "indexing",
          result: null,
          indexed_through_block: null
        });
    }
    return this.status(row);
  }
  async register(wallet: Address, hash: Hex, action: ArenaTransactionAction) {
    await this.service.ready();
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
      if (
        prior &&
        (!same(prior.wallet, wallet) ||
          canonicalJson(semantics(prior.action)) !==
            canonicalJson(semantics(action)) ||
          (action.kind !== "claim" &&
            action.incarnation &&
            action.incarnation !== prior.incarnation))
      )
        throw new ArenaRequestError(
          409,
          "This transaction already tracks a different action."
        );
      if (prior && prior.state !== "delayed") return;
      if (prior?.reader_mode === "legacy")
        throw new ArenaRequestError(
          503,
          "This retained transaction needs explicit source adoption."
        );
      const limits = (
        await db.query<{
          pending: string;
          wallet_pending: string;
          recent: string;
        }>(
          `SELECT count(*) FILTER(WHERE state IN('submitted','confirming','indexing','reorged'))::text AS pending,
        count(*) FILTER(WHERE wallet=$2 AND state IN('submitted','confirming','indexing','reorged'))::text AS wallet_pending,
        count(*) FILTER(WHERE wallet=$2 AND created_at>now()-interval '1 hour')::text AS recent
        FROM yunipals_arena.client_transaction WHERE deployment=$1`,
          [this.service.deployment, address]
        )
      ).rows[0]!;
      if (
        +limits.pending >= 64 ||
        +limits.wallet_pending >= 4 ||
        (!prior && +limits.recent >= 20)
      )
        throw new ArenaRequestError(
          503,
          "Transaction tracking is busy. Your transaction is retained; check again shortly."
        );
      if (prior) {
        await db.query(
          `UPDATE yunipals_arena.client_transaction SET state='submitted',next_check_at=now(),
          tracking_until=now()+interval '2 hours' WHERE deployment=$1 AND hash=$2`,
          [this.service.deployment, hash.toLowerCase()]
        );
        return;
      }
      let incarnation: string | null = null;
      if (action.kind === "claim") {
        const credit = await this.service.nativeSource!.credit!(address);
        if (BigInt(credit.amount) === 0n) {
          const proof = await this.service.nativeSource!.transaction!(
            hash.toLowerCase()
          );
          if (
            !proof.events.some(
              (event) =>
                event.name === "Claimed" &&
                same(event.args.player, address) &&
                same(event.args.recipient, address)
            )
          )
            throw new ArenaRequestError(
              409,
              "There is no indexed claim balance for this wallet."
            );
        }
      } else {
        const origins = (
          await db.query<{ incarnation: string }>(
            `SELECT DISTINCT a.incarnation FROM yunipals_arena.admission a
          WHERE deployment=$1 AND tournament_id=$2 AND wallet=$3 AND incarnation~'^0x[0-9a-f]{64}$'
          AND ($4::text IS NULL OR incarnation=$4)
          ${action.kind === "entry" ? "AND nft_chain_id=$5 AND collection=$6 AND token_id=$7" : ""} LIMIT 2`,
            [
              this.service.deployment,
              action.tournamentId,
              address,
              action.incarnation ?? null,
              ...(action.kind === "entry"
                ? [
                    action.nftChainId,
                    action.collection.toLowerCase(),
                    action.tokenId
                  ]
                : [])
            ]
          )
        ).rows;
        if (origins.length !== 1)
          throw new ArenaRequestError(
            409,
            "A verified permit for one specific tournament opening is required."
          );
        incarnation = origins[0]!.incarnation;
        action = { ...action, incarnation: incarnation as Hex };
      }
      await db.query(
        `INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action,reader_mode,tournament_id,incarnation)
        VALUES($1,$2,$3,$4,'unified',$5,$6)`,
        [
          this.service.deployment,
          hash.toLowerCase(),
          address,
          action,
          action.kind === "claim" ? null : action.tournamentId,
          incarnation
        ]
      );
    });
    return this.read(wallet, hash);
  }
  private async save(
    row: Tracked,
    state: Tracked["state"],
    result: Tracked["result"] = null,
    proof?: Proof,
    finalized = false,
    db: Queryable = this.service.pool
  ) {
    await db.query(
      `UPDATE yunipals_arena.client_transaction SET state=$3,result=$4,indexed_through_block=$5,
      receipt_block_number=$6,receipt_block_hash=$7,receipt_finalized=$8,proof_event_id=$9,verified_release_id=$10,checked_at=now()
      WHERE deployment=$1 AND hash=$2`,
      [
        this.service.deployment,
        row.hash,
        state,
        result,
        state === "indexed" ? (proof?.indexedThroughBlock ?? null) : null,
        row.receipt_block_number,
        row.receipt_block_hash,
        finalized,
        result && proof ? (this.event(row, result, proof)?.id ?? null) : null,
        proof?.releaseId ?? null
      ]
    );
  }
  async reconcileBatch(client: PublicClient) {
    await this.service.ready();
    const db = await this.service.pool.connect();
    const lock = `arena/native-client-tracking/${this.service.deployment}`;
    let locked = false,
      discard = false;
    try {
      locked = (
        await db.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
          [lock]
        )
      ).rows[0]!.acquired;
      if (!locked) return;
      const rows = (
        await db.query<Tracked>(
          `SELECT * FROM yunipals_arena.client_transaction
        WHERE deployment=$1 AND reader_mode='unified' AND NOT receipt_finalized AND state<>'delayed' AND next_check_at<=now()
        ORDER BY (state IN('indexed','failed')),next_check_at LIMIT 8`,
          [this.service.deployment]
        )
      ).rows;
      if (!rows.length) return;
      if ((await client.getChainId()) !== 8453)
        throw new Error("Native client tracking requires Base.");
      for (const row of rows) {
        await db.query(
          `UPDATE yunipals_arena.client_transaction SET next_check_at=now()+interval '30 seconds'
          WHERE deployment=$1 AND hash=$2`,
          [this.service.deployment, row.hash]
        );
        try {
          await this.reconcile(row, client);
        } catch (error) {
          if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
          await this.lost(row);
        }
      }
    } finally {
      if (locked)
        try {
          await db.query("SELECT pg_advisory_unlock(hashtext($1))", [lock]);
        } catch {
          discard = true;
        }
      db.release(discard);
    }
  }
  private async lost(row: Tracked) {
    if (row.receipt_finalized) return this.haltFinalized();
    await this.service.pool.query(
      `UPDATE yunipals_arena.client_receipt_history SET canonical=false,checked_at=now()
      WHERE deployment=$1 AND transaction_hash=$2`,
      [this.service.deployment, row.hash]
    );
    await this.save(
      row,
      Date.now() > row.tracking_until.getTime()
        ? "delayed"
        : row.receipt_block_hash
          ? "reorged"
          : "confirming"
    );
  }
  private async reconcile(row: Tracked, client: PublicClient) {
    // Check the source before spending a bounded receipt/header read.
    const saved = await this.proof(row);
    if (
      (row.state === "indexed" || row.state === "failed") &&
      row.receipt_block_number !== null &&
      saved.inclusion === "canonical" &&
      !this.changed(row, saved) &&
      (row.state === "failed" ||
        (row.result &&
          (row.action.kind === "approval" ||
            this.event(row, row.result, saved))))
    ) {
      // Native ingestion already audits this canonical inclusion. Retire the
      // receipt when the shared observer reaches actual finality, without
      // repeatedly downloading a successful receipt on every application tick.
      if (
        saved.finalizedThroughBlock !== null &&
        BigInt(saved.finalizedThroughBlock) >= BigInt(row.receipt_block_number)
      ) {
        const current = await this.proof(row);
        if (
          current.inclusion !== "canonical" ||
          this.changed(row, current) ||
          current.finalizedThroughBlock === null ||
          BigInt(current.finalizedThroughBlock) <
            BigInt(row.receipt_block_number)
        )
          throw new Error("Native client finality evidence changed.");
        await transaction(this.service.pool, async (db) => {
          await this.service.ready(db);
          await db.query(
            `UPDATE yunipals_arena.client_receipt_history SET finalized=true,checked_at=now()
            WHERE deployment=$1 AND transaction_hash=$2 AND block_hash=$3 AND canonical`,
            [this.service.deployment, row.hash, row.receipt_block_hash]
          );
          await this.save(row, row.state, row.result, current, true, db);
        });
      }
      return;
    }
    const receipt = await client.getTransactionReceipt({ hash: row.hash });
    if (
      !same(receipt.transactionHash, row.hash) ||
      receipt.blockNumber < 0n ||
      !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash) ||
      !["success", "reverted"].includes(receipt.status)
    )
      throw new Error("Native client receipt identity is invalid.");
    if (
      receipt.logs.length > 10000 ||
      !Number.isSafeInteger(receipt.transactionIndex) ||
      receipt.transactionIndex < 0 ||
      receipt.logs.some(
        (log) =>
          log.removed ||
          log.blockNumber !== receipt.blockNumber ||
          !same(log.blockHash, receipt.blockHash) ||
          !same(log.transactionHash, receipt.transactionHash) ||
          log.transactionIndex !== receipt.transactionIndex ||
          !Number.isSafeInteger(log.logIndex) ||
          log.logIndex < 0
      )
    )
      throw new Error("Native client receipt log identity is invalid.");
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (
      !same(block.hash, receipt.blockHash) ||
      block.number !== receipt.blockNumber
    )
      return this.lost(row);
    const proof = await this.proof(row, receipt);
    row = {
      ...row,
      receipt_block_number: String(receipt.blockNumber),
      receipt_block_hash: receipt.blockHash.toLowerCase() as Hex
    };
    if (proof.inclusion === "changed") return this.lost(row);
    if (proof.inclusion === "not_indexed") return this.save(row, "indexing");
    // The canonical point header can revalidate old approvals outside the
    // witness window; Ponder must still cover their complete receipt block.
    if (BigInt(proof.indexedThroughBlock) < receipt.blockNumber)
      return this.save(row, "indexing");
    const result =
      receipt.status === "success"
        ? arenaClientReceiptEvidence(
            row,
            receipt,
            this.service.contract,
            this.paymentToken,
            true,
            this.service.economics.entry
          )
        : null;
    const changed = this.changed(row, proof);
    const event = result ? this.event(row, result, proof) : null;
    const state = changed
      ? Date.now() > row.tracking_until.getTime()
        ? "delayed"
        : "reorged"
      : receipt.status === "reverted" || !result
        ? "failed"
        : row.action.kind === "approval" || event
          ? "indexed"
          : "indexing";
    let finalized =
      (state === "indexed" || state === "failed") &&
      proof.finalizedThroughBlock !== null &&
      BigInt(proof.finalizedThroughBlock) >= receipt.blockNumber;
    // Recheck both chain and source immediately before persisting acceptance.
    const current = await this.proof(row);
    if (
      current.releaseId !== proof.releaseId ||
      this.changed(row, current) !== changed ||
      current.inclusion === "changed" ||
      current.inclusion === "not_indexed" ||
      (event && !this.event(row, result!, current)) ||
      !same(
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash,
        receipt.blockHash
      )
    )
      throw new Error("Native client evidence changed during verification.");
    finalized &&=
      current.finalizedThroughBlock !== null &&
      BigInt(current.finalizedThroughBlock) >= receipt.blockNumber;
    await transaction(this.service.pool, async (db) => {
      await this.service.ready(db);
      await db.query(
        `UPDATE yunipals_arena.client_receipt_history SET canonical=false,checked_at=now()
        WHERE deployment=$1 AND transaction_hash=$2 AND block_hash<>$3`,
        [this.service.deployment, row.hash, row.receipt_block_hash]
      );
      const body: unknown = JSON.parse(json(receipt));
      const prior = (
        await db.query<{ receipt: unknown }>(
          `SELECT receipt FROM yunipals_arena.client_receipt_history
        WHERE deployment=$1 AND transaction_hash=$2 AND block_hash=$3`,
          [this.service.deployment, row.hash, row.receipt_block_hash]
        )
      ).rows[0];
      if (prior && canonicalJson(prior.receipt) !== canonicalJson(body))
        throw new Error(
          "Native client receipt payload changed for the same inclusion."
        );
      await db.query(
        `INSERT INTO yunipals_arena.client_receipt_history(deployment,transaction_hash,block_hash,block_number,receipt,canonical,finalized)
        VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(deployment,transaction_hash,block_hash)
        DO UPDATE SET canonical=true,finalized=EXCLUDED.finalized,checked_at=now()`,
        [
          this.service.deployment,
          row.hash,
          row.receipt_block_hash,
          row.receipt_block_number,
          body,
          finalized
        ]
      );
      await this.save(
        row,
        state,
        state === "indexed" ? result : null,
        current,
        finalized,
        db
      );
    });
  }
}
