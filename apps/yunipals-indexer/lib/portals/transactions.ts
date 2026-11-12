import type { Pool, PoolClient } from "pg";
import {
  encodeAbiParameters,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  TransactionReceiptNotFoundError,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type TransactionSerialized,
  type WalletClient
} from "viem";

export const portalTransactionSchema = `CREATE TABLE IF NOT EXISTS portal_v5_transaction (
 chain_id integer NOT NULL, signer text NOT NULL, operation text NOT NULL,
 attempt integer NOT NULL, nonce bigint NOT NULL, intent_hash text NOT NULL,
 transaction_hash text NOT NULL, signed_transaction text NOT NULL,
 state text NOT NULL CHECK(state IN ('prepared','broadcast','confirmed','reverted')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,signer,operation,attempt), UNIQUE(chain_id,signer,nonce)
)`;

export type PortalTransaction = {
  operation: string;
  attempt: number;
  nonce: number;
  intentHash: Hex;
  hash: Hex;
  raw: TransactionSerialized;
  state: "prepared" | "broadcast" | "confirmed" | "reverted";
};
export interface PortalTransactionSession {
  latest(operation: string): Promise<PortalTransaction | null>;
  unresolved(nonce: number): Promise<PortalTransaction[]>;
  insert(transaction: PortalTransaction): Promise<void>;
  state(hash: Hex, state: PortalTransaction["state"]): Promise<void>;
}
export interface PortalTransactionJournal {
  withSigner<T>(
    chainId: number,
    signer: Address,
    action: (session: PortalTransactionSession) => Promise<T>
  ): Promise<T>;
}

/** A dedicated connection holds a session lock through signing and broadcast. */
export class PgPortalTransactionJournal implements PortalTransactionJournal {
  constructor(readonly pool: Pool) {}
  async withSigner<T>(
    chainId: number,
    signer: Address,
    action: (session: PortalTransactionSession) => Promise<T>
  ) {
    const connection = await this.pool.connect();
    const scope = `portal-signing:${chainId}:${signer.toLowerCase()}`;
    let locked = false;
    try {
      const result = await connection.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [scope]
      );
      locked = result.rows[0]?.locked === true;
      if (!locked)
        throw new Error("Portal signer is busy; retry this saved operation.");
      return await action(
        new PgPortalTransactionSession(
          connection,
          chainId,
          signer.toLowerCase()
        )
      );
    } finally {
      let damaged = false;
      if (locked) {
        try {
          await connection.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [scope]
          );
        } catch {
          damaged = true;
        }
      }
      connection.release(damaged);
    }
  }
}

const transactionFields = `operation,attempt,nonce::text,intent_hash AS "intentHash",
 transaction_hash AS hash,signed_transaction AS raw,state`;
