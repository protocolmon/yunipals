import type { Pool, PoolClient } from "pg";
import { erc721Abi, parseEventLogs, type Hex, type PublicClient } from "viem";
import {
  type OpenSeaChain,
  isOpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import {
  observeCollectionSales,
  type ObservedMarketSale,
  type SaleBlock
} from "@protopals/yunipals-market-core/settledSale";

import { transaction } from "@/db/pool";
import { assertOpenSeaRuntimeCode, readOpenSeaHead } from "@/opensea/chain";
import { isRpcResponseLimitError } from "@/opensea/readRpc";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

const transferEvent = erc721Abi.find(
  (item) => item.type === "event" && item.name === "Transfer"
)!;
const fulfillmentEvent = seaportEventAbi.find(
  (item) => item.name === "OrderFulfilled"
)!;
const protocol = seaportDeployment.address.toLowerCase();
const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item
  );
type Checkpoint = {
  generation: string;
  block_number: string | null;
  block_hash: Hex | null;
  coverage_start: string | null;
  replay_from: string | null;
  start_block: string;
  confirmations: number;
  policy: string;
};
type Proof = {
  receipt: string;
  block: string;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  sale: ObservedMarketSale | null;
};

/** Receipt-backed collection replay; no provider credentials or admitted orders. */
export class CollectionSaleReplay {
  private readonly chainId: number;
  private readonly where: string;
  private scanSpan = 8192n;
  private runtimeVerifiedAt = 0;
  private cursorVerifiedAt = 0;
  constructor(
    private readonly pool: Pool,
    private readonly client: PublicClient,
    private readonly chain: OpenSeaChain,
    private readonly now: () => number = Date.now,
    private readonly expectedPolicy?: string,
    private readonly finality: "confirmations" | "finalized" = "confirmations"
  ) {
    if (
      !isOpenSeaChain(chain) ||
      (finality !== "confirmations" && finality !== "finalized")
    )
      throw new Error("Unsupported sale replay chain.");
    this.chainId = marketplaceChains[chain].chainId;
    this.where = `source='chain' AND chain_id=${this.chainId} AND name='seaport-sales'`;
  }

  private async checkpoint() {
    const result = await this.pool.query<Checkpoint>(
      `SELECT c.generation::text,c.block_number::text,c.block_hash,c.coverage_start::text,c.replay_from::text,
        p.start_block::text,p.confirmations,p.policy FROM yunipals_market.checkpoint c
        JOIN yunipals_market.sale_replay_config p USING(chain_id) WHERE ${this.where.replace("chain_id=", "c.chain_id=")}`
    );
    return result.rows[0];
  }
  private async commit(
    observed: Checkpoint,
    task: (db: PoolClient) => Promise<void>
  ) {
    return transaction(this.pool, async (db) => {
      // Configuration is owner-controlled. Fence a concurrent policy change as
      // well as another replay; never blend receipts under different depth rules.
      const lock = await db.query(
        `SELECT c.generation FROM yunipals_market.checkpoint c
          JOIN yunipals_market.sale_replay_config p USING(chain_id)
          WHERE ${this.where.replace("chain_id=", "c.chain_id=")} AND c.generation=$1
          AND p.start_block=$2 AND p.confirmations=$3 AND p.policy=$4 FOR UPDATE OF c`,
        [
          observed.generation,
          observed.start_block,
          observed.confirmations,
          observed.policy
        ]
      );
      if (lock.rowCount !== 1) return false;
      await task(db);
      await db.query(
        `UPDATE yunipals_market.checkpoint SET generation=generation+1 WHERE ${this.where}`
      );
      return true;
    });
  }
  private async canonical(number: bigint): Promise<SaleBlock> {
    const block = await this.client.getBlock({ blockNumber: number });
    if (!block.hash || block.number !== number || block.timestamp < 0n)
      throw new Error("Canonical sale block unavailable.");
    return { number, hash: block.hash, timestamp: block.timestamp };
  }
  private async rewind(observed: Checkpoint, before: bigint, started: number) {
    const anchors = await this.pool.query<{
      block_number: string;
      block_hash: Hex;
    }>(
      `SELECT block_number::text,block_hash FROM yunipals_market.activity_block
        WHERE chain_id=$1 AND block_number<$2::numeric AND block_number>=$3::numeric
        ORDER BY activity_block.block_number DESC LIMIT 128`,
      [this.chainId, before.toString(), observed.start_block]
    );
    let retained: SaleBlock | undefined;
    for (const anchor of anchors.rows) {
      if (this.now() - started > 20000)
        throw new Error("Replay budget elapsed.");
      const block = await this.canonical(BigInt(anchor.block_number));
      if (block.hash.toLowerCase() === anchor.block_hash) {
        retained = block;
        break;
      }
    }
    if (
      retained &&
      (await this.canonical(retained.number)).hash !== retained.hash
    )
      throw new Error("Canonical branch changed during rewind.");
    return this.commit(observed, async (db) => {
      await this.wakeReorgedOrderProjections(db, retained?.number ?? null);
      for (const table of ["sale", "sale_exclusion"]) {
        await db.query(
          `UPDATE yunipals_market.${table} SET canonical=false WHERE chain_id=$1 AND canonical
          AND ($2::numeric IS NULL OR block_number>$2::numeric)`,
          [this.chainId, retained?.number.toString() ?? null]
        );
      }
      await db.query(
        `DELETE FROM yunipals_market.activity_block WHERE chain_id=$1
        AND ($2::numeric IS NULL OR block_number>$2::numeric)`,
        [this.chainId, retained?.number.toString() ?? null]
      );
      await db.query(
        "UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp() WHERE kind='activity' AND invalidated_at IS NULL"
      );
      await db.query(
        `UPDATE yunipals_market.checkpoint SET block_number=$1::numeric,block_hash=$2,
        coverage_start=CASE WHEN $1::numeric IS NULL THEN NULL ELSE coverage_start END,
        coverage_start_time=CASE WHEN $1::numeric IS NULL THEN NULL ELSE coverage_start_time END,
        replay_from=NULL,canonical_generation=canonical_generation+1,state='syncing',
        last_error_code='canonical_replay_required',checked_at=clock_timestamp(),progress_at=clock_timestamp()
        WHERE ${this.where}`,
        [
          retained?.number.toString() ?? null,
          retained?.hash.toLowerCase() ?? null
        ]
      );
    });
  }

