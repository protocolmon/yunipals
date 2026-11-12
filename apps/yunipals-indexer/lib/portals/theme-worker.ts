import {
  keccak256,
  toHex,
  TransactionNotFoundError,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex
} from "viem";
import {
  portalCompetitionAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  portalSpellCommitment,
  stablePortalJson,
  type PortalModelPolicy
} from "@protopals/yunipals-market-core/portals";
import { PortalThemeStore } from "./theme-store.js";
import type { PortalChain } from "./chain.js";
import type { PortalStore } from "./store.js";
import type { PortalAssets } from "./assets.js";
import type { OpenAIPortalAI } from "./provider.js";
import { validatedThemeOutput } from "./theme-validation.js";

export type ThemePublication = {
  pool: Address;
  batchId: bigint;
  sourcesHash: Hex;
  artifactHash: Hex;
  modelPolicy: Hex;
  title: string;
  brief: string;
  uri: string;
};

/** Independent of prize settlement. Saved outputs are reused after interruptions. */
export class PortalThemeWorker {
  readonly jobs: PortalThemeStore;
  private recoveryCursor = 0n;
  constructor(
    readonly chain: PortalChain,
    readonly store: PortalStore,
    readonly assets: PortalAssets,
    readonly ai: Pick<OpenAIPortalAI, "theme">,
    readonly policy: PortalModelPolicy,
    readonly confirmations: bigint,
    readonly publish?: (theme: ThemePublication) => Promise<Hex>,
    readonly recover?: (pool: Address, request: bigint) => Promise<Hex>
  ) {
    this.jobs = new PortalThemeStore(store.db, store.deployment);
  }
  async tick() {
    if (!this.policy.competitionThemes) return false;
    const head = await this.chain.client.getBlockNumber({ cacheTime: 0 });
    if (head < this.confirmations) return false;
    const blockNumber = head - this.confirmations;
    const pool = await this.chain.client.readContract({
      address: this.chain.deployment.grading,
      abi: portalGradingAbi,
      functionName: "competition",
      blockNumber
    });
    if (pool === zeroAddress) return false;
    const client = this.chain.client;
    const [count, size] = await Promise.all([
      client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "entryCount",
        blockNumber
      }),
      client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "BATCH_SIZE",
        blockNumber
      })
    ]);
    if (!count || count % size !== 0n) return false;
    const batchId = count / size + 1n;
    const existing = await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "getTheme",
      args: [batchId]
    });
    if (existing.hash !== zeroHash) return false;
    const previous = await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "getBatch",
      args: [batchId - 1n],
      blockNumber
    });
    if (BigInt(previous.completed) !== size) {
      // A completion notification can be retried by any wallet without changing a grade.
      if (this.recover)
        for (let checked = 0; checked < 4; checked++) {
          const id =
            (batchId - 2n) * size + 1n + (this.recoveryCursor++ % size);
          const entry = await client.readContract({
            address: pool,
            abi: portalCompetitionAbi,
            functionName: "getEntry",
            args: [id],
            blockNumber
          });
          if (
            !entry.completed &&
            (await this.chain.request(entry.requestId, blockNumber)).completed
          ) {
            await this.recover(pool, entry.requestId);
            return true;
          }
        }
      return false;
    }
    const sourcesHash = await client.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "themeSourcesHash",
      args: [batchId],
      blockNumber
    });
    const policyHash = keccak256(
      toHex(stablePortalJson(this.policy.competitionThemes))
    );
    const job = await this.jobs.claim({
      pool,
      batchId: batchId.toString(),
      sourcesHash,
      policyHash
    });
    if (!job) return false;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.jobs.heartbeat(job).catch(() => {
        leaseLost = true;
      });
    }, 60000);
    heartbeat.unref();
    try {
      const sources: {
        entryId: string;
        requestId: string;
        spell: string;
        commitment: Hex;
        reportHash: Hex;
        requestBinding: Hex;
      }[] = [];
      for (const id of previous.leaders) {
        const entry = await client.readContract({
          address: pool,
          abi: portalCompetitionAbi,
          functionName: "getEntry",
          args: [id],
          blockNumber
        });
        const request = await this.chain.request(entry.requestId, blockNumber);
        const result = await this.chain.result(entry.requestId, blockNumber);
        const spell = await this.store.spell(request.spellCommitment);
        if (!spell || !request.completed || !entry.completed)
          throw new Error("A confirmed winning spell is unavailable.");
        const commitment = portalSpellCommitment({
          chainId: this.chain.deployment.chainId,
          grading: this.chain.deployment.grading,
          submitter: request.submitter,
          tokenId: request.tokenId,
          artVersion: request.artVersion,
          nonce: request.nonce,
          spell: spell.spell,
          salt: spell.salt as Hex
        });
        if (commitment !== request.spellCommitment)
          throw new Error("Winning spell commitment mismatch.");
        sources.push({
          entryId: id.toString(),
          requestId: entry.requestId.toString(),
          spell: spell.spell,
          commitment,
          reportHash: result.reportHash,
          requestBinding: result.requestBinding
        });
      }
      const sourceDigest = keccak256(toHex(stablePortalJson(sources)));
      if (
        job.progress.sourceDigest &&
        job.progress.sourceDigest !== sourceDigest
      )
        throw new Error("Winning source evidence changed.");
      job.progress.sourceDigest = sourceDigest;
      const output = await validatedThemeOutput(
        job.progress,
        sources,
        () => this.ai.theme(sources),
        () => this.jobs.save(job)
      );
      const artifact = await this.assets.putJson({
        chainId: this.chain.deployment.chainId,
        pool,
        batchId: batchId.toString(),
        sourceBatch: (batchId - 1n).toString(),
        sourcesHash,
        sources,
        policy: this.policy.competitionThemes,
        policyHash,
        output
      });
      job.progress.artifact = artifact;
      await this.jobs.save(job);
      if (!this.publish) return true;
      if (leaseLost) throw new Error("Theme job lease lost.");
      const fresh = await client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "themeSourcesHash",
        args: [batchId]
      });
      if (fresh !== sourcesHash)
        throw new Error("Winning theme sources changed before publication.");
      const current = await client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "getTheme",
        args: [batchId]
      });
      if (current.hash !== zeroHash) {
        if (current.artifactHash !== artifact.hash)
          throw new Error("A different theme was published.");
        return true;
      }
      let transaction = job.progress.transaction as Hex | undefined;
      if (
        transaction &&
        Date.now() - Number(job.progress.transactionSubmittedAt ?? Date.now()) >
          120_000
      ) {
        try {
          await client.getTransaction({ hash: transaction });
        } catch (error) {
          if (!(error instanceof TransactionNotFoundError)) throw error;
          transaction = undefined;
          delete job.progress.transaction;
          delete job.progress.transactionSubmittedAt;
          await this.jobs.save(job);
        }
      }
      if (!transaction) {
        transaction = await this.publish({
          pool,
          batchId,
          sourcesHash,
          artifactHash: artifact.hash,
          modelPolicy: policyHash,
          title: output.title,
          brief: output.brief,
          uri: artifact.uri
        });
        job.progress.transactionSubmittedAt = Date.now();
      }
      job.progress.transaction = transaction;
      await this.jobs.save(job);
      const receipt = await client.waitForTransactionReceipt({
        hash: transaction,
        confirmations: Number(this.confirmations + 1n),
        timeout: 60_000
      });
      if (receipt.status !== "success") {
        delete job.progress.transaction;
        delete job.progress.transactionSubmittedAt;
        await this.jobs.save(job);
        throw new Error(
          "Theme publication reverted; saved output will be retried."
        );
      }
      return true;
    } finally {
      clearInterval(heartbeat);
      await this.jobs.release(job);
    }
  }
}