type TransactionRow = Omit<PortalTransaction, "nonce"> & { nonce: string };
function transactionRow(row: TransactionRow): PortalTransaction {
  const nonce = Number(row.nonce);
  if (!Number.isSafeInteger(nonce) || nonce < 0)
    throw new Error("Invalid saved transaction nonce.");
  return { ...row, nonce };
}
class PgPortalTransactionSession implements PortalTransactionSession {
  constructor(
    readonly connection: PoolClient,
    readonly chainId: number,
    readonly signer: string
  ) {}
  async latest(operation: string) {
    const result = await this.connection.query<TransactionRow>(
      `SELECT ${transactionFields} FROM portal_v5_transaction WHERE chain_id=$1 AND signer=$2 AND operation=$3 ORDER BY attempt DESC LIMIT 1`,
      [this.chainId, this.signer, operation]
    );
    return result.rows[0] ? transactionRow(result.rows[0]) : null;
  }
  async unresolved(nonce: number) {
    const result = await this.connection.query<TransactionRow>(
      `SELECT ${transactionFields} FROM portal_v5_transaction WHERE chain_id=$1 AND signer=$2 AND (state IN ('prepared','broadcast') OR nonce >= $3) ORDER BY nonce`,
      [this.chainId, this.signer, nonce]
    );
    return result.rows.map(transactionRow);
  }
  async insert(tx: PortalTransaction) {
    await this.connection.query(
      `INSERT INTO portal_v5_transaction(chain_id,signer,operation,attempt,nonce,intent_hash,transaction_hash,signed_transaction,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        this.chainId,
        this.signer,
        tx.operation,
        tx.attempt,
        tx.nonce,
        tx.intentHash,
        tx.hash,
        tx.raw,
        tx.state
      ]
    );
  }
  async state(hash: Hex, state: PortalTransaction["state"]) {
    await this.connection.query(
      "UPDATE portal_v5_transaction SET state=$4,updated_at=now() WHERE chain_id=$1 AND signer=$2 AND transaction_hash=$3",
      [this.chainId, this.signer, hash, state]
    );
  }
}

export type PortalTransactionIntent = {
  operation: string;
  to: Address;
  data: Hex;
  value?: bigint;
};
export function portalTransactionIntentHash(
  intent: Pick<PortalTransactionIntent, "to" | "data" | "value">
) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "uint256" }],
      [intent.to, intent.data, intent.value ?? 0n]
    )
  );
}

/** One in-flight nonce per signer, durable before RPC submission. */
export class PortalTransactionSender {
  constructor(
    readonly journal: PortalTransactionJournal,
    readonly client: PublicClient,
    readonly wallet: WalletClient<Transport, Chain, Account>,
    readonly confirmations: bigint,
    readonly maxTransactionFee: bigint
  ) {
    if (confirmations < 0n || maxTransactionFee <= 0n)
      throw new Error(
        "Configure confirmations and a positive transaction fee ceiling."
      );
  }

  async send(intent: PortalTransactionIntent): Promise<Hex> {
    if (
      !/^[a-zA-Z0-9:/_-]{1,240}$/.test(intent.operation) ||
      (intent.value ?? 0n) !== 0n
    )
      throw new Error("Invalid portal worker transaction intent.");
    const chainId = this.wallet.chain.id;
    const signer = this.wallet.account.address;
    if ((await this.client.getChainId()) !== chainId)
      throw new Error("Portal signer chain mismatch.");
    const intentHash = portalTransactionIntentHash(intent);
    return this.journal.withSigner(chainId, signer, async (session) => {
      const existing = await session.latest(intent.operation);
      if (existing && existing.intentHash !== intentHash)
        throw new Error(
          "Saved portal transaction does not match this operation."
        );
      if (existing && (await this.resume(session, existing)) !== "reverted")
        return existing.hash;

      const nonce = await this.client.getTransactionCount({
        address: signer,
        blockTag: "latest"
      });
      for (const earlier of await session.unresolved(nonce)) {
        if ((await this.resume(session, earlier)) === "pending")
          throw new Error(
            "An earlier portal signer transaction is still pending."
          );
      }
      const pending = await this.client.getTransactionCount({
        address: signer,
        blockTag: "pending"
      });
      if (pending !== nonce)
        throw new Error(
          "An untracked signer transaction is pending; reconcile it before continuing."
        );
      const request = await this.wallet.prepareTransactionRequest({
        account: this.wallet.account,
        chain: this.wallet.chain,
        to: intent.to,
        data: intent.data,
        value: 0n,
        nonce
      });
      // This ceiling covers execution gas, not the chain's additional L1 data fee.
      const price = request.maxFeePerGas ?? request.gasPrice;
      if (
        price === undefined ||
        request.gas === undefined ||
        request.gas * price > this.maxTransactionFee
      )
        throw new Error("Portal execution fee exceeds the configured ceiling.");
      const raw = await this.wallet.signTransaction(request);
      const transaction: PortalTransaction = {
        operation: intent.operation,
        attempt: (existing?.attempt ?? -1) + 1,
        nonce,
        intentHash,
        raw,
        hash: keccak256(raw),
        state: "prepared"
      };
      // A timeout after this commit is recoverable with the exact same signed bytes.
      await session.insert(transaction);
      await this.broadcast(session, transaction);
      return transaction.hash;
    });
  }

  private async validate(tx: PortalTransaction) {
    const decoded = parseTransaction(tx.raw);
    if (
      keccak256(tx.raw) !== tx.hash ||
      decoded.chainId !== this.wallet.chain.id ||
      decoded.nonce !== tx.nonce ||
      !decoded.to ||
      portalTransactionIntentHash({
        to: decoded.to,
        data: decoded.data ?? "0x",
        value: decoded.value
      }) !== tx.intentHash ||
      (
        await recoverTransactionAddress({ serializedTransaction: tx.raw })
      ).toLowerCase() !== this.wallet.account.address.toLowerCase()
    )
      throw new Error("Saved portal transaction integrity check failed.");
  }

  private async resume(
    session: PortalTransactionSession,
    tx: PortalTransaction
  ): Promise<"confirmed" | "reverted" | "pending"> {
    await this.validate(tx);
    try {
      const receipt = await this.client.getTransactionReceipt({
        hash: tx.hash
      });
      const block = await this.client.getBlock({
        blockNumber: receipt.blockNumber
      });
      if (
        receipt.transactionHash !== tx.hash ||
        block.hash !== receipt.blockHash
      )
        throw new Error("Saved portal transaction receipt is not canonical.");
      const head = await this.client.getBlockNumber({ cacheTime: 0 });
      if (head < receipt.blockNumber + this.confirmations) return "pending";
      const state = receipt.status === "success" ? "confirmed" : "reverted";
      await session.state(tx.hash, state);
      return state;
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError))
        throw new Error(
          "Portal receipt could not be verified; the saved transaction is retained."
        );
    }
    const consumed = await this.client.getTransactionCount({
      address: this.wallet.account.address,
      blockTag: "latest"
    });
    if (consumed > tx.nonce)
      throw new Error(
        "Portal transaction nonce was consumed without its receipt. Reconcile the replacement before retrying."
      );
    await this.broadcast(session, tx);
    return "pending";
  }

  private async broadcast(
    session: PortalTransactionSession,
    tx: PortalTransaction
  ) {
    try {
      const hash = await this.wallet.sendRawTransaction({
        serializedTransaction: tx.raw
      });
      if (hash !== tx.hash) return;
    } catch {
      // Includes already-known and ambiguous network errors. The caller tracks the
      // expected hash; a later attempt checks its receipt and rebroadcasts these bytes.
      return;
    }
    await session.state(tx.hash, "broadcast");
  }
}
