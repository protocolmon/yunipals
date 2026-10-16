import {
  encodeFunctionData,
  decodeFunctionData,
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
import { readConfirmedBlock } from "@/confirmations";
import { ArenaIntake } from "./intake";
import { ArenaInputCompiler } from "./input";
import { json } from "./projection";
import type { ArenaCapacity } from "./capacity";
import { publishedPayoutFilm } from "./payout";
import { ARENA_RESOLUTION_SECONDS } from "@protopals/yunipals-market-core/arena";

export type ControlPurpose =
  | "finalize-island"
  | "freeze-input"
  | "expire"
  | "release-payouts"
  | "open-lobby";
type Intent = {
  deployment: string;
  purpose: ControlPurpose;
  tournament_id: string;
  signer: Address;
  nonce: string;
  raw_transaction: Hex;
  tx_hash: Hex;
  state: string;
};

/** Durable zero-value progression calls. The separate lobby operator can only
 * open lobbies after capacity checks; referee signing handles freeze/settlement. */
export class ArenaControl {
  constructor(
    private readonly service: ArenaIntake,
    private readonly compiler: ArenaInputCompiler,
    private readonly client: PublicClient,
    private readonly account: LocalAccount,
    private readonly maxExecutionFeeWei: bigint,
    private readonly capacity?: ArenaCapacity,
    private readonly mediaStorage?: string
  ) {
    if (maxExecutionFeeWei <= 0n || maxExecutionFeeWei > 100_000_000_000_000n)
      throw new Error("Invalid control transaction fee cap.");
  }

  private async saved(purpose: ControlPurpose, id: string) {
    return (
      await this.service.pool.query<Intent>(
        "SELECT * FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND purpose=$2 AND tournament_id=$3",
        [this.service.deployment, purpose, id]
      )
    ).rows[0];
  }

  async prepare(purpose: ControlPurpose, id: string) {
    const prior = await this.saved(purpose, id);
    if (prior) return prior;
    await this.service.ready();
    const preparedInput =
      purpose === "freeze-input" ? await this.compiler.prepare(id) : null;
    return transaction(this.service.pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `arena/nonce/8453/${this.account.address.toLowerCase()}`
      ]);
      const existing = (
        await db.query<Intent>(
          "SELECT * FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND purpose=$2 AND tournament_id=$3",
          [this.service.deployment, purpose, id]
        )
      ).rows[0];
      if (existing) return existing;
      await this.service.ready(db);
      if (
        (
          await db.query(
            "SELECT 1 FROM yunipals_arena.transaction_intent WHERE lower(signer)=lower($1) AND state IN ('prepared','submitted','mined','uncertain') LIMIT 1",
            [this.account.address]
          )
        ).rowCount
      )
        throw new Error("Reconcile the existing signer transaction first.");
      const state =
        purpose === "open-lobby"
          ? null
          : await this.service.state(id, db, true);
      if ((await this.client.getChainId()) !== 8453)
        throw new Error("Arena control requires Base.");
      const block = await this.client.getBlock({ blockTag: "latest" });
      if (Math.abs(Number(block.timestamp) * 1000 - Date.now()) > 120000)
        throw new Error("Base head is stale.");
      const live =
        purpose === "open-lobby"
          ? null
          : await this.client.readContract({
              address: this.service.contract,
              abi: arenaAbi,
              functionName: "tournament",
              args: [BigInt(id)],
              blockNumber: block.number
            });
      let data: Hex;
      if (purpose === "open-lobby") {
        if (!this.capacity)
          throw new Error("Lobby creation requires operating-capacity checks.");
        await this.capacity.check(true);
        const projectedNext = (
          await db.query<{ id: string }>(
            "SELECT (coalesce(max(id),0)+1)::text AS id FROM yunipals_arena.tournament WHERE deployment=$1",
            [this.service.deployment]
          )
        ).rows[0]!.id;
        if (projectedNext !== id)
          throw new Error("Lobby projection has not caught up to the next ID.");
        const [next, paused, operator] = await Promise.all([
          this.client.readContract({
            address: this.service.contract,
            abi: arenaAbi,
            functionName: "nextTournamentId",
            blockNumber: block.number
          }),
          this.client.readContract({
            address: this.service.contract,
            abi: arenaAbi,
            functionName: "entriesPaused",
            blockNumber: block.number
          }),
          this.client.readContract({
            address: this.service.contract,
            abi: arenaAbi,
            functionName: "lobbyOperator",
            blockNumber: block.number
          })
        ]);
        if (
          next !== BigInt(id) ||
          paused ||
          operator.toLowerCase() !== this.account.address.toLowerCase()
        )
          throw new Error("Lobby is paused or operator/next ID differs.");
        data = encodeFunctionData({
          abi: arenaAbi,
          functionName: "openTournament"
        });
      } else if (purpose === "finalize-island" && state && live) {
        if (
          state.phase !== "open" ||
          state.randomWord === null ||
          state.islandId !== null ||
          live.phase !== 1 ||
          !live.randomnessReceived ||
          live.islandId !== 0 ||
          live.deadline <= block.timestamp + 60n
        )
          throw new Error("Island is not ready to finalize.");
        data = encodeFunctionData({
          abi: arenaAbi,
          functionName: "finalizeIsland",
          args: [BigInt(id)]
        });
      } else if (purpose === "freeze-input" && preparedInput && state && live) {
        if (
          state.phase !== "strategies" ||
          live.phase !== 2 ||
          live.deadline + BigInt(ARENA_RESOLUTION_SECONDS) <=
            block.timestamp + 30n ||
          (preparedInput.automaticStrategyMask !== 0 &&
            live.deadline > block.timestamp) ||
          live.count !== 4 ||
          live.islandId === 0
        )
          throw new Error("Input is not ready to freeze.");
        const inputArgs = [
          BigInt(id),
          preparedInput.inputHash,
          preparedInput.commitments as [Hex, Hex, Hex, Hex],
          preparedInput.signatures as [Hex, Hex, Hex, Hex]
        ] as const;
        data =
          preparedInput.automaticStrategyMask === 0
            ? encodeFunctionData({
                abi: arenaAbi,
                functionName: "freezeInput",
                args: inputArgs
              })
            : encodeFunctionData({
                abi: arenaAbi,
                functionName: "freezeInputWithFallback",
                args: [...inputArgs, preparedInput.automaticStrategyMask]
              });
      } else if (purpose === "release-payouts" && state && live) {
        const [published, referee] = await Promise.all([
          this.client.readContract({
            address: this.service.contract,
            abi: arenaAbi,
            functionName: "publishedVideoHash",
            args: [BigInt(id)],
            blockNumber: block.number
          }),
          this.client.readContract({
            address: this.service.contract,
            abi: arenaAbi,
            functionName: "referee",
            blockNumber: block.number
          })
        ]);
        if (
          state.phase !== "settled" ||
          state.videoHash ||
          live.phase !== 4 ||
          live.resultHash !== state.resultHash ||
          !/^0x0{64}$/.test(published) ||
          referee.toLowerCase() !== this.account.address.toLowerCase()
        )
          throw new Error("Tournament is not ready for payout release.");
        const filmHash = await publishedPayoutFilm(
          this.service.pool,
          this.service.deployment,
          id,
          this.mediaStorage
        );
        data = encodeFunctionData({
          abi: arenaAbi,
          functionName: "releasePayouts",
          args: [BigInt(id), filmHash]
        });
      } else if (purpose === "expire" && state && live) {
        if (
          !["open", "strategies", "resolving"].includes(state.phase) ||
          ![1, 2, 3].includes(live.phase) ||
          live.deadline === 0n ||
          live.deadline +
            (live.phase === 2 ? BigInt(ARENA_RESOLUTION_SECONDS) : 0n) >
            block.timestamp
        )
          throw new Error("Tournament has not expired.");
        data = encodeFunctionData({
          abi: arenaAbi,
          functionName: "expire",
          args: [BigInt(id)]
        });
      } else throw new Error("Unsupported control action.");
      const estimate = await this.client.estimateGas({
        account: this.account.address,
        to: this.service.contract,
        data,
        value: 0n
      });
      const gas = (estimate * 125n) / 100n;
      const fees = await this.client.estimateFeesPerGas({
        type: "eip1559",
        chain: undefined
      });
      if (gas * fees.maxFeePerGas > this.maxExecutionFeeWei)
        throw new Error("Control transaction exceeds its execution fee cap.");
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
      if (
        confirmedNonce !== pendingNonce ||
        (
          await db.query(
            "SELECT 1 FROM yunipals_arena.transaction_intent WHERE lower(signer)=lower($1) AND nonce=$2",
            [this.account.address, confirmedNonce]
          )
        ).rowCount
      )
        throw new Error("Signer nonce needs reconciliation.");
      const raw = await this.account.signTransaction({
        type: "eip1559",
        chainId: 8453,
        nonce: confirmedNonce,
        to: this.service.contract,
        data,
        value: 0n,
        gas,
        ...fees
      });
      return (
        await db.query<Intent>(
          `INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            this.service.deployment,
            purpose,
            id,
            this.account.address.toLowerCase(),
            confirmedNonce,
            raw,
            keccak256(raw)
          ]
        )
      ).rows[0]!;
    });
  }

  async advance(purpose: ControlPurpose, id: string) {
    const intent = await this.saved(purpose, id);
    if (!intent) throw new Error("Control transaction must be prepared first.");
    if (["confirmed", "reverted", "uncertain"].includes(intent.state))
      return intent;
    const decoded = parseTransaction(intent.raw_transaction);
    const selector = {
      "finalize-island": "finalizeIsland",
      "freeze-input": "freezeInput",
      expire: "expire",
      "release-payouts": "releasePayouts",
      "open-lobby": "openTournament"
    }[purpose];
    // Selector and signed hash are checked independently of caller-supplied purpose.
    const call = decodeFunctionData({
      abi: arenaAbi,
      data: decoded.data ?? "0x"
    });
    if (
      decoded.chainId !== 8453 ||
      decoded.to?.toLowerCase() !== this.service.contract.toLowerCase() ||
      (decoded.value ?? 0n) !== 0n ||
      keccak256(intent.raw_transaction) !== intent.tx_hash ||
      intent.signer.toLowerCase() !== this.account.address.toLowerCase() ||
      (call.functionName !== selector &&
        !(
          purpose === "freeze-input" &&
          call.functionName === "freezeInputWithFallback"
        )) ||
      (purpose === "open-lobby"
        ? (call.args?.length ?? 0) !== 0
        : call.args?.[0] !== BigInt(id))
    )
      throw new Error("Saved control transaction is inconsistent.");
    try {
      const receipt = await this.client.getTransactionReceipt({
        hash: intent.tx_hash
      });
      const finalized = await readConfirmedBlock(this.client, 8453);
      let state = "mined";
      if (receipt.blockNumber <= finalized.number) {
        if (
          (await this.client.getBlock({ blockNumber: receipt.blockNumber }))
            .hash !== receipt.blockHash
        )
          throw new Error("Control receipt is not canonical.");
        state = receipt.status === "success" ? "confirmed" : "reverted";
      }
      await this.service.pool.query(
        "UPDATE yunipals_arena.transaction_intent SET state=$4,receipt=$5 WHERE deployment=$1 AND purpose=$2 AND tournament_id=$3",
        [this.service.deployment, purpose, id, state, json(receipt)]
      );
      return { ...intent, state };
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
    }
    await this.service.ready();
    const nonce = await this.client.getTransactionCount({
      address: this.account.address,
      blockTag: "latest"
    });
    if (nonce > Number(intent.nonce)) {
      await this.service.pool.query(
        "UPDATE yunipals_arena.transaction_intent SET state='uncertain' WHERE deployment=$1 AND purpose=$2 AND tournament_id=$3",
        [this.service.deployment, purpose, id]
      );
      throw new Error(
        "Control nonce consumed without its receipt; no replacement permitted."
      );
    }
    if (purpose === "open-lobby") {
      if (!this.capacity)
        throw new Error("Lobby creation requires operating-capacity checks.");
      await this.capacity.check(true);
    }
    if (
      purpose === "release-payouts" &&
      call.args?.[1] !==
        (await publishedPayoutFilm(
          this.service.pool,
          this.service.deployment,
          id,
          this.mediaStorage
        ))
    )
      throw new Error(
        "Saved payout transaction does not match the published film."
      );
    const hash = await this.client.sendRawTransaction({
      serializedTransaction: intent.raw_transaction
    });
    if (hash !== intent.tx_hash)
      throw new Error("Control broadcast hash mismatch.");
    await this.service.pool.query(
      "UPDATE yunipals_arena.transaction_intent SET state='submitted' WHERE deployment=$1 AND purpose=$2 AND tournament_id=$3 AND state IN ('prepared','submitted','mined')",
      [this.service.deployment, purpose, id]
    );
    return { ...intent, state: "submitted" };
  }
}
