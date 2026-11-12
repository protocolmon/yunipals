import { zeroAddress } from "viem";
import {
  decodePortalEvent,
  portalEventSource
} from "@protopals/yunipals-market-core/portalIndex";
import {
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";
import type { PortalChain } from "./chain.js";
import { PortalLedgerStore, type PortalLedgerEvent } from "./ledger-store.js";

export class PortalLedger {
  constructor(
    readonly chain: PortalChain,
    readonly store: PortalLedgerStore,
    readonly startBlock: bigint,
    readonly confirmations: bigint,
    readonly logBlockRange = 2000n
  ) {
    if (logBlockRange < 1n || logBlockRange > 2000n)
      throw new Error("Invalid ledger log range.");
  }

  async tick() {
    const head = await this.chain.client.getBlockNumber({ cacheTime: 0 });
    if (head < this.confirmations) return;
    const safe = head - this.confirmations;
    const { collection, grading, registry } = this.chain.deployment;
    // Initialization events can precede the transaction binding this address.
    // Resolve the confirmed binding before replaying its earlier history.
    const competition = await this.chain.client.readContract({
      address: grading,
      abi: portalGradingAbi,
      functionName: "competition",
      blockNumber: safe
    });
    let cursor = await this.store.cursor();
    if (
      cursor &&
      ((await this.store.requiresReplay()) ||
        cursor.competition?.toLowerCase() !== competition.toLowerCase() ||
        (
          await this.chain.client.getBlock({
            blockNumber: BigInt(cursor.block)
          })
        ).hash !== cursor.hash)
    ) {
      // Invalidate public projections immediately, then replay independently of AI jobs.
      const before = this.startBlock - 1n;
      const block = await this.chain.client.getBlock({ blockNumber: before });
      await this.store.apply(
        [],
        before.toString(),
        block.hash,
        cursor,
        true,
        undefined,
        competition
      );
      cursor = await this.store.cursor();
    }
    const from = cursor ? BigInt(cursor.block) + 1n : this.startBlock;
    if (from > safe) return;
    const to =
      from + this.logBlockRange - 1n < safe
        ? from + this.logBlockRange - 1n
        : safe;
    const competitionCode =
      competition === zeroAddress
        ? undefined
        : await this.chain.client.getCode({
            address: competition,
            blockNumber: to
          });
    const competitionRules =
      !competitionCode || competitionCode === "0x"
        ? undefined
        : {
            batchSize: await this.chain.client.readContract({
              address: competition,
              abi: portalCompetitionAbi,
              functionName: "BATCH_SIZE",
              blockNumber: to
            }),
            contribution: await this.chain.client.readContract({
              address: competition,
              abi: portalCompetitionAbi,
              functionName: "CONTRIBUTION",
              blockNumber: to
            })
          };
    const logs = await this.chain.client.getLogs({
      address: [
        collection,
        grading,
        registry,
        ...(competition !== zeroAddress ? [competition] : [])
      ],
      fromBlock: from,
      toBlock: to
    });
    const found: PortalLedgerEvent[] = [];
    for (const log of logs) {
      const source = portalEventSource(
        { ...this.chain.deployment, competition },
        log.address
      );
      if (!source) continue;
      const decoded = decodePortalEvent(source, log);
      if (!decoded) continue;
      const name = decoded.name;
      if (
        log.blockNumber === null ||
        !log.blockHash ||
        !log.transactionHash ||
        log.logIndex === null ||
        log.transactionIndex === null
      )
        throw new Error("Unmined portal ledger event.");
      if (log.blockNumber < from || log.blockNumber > to)
        throw new Error("Portal event outside requested block range.");
      const args = decoded.args;
      found.push({
        type: name,
        tokenId: name.startsWith("Competition")
          ? "0"
          : (args.portalId ??
            (source === "collection" ? args.tokenId : undefined) ??
            "0"),
        block: log.blockNumber.toString(),
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        source: log.address.toLowerCase(),
        args
      });
    }
    found.sort((a, b) =>
      BigInt(a.block) < BigInt(b.block)
        ? -1
        : BigInt(a.block) > BigInt(b.block)
          ? 1
          : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
    );
    const block = await this.chain.client.getBlock({ blockNumber: to });
    const hashes = new Map(
      found.map((event) => [event.block, event.blockHash])
    );
    if (found.some((event) => hashes.get(event.block) !== event.blockHash))
      throw new Error("Conflicting portal event blocks.");
    const entries = [...hashes];
    for (let i = 0; i < entries.length; i += 16) {
      await Promise.all(
        entries.slice(i, i + 16).map(async ([number, hash]) => {
          if (
            (await this.chain.client.getBlock({ blockNumber: BigInt(number) }))
              .hash !== hash
          )
            throw new Error("Portal ledger changed during read.");
        })
      );
    }
    if (
      (await this.chain.client.getBlock({ blockNumber: to })).hash !==
      block.hash
    )
      throw new Error("Portal ledger changed during read.");
    // Confirm the range's parent is still canonical before committing it.
    if (
      cursor &&
      (await this.chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
        .hash !== cursor.hash
    )
      return;
    await this.store.apply(
      found,
      to.toString(),
      block.hash,
      cursor,
      false,
      competitionRules,
      competition
    );
  }
}
