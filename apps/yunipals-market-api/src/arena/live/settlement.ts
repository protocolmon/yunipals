import { readConfirmedBlock } from "@/confirmations";
import type { Pool } from "pg";
import {
  encodeFunctionData,
  keccak256,
  parseTransaction,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { json } from "./projection";
import type { SavedAdjudication } from "./adjudication";
import type { ArenaIntake } from "./intake";
import { NativeArenaSettlement } from "./nativeSettlement";

type Intent = {
  deployment: string;
  tournament_id: string;
  signer: Address;
  nonce: string;
  raw_transaction: Hex;
  tx_hash: Hex;
  state: string;
};

/** Dedicated referee signer only. Signed bytes are committed before any broadcast.
 * Recovery rebroadcasts those same bytes; it never signs a replacement transaction.
 */
export class ArenaSettlement {
  constructor(
    private readonly pool: Pool,
    private readonly client: PublicClient,
    private readonly account: LocalAccount,
    private readonly deployment: string,
    private readonly contract: Address,
    private readonly maxExecutionFeeWei: bigint,
    private readonly service?: ArenaIntake
  ) {
    if (
      service &&
      (service.pool !== pool ||
        service.deployment !== deployment ||
        service.contract.toLowerCase() !== contract.toLowerCase())
    )
      throw new Error("Settlement service deployment differs.");
    if (maxExecutionFeeWei <= 0n || maxExecutionFeeWei > 100_000_000_000_000n)
      throw new Error(
        "Settlement execution gas cap exceeds the permitted envelope."
      );
  }

  async prepare(id: string) {
    if (this.service?.nativeSource)
      return new NativeArenaSettlement(
        this.service,
        this.client,
        this.account,
        this.maxExecutionFeeWei
      ).prepare(id);
    await this.assertLegacy();
    return transaction(this.pool, async (db) => {
      // Serialize this dedicated signer across deployments and processes.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `arena/nonce/8453/${this.account.address.toLowerCase()}`
      ]);
      const existing = (
        await db.query<Intent>(
          "SELECT * FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND purpose='settle' AND tournament_id=$2",
          [this.deployment, id]
        )
      ).rows[0];
      if (existing) return existing;
      const saved = (
        await db.query<SavedAdjudication>(
          `SELECT a.* FROM yunipals_arena.adjudication a
         JOIN yunipals_arena.tournament t ON t.deployment=a.deployment AND t.id=a.tournament_id
         JOIN yunipals_arena.deployment d ON d.id=a.deployment
         WHERE a.deployment=$1 AND a.tournament_id=$2 AND a.state='valid'
         AND t.state->>'phase'='resolving' AND t.state->>'inputHash'=a.input_hash
         AND NOT d.halted AND d.finalized_at>now()-interval '3 minutes'`,
          [this.deployment, id]
        )
      ).rows[0];
      if (
        !saved ||
        saved.outcome_hash !== `0x${sha256(canonicalJson(saved.candidate))}` ||
        !saved.validation.valid ||
        saved.validation.errors.length ||
        !saved.winners
      )
        throw new Error(
          "Settlement requires a validated, immutable candidate."
        );
      const [semiOne, semiTwo, champion] = saved.winners;
      if (
        ![0, 1].includes(semiOne!) ||
        ![2, 3].includes(semiTwo!) ||
        ![semiOne, semiTwo].includes(champion)
      )
        throw new Error("Invalid paid-seat bracket.");
      const pending = await db.query(
        "SELECT 1 FROM yunipals_arena.transaction_intent WHERE lower(signer)=lower($1) AND state IN ('prepared','submitted','mined','uncertain') LIMIT 1",
        [this.account.address]
      );
      if (pending.rowCount)
        throw new Error("Reconcile the signer's existing transaction first.");
      if ((await this.client.getChainId()) !== 8453)
        throw new Error("Settlement requires Base mainnet.");
      const block = await this.client.getBlock({ blockTag: "latest" });
      if (Math.abs(Number(block.timestamp) * 1000 - Date.now()) > 120_000)
        throw new Error("Base head is stale.");
      const live = await this.client.readContract({
        address: this.contract,
        abi: arenaAbi,
        functionName: "tournament",
        args: [BigInt(id)],
        blockNumber: block.number
      });
      if (
        live.phase !== 3 ||
        live.inputHash !== saved.input_hash ||
        live.deadline <= block.timestamp + 90n
      )
        throw new Error(
          "Onchain input is not ready for settlement or its deadline is too close."
        );
      const data = encodeFunctionData({
        abi: arenaAbi,
        functionName: "settle",
        args: [
          BigInt(id),
          saved.outcome_hash as Hex,
          semiOne!,
          semiTwo!,
          champion!
        ]
      });
      // Simulation checks referee authorization and all contract preconditions.
      const estimate = await this.client.estimateGas({
        account: this.account.address,
        to: this.contract,
        data,
        value: 0n
      });
      const gas = (estimate * 125n) / 100n;
      const fees = await this.client.estimateFeesPerGas({
        type: "eip1559",
        chain: undefined
      });
      if (gas * fees.maxFeePerGas > this.maxExecutionFeeWei)
        throw new Error("Settlement execution fee exceeds its configured cap.");
      const [confirmedNonce, pendingNonce] = await Promise.all([
        this.client.getTransactionCount({
          address: this.account.address,
          blockTag: "latest"
        }),
        this.client.getTransactionCount({
          address: this.account.address,
          blockTag: "pending"
        })
      ]);
      if (confirmedNonce !== pendingNonce)
        throw new Error(
          "Signer has an untracked pending transaction; reconciliation required."
        );
      const used = await db.query(
        "SELECT 1 FROM yunipals_arena.transaction_intent WHERE lower(signer)=lower($1) AND nonce=$2 LIMIT 1",
        [this.account.address, confirmedNonce]
      );
      if (used.rowCount)
        throw new Error("Signer nonce conflicts with a saved transaction.");
      const raw = await this.account.signTransaction({
        type: "eip1559",
        chainId: 8453,
        nonce: confirmedNonce,
        to: this.contract,
        data,
        value: 0n,
        gas,
        ...fees
      });
      const hash = keccak256(raw);
      const row = (
        await db.query<Intent>(
          `INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash)
         VALUES($1,'settle',$2,$3,$4,$5,$6) RETURNING *`,
          [
            this.deployment,
            id,
            this.account.address.toLowerCase(),
            confirmedNonce,
            raw,
            hash
          ]
        )
      ).rows[0]!;
      return row;
    });
  }

  async advance(id: string) {
    if (this.service?.nativeSource)
      return new NativeArenaSettlement(
        this.service,
        this.client,
        this.account,
        this.maxExecutionFeeWei
      ).advance(id);
    await this.assertLegacy();
    const intent = (
      await this.pool.query<Intent>(
        "SELECT * FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND purpose='settle' AND tournament_id=$2",
        [this.deployment, id]
      )
    ).rows[0];
    if (!intent)
      throw new Error("Settlement must be prepared before broadcasting.");
    if (["confirmed", "reverted", "uncertain"].includes(intent.state))
      return intent;
    const decoded = parseTransaction(intent.raw_transaction);
    if (
      decoded.chainId !== 8453 ||
      decoded.to?.toLowerCase() !== this.contract.toLowerCase() ||
      (decoded.value ?? 0n) !== 0n ||
      keccak256(intent.raw_transaction) !== intent.tx_hash ||
      intent.signer.toLowerCase() !== this.account.address.toLowerCase()
    )
      throw new Error("Saved settlement transaction is inconsistent.");
    try {
      const receipt = await this.client.getTransactionReceipt({
        hash: intent.tx_hash
      });
      const finalized = await readConfirmedBlock(this.client, 8453);
      let state = "mined";
      if (receipt.blockNumber <= finalized.number) {
        const canonical = await this.client.getBlock({
          blockNumber: receipt.blockNumber
        });
        if (canonical.hash !== receipt.blockHash)
          throw new Error("Settlement receipt is not canonical.");
        state = receipt.status === "success" ? "confirmed" : "reverted";
      }
      await this.pool.query(
        "UPDATE yunipals_arena.transaction_intent SET state=$3,receipt=$4 WHERE deployment=$1 AND purpose='settle' AND tournament_id=$2",
        [this.deployment, id, state, json(receipt)]
      );
      return { ...intent, state };
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
    }
    const enabled = (
      await this.pool.query(
        "SELECT 1 FROM yunipals_arena.deployment WHERE id=$1 AND NOT halted AND finalized_at>now()-interval '3 minutes'",
        [this.deployment]
      )
    ).rowCount;
    if (!enabled)
      throw new Error(
        "Settlement broadcasts are paused while projection is unavailable."
      );
    const nonce = await this.client.getTransactionCount({
      address: this.account.address,
      blockTag: "latest"
    });
    if (nonce > Number(intent.nonce)) {
      await this.pool.query(
        "UPDATE yunipals_arena.transaction_intent SET state='uncertain' WHERE deployment=$1 AND purpose='settle' AND tournament_id=$2",
        [this.deployment, id]
      );
      throw new Error(
        "Settlement nonce was consumed without a receipt; no replacement allowed."
      );
    }
    const hash = await this.client.sendRawTransaction({
      serializedTransaction: intent.raw_transaction
    });
    if (hash !== intent.tx_hash)
      throw new Error("Broadcast returned a different transaction hash.");
    await this.pool.query(
      "UPDATE yunipals_arena.transaction_intent SET state='submitted' WHERE deployment=$1 AND purpose='settle' AND tournament_id=$2 AND state IN ('prepared','submitted','mined')",
      [this.deployment, id]
    );
    return { ...intent, state: "submitted" };
  }
  private async assertLegacy() {
    const row = (
      await this.pool.query<{ indexer_mode: string }>(
        "SELECT indexer_mode FROM yunipals_arena.deployment WHERE id=$1",
        [this.deployment]
      )
    ).rows[0];
    if (row?.indexer_mode !== "legacy")
      throw new Error("Legacy settlement is fenced by source selection.");
  }
}