  async tick(): Promise<
    "advanced" | "idle" | "rewound" | "superseded" | "unavailable"
  > {
    const observed = await this.checkpoint();
    if (this.expectedPolicy && observed?.policy !== this.expectedPolicy)
      throw new Error("Sale replay configuration does not match this worker.");
    if (!observed) return "unavailable";
    const started = this.now();
    const depth = BigInt(observed.confirmations);
    try {
      const head = await readOpenSeaHead(
        this.client,
        this.chain,
        this.now,
        this.finality
      );
      const confirmed =
        this.finality === "finalized"
          ? head.finalizedNumber
          : head.number >= depth
            ? head.number - depth
            : undefined;
      if (confirmed === undefined)
        throw new Error("Confirmed chain head is unavailable.");
      const cursor =
        observed.block_number === null ? null : BigInt(observed.block_number);
      const requested =
        observed.replay_from === null ? null : BigInt(observed.replay_from);
      const verifyRuntime = async () => {
        assertOpenSeaRuntimeCode(
          this.chain,
          await this.client.getCode({
            address: seaportDeployment.address,
            blockNumber: head.number
          })
        );
        this.runtimeVerifiedAt = started;
      };
      // An unchanged confirmed height needs only the cheap head read. Runtime
      // and cursor checks are periodic safeguards rather than per-poll costs.
      if (cursor !== null && cursor === confirmed && requested === null) {
        if (started - this.runtimeVerifiedAt >= 6 * 60 * 60 * 1000)
          await verifyRuntime();
        if (started - this.cursorVerifiedAt >= 15 * 60 * 1000) {
          if (
            (await this.canonical(cursor)).hash.toLowerCase() !==
            observed.block_hash
          )
            return (await this.rewind(observed, cursor, started))
              ? "rewound"
              : "superseded";
          this.cursorVerifiedAt = started;
        }
        const committed = await this.commit(observed, (db) =>
          this.progress(db, observed, null, null, null, true)
        );
        return committed ? "idle" : "superseded";
      }
      if (started - this.runtimeVerifiedAt >= 6 * 60 * 60 * 1000)
        await verifyRuntime();
      if (
        cursor !== null &&
        (cursor > confirmed ||
          (await this.canonical(cursor)).hash.toLowerCase() !==
            observed.block_hash ||
          (requested !== null && requested <= cursor))
      ) {
        const before =
          requested !== null && requested <= cursor ? requested : cursor;
        return (await this.rewind(
          observed,
          before < confirmed + 1n ? before : confirmed + 1n,
          started
        ))
          ? "rewound"
          : "superseded";
      }
      // Changing history/depth requires an operator reset/replay, never silently
      // relabelling an existing cursor with a newly selected policy.
      if (
        observed.coverage_start !== null &&
        observed.coverage_start !== observed.start_block
      )
        throw new Error(
          "Configured history start differs from established coverage."
        );
      const policies = await this.pool.query(
        "SELECT 1 FROM yunipals_market.sale_receipt WHERE chain_id=$1 AND confirmation_policy<>$2 LIMIT 1",
        [this.chainId, observed.policy]
      );
      if (policies.rowCount)
        throw new Error("Existing receipt confirmation policy differs.");
      const from = cursor === null ? BigInt(observed.start_block) : cursor + 1n;
      if (from > confirmed) {
        if (this.now() - started > 20000)
          throw new Error("Idle replay observation expired.");
        const committed = await this.commit(observed, (db) =>
          this.progress(db, observed, null, null, null, cursor !== null)
        );
        return committed ? "idle" : "superseded";
      }
      // Every accepted sale requires an actual collection ERC721 Transfer.
      // Use those indexed events to find receipts, then inspect every relevant
      // Seaport fulfillment in each receipt. Unrelated protocol volume cannot
      // force tiny ranges or hide matched orders, gifts, mints or burns.
      const collection = marketplaceChains[this.chain].contractAddress;
      let to =
        from + this.scanSpan - 1n < confirmed
          ? from + this.scanSpan - 1n
          : confirmed;
      let scanAddress: Hex = collection;
      let transfers: Awaited<ReturnType<PublicClient["getLogs"]>>;
      const singleBlockFulfillments = async () => {
        // Dense mint/transfer blocks can exceed the receipt limit without any
        // Seaport sales. Scan the deployed protocol in this one block, then
        // validate relevant fulfillment logs against their full receipts.
        assertOpenSeaRuntimeCode(
          this.chain,
          await this.client.getCode({
            address: seaportDeployment.address,
            blockNumber: from
          })
        );
        const logs = await this.client.getLogs({
          address: seaportDeployment.address,
          event: fulfillmentEvent,
          fromBlock: from,
          toBlock: from,
          strict: true
        });
        const relevant = logs.filter((log) =>
          [...log.args.offer, ...log.args.consideration].some(
            (item) =>
              item.itemType >= 2 &&
              item.token.toLowerCase() === collection.toLowerCase()
          )
        );
        if (
          relevant.length > 512 ||
          new Set(relevant.map((log) => log.transactionHash)).size > 32
        )
          throw new Error("Single block exceeds bounded sale capacity.");
        scanAddress = seaportDeployment.address;
        return relevant;
      };
      for (;;) {
        if (this.now() - started > 20000)
          throw new Error("Replay budget elapsed.");
        try {
          transfers = await this.client.getLogs({
            address: collection,
            event: transferEvent,
            fromBlock: from,
            toBlock: to,
            strict: true
          });
        } catch (error) {
          if (!isRpcResponseLimitError(error)) throw error;
          if (from === to) {
            transfers = await singleBlockFulfillments();
            break;
          }
          to = from + (to - from) / 2n;
          this.scanSpan = to - from + 1n;
          continue;
        }
        if (
          transfers.length <= 512 &&
          new Set(transfers.map((log) => log.transactionHash)).size <= 32
        )
          break;
        if (from === to) {
          transfers = await singleBlockFulfillments();
          break;
        }
        to = from + (to - from) / 2n;
        this.scanSpan = to - from + 1n;
      }
      if (
        new Set(transfers.map((log) => `${log.blockHash}:${log.logIndex}`))
          .size !== transfers.length
      )
        throw new Error("Duplicate sale discovery log.");
      const end = await this.canonical(to);
      const start = cursor === null ? await this.canonical(from) : null;
      if (
        end.timestamp > BigInt(Math.floor(this.now() / 1000)) ||
        (start && start.timestamp > BigInt(Math.floor(this.now() / 1000)))
      )
        throw new Error("Confirmed history is ahead of the observation clock.");
      const proofs: Proof[] = [];
      const receipts = new Map<
        Hex,
        Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>
      >();
      const blocks = new Map<bigint, SaleBlock>();
      for (const log of transfers) {
        if (
          this.now() - started > 20000 ||
          log.removed ||
          log.blockNumber === null ||
          log.blockHash === null ||
          log.transactionHash === null ||
          log.logIndex === null ||
          !Number.isSafeInteger(log.logIndex) ||
          log.logIndex < 0 ||
          log.blockNumber < from ||
          log.blockNumber > to ||
          log.address.toLowerCase() !== scanAddress.toLowerCase()
        )
          throw new Error("Invalid or expired sale discovery scan.");
        let receipt = receipts.get(log.transactionHash);
        if (!receipt) {
          receipt = await this.client.getTransactionReceipt({
            hash: log.transactionHash
          });
          receipts.set(log.transactionHash, receipt);
        }
        let block = blocks.get(log.blockNumber);
        if (!block) {
          block = await this.canonical(log.blockNumber);
          if (block.timestamp > BigInt(Math.floor(this.now() / 1000)))
            throw new Error("Settlement is ahead of the observation clock.");
          blocks.set(log.blockNumber, block);
        }
        const retainedLog = receipt.logs.filter(
          (item) => item.logIndex === log.logIndex
        );
        if (
          receipt.status !== "success" ||
          receipt.blockNumber !== block.number ||
          receipt.blockHash !== block.hash ||
          receipt.transactionHash !== log.transactionHash ||
          block.hash !== log.blockHash ||
          retainedLog.length !== 1 ||
          retainedLog[0]!.removed ||
          retainedLog[0]!.blockHash !== block.hash ||
          retainedLog[0]!.blockNumber !== block.number ||
          retainedLog[0]!.transactionHash !== receipt.transactionHash ||
          retainedLog[0]!.transactionIndex !== receipt.transactionIndex ||
          retainedLog[0]!.address.toLowerCase() !== scanAddress.toLowerCase() ||
          retainedLog[0]!.data !== log.data ||
          json(retainedLog[0]!.topics) !== json(log.topics)
        )
          throw new Error("Receipt differs from canonical sale discovery log.");
      }
      const checkedCode = new Set<bigint>();
      for (const receipt of receipts.values()) {
        const block = blocks.get(receipt.blockNumber)!;
        const logs = parseEventLogs({
          abi: seaportEventAbi,
          eventName: "OrderFulfilled",
          logs: receipt.logs,
          strict: true
        }).filter(
          (log) =>
            log.address.toLowerCase() === protocol &&
            [...log.args.offer, ...log.args.consideration].some(
              (item) =>
                item.itemType >= 2 &&
                item.token.toLowerCase() === collection.toLowerCase()
            )
        );
        if (!logs.length) continue;
        if (proofs.length + logs.length > 512)
          throw new Error("Receipt exceeds bounded fulfillment capacity.");
        if (!checkedCode.has(block.number)) {
          assertOpenSeaRuntimeCode(
            this.chain,
            await this.client.getCode({
              address: seaportDeployment.address,
              blockNumber: block.number
            })
          );
          checkedCode.add(block.number);
        }
        const encoded = json(receipt),
          encodedBlock = json(block);
        if (
          Buffer.byteLength(encoded) > 1048576 ||
          Buffer.byteLength(encodedBlock) > 4096
        )
          throw new Error("Receipt exceeds durable proof capacity.");
        for (const log of logs) {
          if (
            this.now() - started > 20000 ||
            log.removed ||
            log.blockNumber !== block.number ||
            log.blockHash !== block.hash ||
            log.transactionHash !== receipt.transactionHash ||
            log.transactionIndex !== receipt.transactionIndex ||
            log.logIndex === null ||
            !Number.isSafeInteger(log.logIndex) ||
            log.logIndex < 0 ||
            receipt.logs.filter((item) => item.logIndex === log.logIndex)
              .length !== 1
          )
            throw new Error(
              "Invalid fulfillment in collection transfer receipt."
            );
        }
        const batch = observeCollectionSales(
          this.chain,
          receipt,
          block,
          logs.map((log) => log.logIndex!)
        );
        for (const { logIndex, sale } of batch) {
          proofs.push({
            sale,
            receipt: encoded,
            block: encodedBlock,
            blockNumber: block.number,
            blockHash: block.hash,
            transactionHash: receipt.transactionHash,
            logIndex
          });
        }
      }
      const latest = await readOpenSeaHead(
        this.client,
        this.chain,
        this.now,
        this.finality
      );
      const latestConfirmed =
        this.finality === "finalized"
          ? latest.finalizedNumber
          : latest.number >= depth
            ? latest.number - depth
            : undefined;
      if (
        latestConfirmed === undefined ||
        latestConfirmed < to ||
        (await this.canonical(head.number)).hash !== head.hash ||
        (await this.canonical(to)).hash !== end.hash ||
        (cursor !== null &&
          (await this.canonical(cursor)).hash.toLowerCase() !==
            observed.block_hash) ||
        this.now() - started > 20000
      )
        throw new Error("Canonical scan changed before commit.");
      const committed = await this.commit(observed, async (db) => {
        if (this.now() - started > 20000)
          throw new Error("Replay commit expired.");
        const storedReceipts = new Set<Hex>();
        for (const proof of proofs) {
          // All events for this transaction use the same canonical receipt
          // above. Verify/retain the large JSON proof once inside this atomic
          // transaction, including on replay when an existing proof must match.
          if (!storedReceipts.has(proof.transactionHash)) {
            await this.storeReceipt(db, proof, observed.policy);
            storedReceipts.add(proof.transactionHash);
          }
          await this.store(db, proof);
          if (proof.sale) await this.wakeOrderProjection(db, proof.sale);
        }
        await db.query(
          `INSERT INTO yunipals_market.activity_block(chain_id,block_number,block_hash) VALUES($1,$2,$3)
          ON CONFLICT(chain_id,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash`,
          [this.chainId, to.toString(), end.hash.toLowerCase()]
        );
        await db.query(
          `DELETE FROM yunipals_market.activity_block WHERE chain_id=$1 AND block_number<
          (SELECT block_number FROM yunipals_market.activity_block WHERE chain_id=$1 ORDER BY block_number DESC OFFSET 127 LIMIT 1)`,
          [this.chainId]
        );
        if (this.now() - started > 20000)
          throw new Error("Replay commit expired.");
        await this.progress(
          db,
          observed,
          to,
          end.hash,
          start?.timestamp ?? null,
          to === latestConfirmed
        );
      });
      if (committed) {
        this.cursorVerifiedAt = started;
        // Keep a useful range through dense mint/transfer periods. Grow again
        // when sparse, without downloading oversized responses on every tick.
        const next = to - from + 1n;
        this.scanSpan =
          transfers.length <= 128 && receipts.size <= 8
            ? next * 2n < 8192n
              ? next * 2n
              : 8192n
            : next;
      }
      return committed ? "advanced" : "superseded";
    } catch (error) {
      // Budget exhaustion is a scheduling decision. It must not advance or
      // degrade the durable replay checkpoint.
      if (rpcComputeBudgetError(error)) throw error;
      await this.commit(observed, async (db) => {
        await db.query(
          `UPDATE yunipals_market.checkpoint SET state='unavailable',last_error_code='sale_replay_failed',checked_at=clock_timestamp() WHERE ${this.where}`
        );
      });
      return "unavailable";
    }
  }

