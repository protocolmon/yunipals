import type { PoolClient } from "pg";
import { withArenaSourceLease } from "./sourceSelection";
import {
  decodeEventLog,
  decodeFunctionData,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionSerialized,
  type TransactionReceipt
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";
import { ArenaIntake, type ArenaTournamentContext } from "./intake";
import { verifyNativeArenaAction } from "./nativeAction";
import { json } from "./projection";

export type NativeIntentPurpose =
  | "open-lobby"
  | "finalize-island"
  | "freeze-input"
  | "expire"
  | "release-payouts"
  | "settle";
export type NativeIntent = {
  action_id: string;
  deployment: string;
  purpose: NativeIntentPurpose;
  tournament_id: string;
  incarnation: string | null;
  signer: Address;
  nonce: string;
  raw_transaction: Hex;
  tx_hash: Hex;
  state: string;
  receipt: unknown;
  receipt_finalized: boolean;
};
export type NativeActionHead = { number: bigint; hash: Hex; timestamp: bigint };
export type NativeCallBuilder = (
  context: ArenaTournamentContext | null,
  head: NativeActionHead
) => Promise<Hex>;
const functions = {
  "open-lobby": ["openTournament"],
  "finalize-island": ["finalizeIsland"],
  "freeze-input": ["freezeInput", "freezeInputWithFallback"],
  expire: ["expire"],
  "release-payouts": ["releasePayouts"],
  settle: ["settle"]
} satisfies Record<NativeIntentPurpose, string[]>;
const eventNames = {
  "open-lobby": "TournamentOpened",
  "finalize-island": "IslandSelected",
  "freeze-input": "InputFrozen",
  expire: "TournamentExpired",
  "release-payouts": "PayoutsReleased",
  settle: "ResultSettled"
} as const;

/** Native execution keeps signed bytes/nonce history outside Ponder. Latest
 * receipt acceptance is separate from background finality observation.
 */
export class NativeArenaTransactions {
  constructor(
    readonly service: ArenaIntake,
    readonly client: PublicClient,
    readonly account: LocalAccount,
    readonly maxFee: bigint
  ) {
    if (!service.nativeSource || maxFee <= 0n || maxFee > 100_000_000_000_000n)
      throw new Error("Invalid native transaction configuration.");
  }
  private async head(): Promise<NativeActionHead> {
    if ((await this.client.getChainId()) !== 8453)
      throw new Error("Native Arena transactions require Base.");
    const head = await this.client.getBlock({ blockTag: "latest" });
    if (
      !head.hash ||
      Math.abs(Number(head.timestamp) * 1000 - Date.now()) > 120000
    )
      throw new Error("Native Arena head is unavailable.");
    return head;
  }
  private async context(id: string, incarnation?: string | null) {
    if (incarnation === null) {
      await this.service.ready();
      return null;
    }
    return this.service.tournamentContext(
      id,
      this.service.pool,
      false,
      incarnation
    );
  }
  async saved(
    purpose: NativeIntentPurpose,
    id: string,
    incarnation: string | null,
    db: Pick<PoolClient, "query"> = this.service.pool
  ) {
    return (
      await db.query<NativeIntent>(
        `SELECT * FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND purpose=$2 AND tournament_id=$3 AND incarnation IS NOT DISTINCT FROM $4`,
        [this.service.deployment, purpose, id, incarnation]
      )
    ).rows[0];
  }
  async prepare(
    purpose: NativeIntentPurpose,
    id: string,
    build: NativeCallBuilder,
    expectedIncarnation?: string
  ) {
    return withArenaSourceLease(this.service, () =>
      this.prepareSelected(purpose, id, build, expectedIncarnation)
    );
  }
  private async prepareSelected(
    purpose: NativeIntentPurpose,
    id: string,
    build: NativeCallBuilder,
    expectedIncarnation?: string
  ) {
    if (!/^[1-9][0-9]{0,77}$/.test(id) || BigInt(id) >= 2n ** 256n)
      throw new Error("Invalid native transaction tournament id.");
    await this.service.ready();
    const before =
      purpose === "open-lobby"
        ? null
        : await this.context(id, expectedIncarnation);
    const incarnation = before?.incarnation ?? null;
    const db = await this.service.pool.connect();
    let locked = false,
      discard = false;
    const lock = `arena/nonce/8453/${this.account.address.toLowerCase()}`;
    try {
      // A session lock serializes signers without holding a SQL transaction
      // during point RPCs, simulation or signing. Legacy signers use this key too.
      locked = (
        await db.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
          [lock]
        )
      ).rows[0]!.acquired;
      if (!locked) throw new Error("Native Arena signer is busy.");
      const prior = await this.saved(purpose, id, incarnation, db);
      if (prior) return prior;
      if (
        (
          await db.query(
            `SELECT 1 FROM yunipals_arena.transaction_intent WHERE lower(signer)=lower($1)
        AND state NOT IN ('confirmed','reverted') LIMIT 1`,
            [this.account.address]
          )
        ).rowCount
      )
        throw new Error(
          "Reconcile the signer's saved transaction before signing another."
        );
      if (before)
        await verifyNativeArenaAction(this.client, before.observation!);
      const head = await this.head(),
        data = await build(before, head);
      const gas = await this.client.estimateGas({
        account: this.account.address,
        to: this.service.contract,
        data,
        value: 0n
      });
      const gasLimit = (gas * 125n) / 100n;
      const fees = await this.client.estimateFeesPerGas({
        type: "eip1559",
        chain: undefined
      });
      if (gasLimit * fees.maxFeePerGas > this.maxFee)
        throw new Error("Native Arena transaction exceeds its fee cap.");
      const [nonce, pending] = await Promise.all([
        this.client.getTransactionCount({
          address: this.account.address,
          blockTag: "latest"
        }),
        this.client.getTransactionCount({
          address: this.account.address,
          blockTag: "pending"
        })
      ]);
      if (
        nonce !== pending ||
        (
          await db.query(
            "SELECT 1 FROM yunipals_arena.transaction_intent WHERE lower(signer)=lower($1) AND nonce=$2",
            [this.account.address, nonce]
          )
        ).rowCount
      )
        throw new Error("Native Arena signer nonce needs reconciliation.");
      const raw = await this.account.signTransaction({
        type: "eip1559",
        chainId: 8453,
        nonce,
        to: this.service.contract,
        data,
        value: 0n,
        gas: gasLimit,
        ...fees
      });
      if (
        (await this.client.getBlock({ blockNumber: head.number })).hash !==
        head.hash
      )
        throw new Error("Native Arena head changed during signing.");
      await db.query("BEGIN");
      try {
        await this.service.ready(db);
        if (before) {
          const current = await this.service.tournamentContext(
            id,
            db,
            true,
            before.incarnation
          );
          if (
            canonicalJson(current.state) !== canonicalJson(before.state) ||
            current.observation!.tournament.last.id !==
              before.observation!.tournament.last.id ||
            current.observation!.tournament.last.blockHash !==
              before.observation!.tournament.last.blockHash
          )
            throw new Error("Native Arena state changed during signing.");
        }
        const intent = (
          await db.query<NativeIntent>(
            `INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash,incarnation)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              this.service.deployment,
              purpose,
              id,
              this.account.address.toLowerCase(),
              nonce,
              raw,
              keccak256(raw),
              incarnation
            ]
          )
        ).rows[0]!;
        await this.validate(intent);
        await db.query("COMMIT");
        return intent;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
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
  private async validate(intent: NativeIntent) {
    const decoded = parseTransaction(intent.raw_transaction);
    const call = decodeFunctionData({
      abi: arenaAbi,
      data: decoded.data ?? "0x"
    });
    if (
      intent.deployment !== this.service.deployment ||
      decoded.chainId !== 8453 ||
      decoded.to?.toLowerCase() !== this.service.contract.toLowerCase() ||
      (decoded.value ?? 0n) !== 0n ||
      String(decoded.nonce) !== String(intent.nonce) ||
      keccak256(intent.raw_transaction) !== intent.tx_hash ||
      intent.signer.toLowerCase() !== this.account.address.toLowerCase() ||
      (
        await recoverTransactionAddress({
          serializedTransaction: intent.raw_transaction as TransactionSerialized
        })
      ).toLowerCase() !== intent.signer.toLowerCase() ||
      !(functions[intent.purpose] as string[]).includes(call.functionName) ||
      (intent.purpose === "open-lobby"
        ? (call.args?.length ?? 0) !== 0
        : call.args?.[0] !== BigInt(intent.tournament_id))
    )
      throw new Error("Saved native Arena transaction is inconsistent.");
    return { decoded, call };
  }
  private async state(
    intent: NativeIntent,
    state: string,
    db: Pick<PoolClient, "query"> = this.service.pool
  ) {
    await db.query(
      "UPDATE yunipals_arena.transaction_intent SET state=$2,checked_at=now(),receipt_finalized=false WHERE action_id=$1",
      [intent.action_id, state]
    );
    return { ...intent, state, receipt_finalized: false };
  }
  private effect(intent: NativeIntent, receipt: TransactionReceipt) {
    const call = decodeFunctionData({
      abi: arenaAbi,
      data: parseTransaction(intent.raw_transaction).data ?? "0x"
    });
    for (const log of receipt.logs) {
      if (
        log.removed ||
        !Number.isSafeInteger(log.logIndex) ||
        log.logIndex < 0 ||
        log.blockNumber !== receipt.blockNumber ||
        log.blockHash !== receipt.blockHash ||
        log.transactionHash?.toLowerCase() !==
          receipt.transactionHash.toLowerCase() ||
        log.transactionIndex !== receipt.transactionIndex ||
        log.address.toLowerCase() !== this.service.contract.toLowerCase()
      )
        continue;
      try {
        const event = decodeEventLog({
          abi: arenaAbi,
          topics: log.topics,
          data: log.data,
          strict: true
        });
        if (
          event.eventName !== eventNames[intent.purpose] ||
          !("id" in event.args) ||
          String(event.args.id) !== intent.tournament_id
        )
          continue;
        if (
          intent.purpose === "settle" &&
          ("resultHash" in event.args ? event.args.resultHash : undefined) !==
            call.args?.[1]
        )
          continue;
        if (
          intent.purpose === "settle" &&
          event.eventName === "ResultSettled" &&
          (event.args.semifinalOneWinner !== call.args?.[2] ||
            event.args.semifinalTwoWinner !== call.args?.[3] ||
            event.args.champion !== call.args?.[4])
        )
          continue;
        if (
          intent.purpose === "freeze-input" &&
          ("inputHash" in event.args ? event.args.inputHash : undefined) !==
            call.args?.[1]
        )
          continue;
        if (
          intent.purpose === "freeze-input" &&
          event.eventName === "InputFrozen" &&
          canonicalJson(event.args.strategyCommitments) !==
            canonicalJson(call.args?.[2])
        )
          continue;
        if (
          intent.purpose === "release-payouts" &&
          event.eventName === "PayoutsReleased" &&
          event.args.videoHash !== call.args?.[1]
        )
          continue;
        return true;
      } catch {
        /* Unrelated logs cannot establish the saved effect. */
      }
    }
    return false;
  }
  async advance(intent: NativeIntent, build: NativeCallBuilder) {
    return withArenaSourceLease(this.service, () =>
      this.advanceSelected(intent, build)
    );
  }
  private async advanceSelected(
    intent: NativeIntent,
    build: NativeCallBuilder
  ) {
    const db = await this.service.pool.connect();
    let locked = false,
      discard = false;
    const lock = `arena/nonce/8453/${this.account.address.toLowerCase()}`;
    try {
      locked = (
        await db.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
          [lock]
        )
      ).rows[0]!.acquired;
      if (!locked) throw new Error("Native Arena signer is busy.");
      const current = (
        await db.query<NativeIntent>(
          "SELECT * FROM yunipals_arena.transaction_intent WHERE action_id=$1",
          [intent.action_id]
        )
      ).rows[0];
      if (!current) throw new Error("Saved native Arena action is missing.");
      return await this.advanceLocked(current, build);
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
  private async haltFinalized(): Promise<never> {
    await this.service.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true,halt_reason='Native transaction finalized receipt requires review' WHERE id=$1",
      [this.service.deployment]
    );
    throw new Error(
      "Previously finalized native receipt is no longer canonical."
    );
  }
  private async advanceLocked(intent: NativeIntent, build: NativeCallBuilder) {
    const { decoded } = await this.validate(intent);
    const head = await this.head();
    let receipt: TransactionReceipt | undefined;
    try {
      receipt = await this.client.getTransactionReceipt({
        hash: intent.tx_hash
      });
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
    }
    if (
      intent.receipt_finalized &&
      (!receipt ||
        !intent.receipt ||
        typeof intent.receipt !== "object" ||
        !("blockHash" in intent.receipt) ||
        intent.receipt.blockHash !== receipt.blockHash)
    )
      return this.haltFinalized();
    if (receipt) {
      if (
        receipt.transactionHash.toLowerCase() !== intent.tx_hash ||
        receipt.from.toLowerCase() !== intent.signer.toLowerCase() ||
        receipt.to?.toLowerCase() !== this.service.contract.toLowerCase()
      )
        throw new Error("Native Arena receipt identity mismatch.");
      const canonical =
        receipt.blockNumber <= head.number &&
        (await this.client.getBlock({ blockNumber: receipt.blockNumber }))
          .hash === receipt.blockHash;
      await transaction(this.service.pool, async (db) => {
        await db.query(
          "UPDATE yunipals_arena.transaction_receipt_history SET canonical=false,checked_at=now() WHERE action_id=$1",
          [intent.action_id]
        );
        const saved = await db.query(
          `INSERT INTO yunipals_arena.transaction_receipt_history(action_id,block_hash,block_number,receipt,canonical)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(action_id,block_hash) DO UPDATE SET canonical=$5,checked_at=now()
          WHERE transaction_receipt_history.receipt=EXCLUDED.receipt AND transaction_receipt_history.block_number=EXCLUDED.block_number RETURNING action_id`,
          [
            intent.action_id,
            receipt!.blockHash,
            String(receipt!.blockNumber),
            json(receipt),
            canonical
          ]
        );
        if (!saved.rowCount)
          throw new Error("Native receipt conflicts with retained evidence.");
      });
      if (!canonical && intent.receipt_finalized) return this.haltFinalized();
      if (canonical) {
        if (receipt.status === "success" && !this.effect(intent, receipt))
          throw new Error("Native Arena receipt lacks its expected effect.");
        const observed = await this.service.nativeSource!.read(
          receipt.status === "success" ? intent.tournament_id : "0",
          { requiredThroughBlock: receipt.blockNumber }
        );
        const t = observed.tournament;
        if (
          receipt.status === "success" &&
          (!t ||
            (intent.incarnation !== null &&
              intent.incarnation !== t.incarnation) ||
            (intent.purpose === "open-lobby" &&
              t.opened.transactionHash !== intent.tx_hash))
        )
          return this.state(intent, "orphaned");
        if (t)
          await verifyNativeArenaAction(this.client, {
            ...observed,
            tournament: t
          });
        let finalized = intent.receipt_finalized;
        // First acceptance never calls the finality tag. Later audit ticks may
        // retire this receipt from recovery while normal progression continues.
        if (!finalized && ["confirmed", "reverted"].includes(intent.state))
          try {
            const boundary = await this.client.getBlock({
              blockTag: "finalized"
            });
            finalized ||=
              !!boundary.hash &&
              receipt.blockNumber <= boundary.number &&
              boundary.number <= head.number;
          } catch {
            /* Continue to reconcile this accepted receipt on later ticks. */
          }
        if (
          (await this.client.getBlock({ blockNumber: receipt.blockNumber }))
            .hash !== receipt.blockHash
        )
          return this.state(intent, "orphaned");
        const state = receipt.status === "success" ? "confirmed" : "reverted";
        return transaction(this.service.pool, async (db) => {
          await this.service.ready(db);
          if (t) {
            const current = await this.service.tournamentContext(
              intent.tournament_id,
              db,
              true,
              t.incarnation
            );
            if (
              current.observation!.tournament.opened.id !== t.opened.id ||
              current.observation!.tournament.opened.blockHash !==
                t.opened.blockHash ||
              BigInt(current.observation!.indexedThroughBlock) <
                receipt!.blockNumber ||
              current.observation!.tournament.last.id !== t.last.id ||
              current.observation!.tournament.last.blockHash !==
                t.last.blockHash ||
              canonicalJson(current.state) !== canonicalJson(t.state)
            )
              throw new Error(
                "Native Arena state changed during receipt acceptance."
              );
          }
          if (
            intent.purpose === "open-lobby" &&
            receipt!.status === "success" &&
            t
          )
            await db.query(
              `INSERT INTO yunipals_arena.opening_action_observation
            (action_id,deployment,tournament_id,incarnation,release_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [
                intent.action_id,
                this.service.deployment,
                intent.tournament_id,
                t.incarnation,
                observed.releaseId
              ]
            );
          await db.query(
            "UPDATE yunipals_arena.transaction_intent SET state=$2,receipt=$3,receipt_finalized=$4,checked_at=now() WHERE action_id=$1",
            [intent.action_id, state, json(receipt), finalized]
          );
          await db.query(
            "UPDATE yunipals_arena.transaction_receipt_history SET finalized=$3,checked_at=now() WHERE action_id=$1 AND block_hash=$2",
            [intent.action_id, receipt!.blockHash, finalized]
          );
          return {
            ...intent,
            state,
            receipt: json(receipt),
            receipt_finalized: finalized
          };
        });
      }
    }
    await this.service.pool.query(
      "UPDATE yunipals_arena.transaction_receipt_history SET canonical=false,checked_at=now() WHERE action_id=$1",
      [intent.action_id]
    );
    if (intent.receipt_finalized) {
      return this.haltFinalized();
    }
    await this.service.ready();
    const observed = await this.service.nativeSource!.read(
      intent.tournament_id
    );
    if (
      intent.incarnation !== null &&
      observed.tournament?.incarnation !== intent.incarnation
    )
      return this.state(intent, "orphaned");
    const nonce = await this.client.getTransactionCount({
      address: this.account.address,
      blockTag: "latest"
    });
    if (BigInt(nonce) > BigInt(intent.nonce))
      return this.state(intent, "uncertain");
    if (BigInt(nonce) < BigInt(intent.nonce))
      throw new Error(
        "An earlier native signer nonce must be reconciled first."
      );
    const context =
      intent.incarnation === null
        ? null
        : await this.context(intent.tournament_id, intent.incarnation);
    if (context)
      await verifyNativeArenaAction(this.client, context.observation!);
    const data = await build(context, await this.head());
    if (data !== decoded.data)
      throw new Error(
        "Saved native action no longer matches the permitted current call."
      );
    if (
      decoded.type !== "eip1559" ||
      !decoded.gas ||
      decoded.maxFeePerGas === undefined ||
      decoded.gas * decoded.maxFeePerGas > this.maxFee
    )
      throw new Error(
        "Saved native transaction exceeds its current execution fee cap."
      );
    const estimate = await this.client.estimateGas({
      account: this.account.address,
      to: this.service.contract,
      data,
      value: 0n
    });
    if (estimate > decoded.gas)
      throw new Error(
        "Saved native transaction no longer has enough gas; replacement signing is blocked."
      );
    // The final source read closes changes during simulation. No new bytes are signed.
    if (context) {
      const fresh = await this.context(
        intent.tournament_id,
        context.incarnation
      );
      if (canonicalJson(fresh!.state) !== canonicalJson(context.state))
        throw new Error("Native action changed before broadcast.");
    }
    const hash = await this.client.sendRawTransaction({
      serializedTransaction: intent.raw_transaction
    });
    if (hash !== intent.tx_hash)
      throw new Error("Native Arena broadcast hash mismatch.");
    return this.state(intent, "submitted");
  }
}