  private async progress(
    db: PoolClient,
    observed: Checkpoint,
    through: bigint | null,
    hash: Hex | null,
    startTime: bigint | null,
    caughtUp: boolean
  ) {
    await db.query(
      `UPDATE yunipals_market.checkpoint SET block_number=coalesce($1::numeric,block_number),block_hash=coalesce($2,block_hash),
      coverage_start=coalesce(coverage_start,CASE WHEN $1::numeric IS NOT NULL THEN $3::numeric END),
      coverage_start_time=coalesce(coverage_start_time,$4::numeric),replay_from=NULL,
      state=CASE WHEN EXISTS(SELECT 1 FROM yunipals_market.sale_exclusion WHERE chain_id=$5 AND canonical) THEN 'unavailable'
        WHEN $6 THEN 'available' ELSE 'syncing' END,
      last_error_code=CASE WHEN EXISTS(SELECT 1 FROM yunipals_market.sale_exclusion WHERE chain_id=$5 AND canonical) THEN 'unsupported_sale_events' ELSE NULL END,
      checked_at=clock_timestamp(),progress_at=CASE WHEN $1::numeric IS NULL THEN progress_at ELSE clock_timestamp() END
      WHERE ${this.where}`,
      [
        through?.toString() ?? null,
        hash?.toLowerCase() ?? null,
        observed.start_block,
        startTime?.toString() ?? null,
        this.chainId,
        caughtUp
      ]
    );
  }
  private async storeReceipt(db: PoolClient, proof: Proof, policy: string) {
    const result = await db.query(
      `INSERT INTO yunipals_market.sale_receipt(chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(chain_id,block_hash,transaction_hash) DO UPDATE SET receipt=yunipals_market.sale_receipt.receipt
      WHERE yunipals_market.sale_receipt.receipt=EXCLUDED.receipt AND yunipals_market.sale_receipt.block=EXCLUDED.block
        AND yunipals_market.sale_receipt.confirmation_policy=EXCLUDED.confirmation_policy RETURNING chain_id`,
      [
        this.chainId,
        proof.blockHash.toLowerCase(),
        proof.transactionHash.toLowerCase(),
        proof.receipt,
        proof.block,
        policy
      ]
    );
    if (result.rowCount !== 1)
      throw new Error("Retained receipt conflicts with replay.");
  }
  private async store(db: PoolClient, proof: Proof) {
    if (!proof.sale) {
      const excluded = await db.query(
        `INSERT INTO yunipals_market.sale_exclusion(chain_id,block_number,block_hash,log_index,transaction_hash,reason,canonical)
        VALUES($1,$2,$3,$4,$5,'unsupported_collection_sale',true) ON CONFLICT(chain_id,block_hash,log_index) DO UPDATE SET canonical=true
        WHERE yunipals_market.sale_exclusion.block_number=EXCLUDED.block_number
          AND yunipals_market.sale_exclusion.transaction_hash=EXCLUDED.transaction_hash
          AND yunipals_market.sale_exclusion.reason=EXCLUDED.reason RETURNING chain_id`,
        [
          this.chainId,
          proof.blockNumber.toString(),
          proof.blockHash.toLowerCase(),
          proof.logIndex,
          proof.transactionHash.toLowerCase()
        ]
      );
      if (excluded.rowCount !== 1)
        throw new Error("Retained exclusion conflicts with replay.");
      return;
    }
    const sale = proof.sale;
    const saved = await db.query(
      `INSERT INTO yunipals_market.sale(chain_id,block_number,block_hash,log_index,transaction_hash,protocol_address,
      order_hash,contract_address,token_id,seller,nft_recipient,observation,canonical,block_timestamp)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,to_timestamp($13))
      ON CONFLICT(chain_id,block_hash,log_index) DO UPDATE SET canonical=true WHERE yunipals_market.sale.observation=EXCLUDED.observation RETURNING chain_id`,
      [
        this.chainId,
        sale.blockNumber,
        sale.blockHash.toLowerCase(),
        sale.fulfillmentLogIndex,
        sale.transactionHash.toLowerCase(),
        protocol,
        sale.orderHash.toLowerCase(),
        sale.asset.contractAddress.toLowerCase(),
        sale.asset.tokenId,
        sale.seller.toLowerCase(),
        sale.nftRecipient.toLowerCase(),
        json(sale),
        sale.blockTimestamp
      ]
    );
    if (saved.rowCount !== 1)
      throw new Error("Retained sale conflicts with replay.");
  }

  private async wakeOrderProjection(db: PoolClient, sale: ObservedMarketSale) {
    for (const table of ["orders", "opensea_discovered_state"])
      await db.query(
        `UPDATE yunipals_market.${table} SET next_reconcile_at=least(next_reconcile_at,clock_timestamp())
        WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
        [this.chainId, protocol, sale.orderHash.toLowerCase()]
      );
  }

  private async wakeReorgedOrderProjections(
    db: PoolClient,
    retained: bigint | null
  ) {
    for (const table of ["orders", "opensea_discovered_state"])
      await db.query(
        `UPDATE yunipals_market.${table} projection
        SET next_reconcile_at=least(projection.next_reconcile_at,clock_timestamp())
        FROM (SELECT DISTINCT order_hash FROM yunipals_market.sale
          WHERE chain_id=$1 AND protocol_address=$2 AND canonical
            AND ($3::numeric IS NULL OR block_number>$3::numeric)) affected
        WHERE projection.chain_id=$1 AND projection.protocol_address=$2
          AND projection.order_hash=affected.order_hash`,
        [this.chainId, protocol, retained?.toString() ?? null]
      );
  }
}
