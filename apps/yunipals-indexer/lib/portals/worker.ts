import { publishPortalSlab } from "./slab.js";
import { keccak256, toHex, TransactionNotFoundError, type Hex } from "viem";
import { z } from "zod";
import {
  applyPortalOriginality,
  portalModelPolicyHash,
  portalSpellCommitment,
  portalColorNames,
  type PortalModelPolicy,
  type PortalOriginality
} from "@protopals/yunipals-market-core/portals";
import { portalGradingAbi } from "@protopals/yunipals-market-core/portalAbi";
import { PortalChain, portalJson, type PortalCompletion } from "./chain.js";
import { PortalStore, type PortalJob } from "./store.js";
import { PortalAssets } from "./assets.js";
import type { PortalAI } from "./provider.js";
import { verifyPortalGradingAssessment } from "./grading.js";
import {
  portalTransformation,
  portalImagePrompt,
  resolvePortalGradingCase
} from "./prompts.js";

export class PortalWorker {
  constructor(
    readonly chain: PortalChain,
    readonly store: PortalStore,
    readonly assets: PortalAssets,
    readonly ai: PortalAI,
    readonly policy: PortalModelPolicy,
    readonly startBlock: bigint,
    readonly confirmations: bigint,
    readonly submit?: (id: bigint, result: PortalCompletion) => Promise<Hex>,
    readonly logBlockRange = 2000n
  ) {
    if (logBlockRange < 1n || logBlockRange > 2000n)
      throw new Error("Invalid worker log range.");
  }

  async ingest() {
    const head = await this.chain.client.getBlockNumber();
    if (head < this.confirmations) return;
    const safe = head - this.confirmations;
    const cursor = await this.store.cursor();
    let from = cursor ? cursor.block + 1n : this.startBlock;
    if (cursor) {
      const previous = await this.chain.client.getBlock({
        blockNumber: cursor.block
      });
      if (previous.hash !== cursor.hash) {
        from = this.startBlock;
        await this.store.rewind(from);
      }
    }
    if (from > safe) return;
    const to =
      from + this.logBlockRange - 1n < safe
        ? from + this.logBlockRange - 1n
        : safe;
    const logs = await this.chain.client.getContractEvents({
      address: this.chain.deployment.grading,
      abi: portalGradingAbi,
      eventName: "GradingRequested",
      fromBlock: from,
      toBlock: to
    });
    for (const log of logs) {
      const id = log.args.requestId;
      if (id === undefined) throw new Error("Incomplete portal request log.");
      const [request, binding] = await Promise.all([
        this.chain.request(id),
        this.chain.binding(id)
      ]);
      if (
        request.acceptedAt === 0n ||
        request.acceptedBlock !== log.blockNumber
      )
        throw new Error("Portal admission is not canonical.");
      const rubric = await this.chain.rubric(request.rubricId);
      await this.store.enqueue({
        requestId: id.toString(),
        commitment: request.spellCommitment,
        binding,
        acceptedBlock: request.acceptedBlock.toString(),
        acceptedAt: Number(request.acceptedAt),
        modelPolicy: rubric.modelPolicy
      });
    }
    const block = await this.chain.client.getBlock({ blockNumber: to });
    await this.store.saveCursor(to, block.hash);
  }

  async process(job: PortalJob) {
    const id = BigInt(job.requestId);
    const [request, binding] = await Promise.all([
      this.chain.request(id),
      this.chain.binding(id)
    ]);
    if (
      binding !== job.binding ||
      request.spellCommitment !== job.commitment ||
      request.acceptedAt === 0n
    )
      throw new Error(
        "Portal request binding changed; canonical replay required."
      );
    const spell = await this.store.spell(job.commitment);
    if (!spell)
      throw new Error(
        "Private spell upload is missing; the submitter can upload it again."
      );
    const expected = portalSpellCommitment({
      chainId: this.chain.deployment.chainId,
      grading: this.chain.deployment.grading,
      submitter: request.submitter,
      tokenId: request.tokenId,
      artVersion: request.artVersion,
      nonce: request.nonce,
      spell: spell.spell,
      salt: spell.salt as Hex
    });
    if (
      expected !== job.commitment ||
      spell.submitter !== request.submitter.toLowerCase()
    )
      throw new Error("Private spell commitment mismatch.");
    const rubric = await this.chain.rubric(request.rubricId);
    if (rubric.modelPolicy !== portalModelPolicyHash(this.policy))
      throw new Error(
        "The accepted model policy is not configured in this worker."
      );
    if (request.completed) {
      await this.publish(job, spell.spell);
      return;
    }
    if (job.progress.displayOnly)
      throw new Error(
        "Display recovery requires the original completed onchain result."
      );
    if (
      this.policy.portalEffects !== undefined ||
      this.policy.portalGradingCases !== undefined
    ) {
      if (!job.progress.portalContext) {
        const provenance = await this.chain.provenance(request.tokenId);
        const baseColor = portalColorNames[provenance[3].color - 1];
        if (!baseColor) throw new Error("Unknown underlying card color.");
        job.progress.portalContext = {
          portalKindId: request.kindId.toString(),
          baseColor
        };
        await this.store.save(job);
      }
      if (job.progress.portalContext.portalKindId !== request.kindId.toString())
        throw new Error("Portal transformation kind changed.");
    }
    if (this.policy.competitionThemes && job.progress.portalContext) {
      const theme = await this.chain.requestTheme(id);
      if (
        job.progress.portalContext.theme &&
        job.progress.portalContext.theme.hash !== theme?.hash
      )
        throw new Error("Accepted competition theme changed.");
      job.progress.portalContext.theme = theme;
      await this.store.save(job);
    }
    resolvePortalGradingCase(this.policy, job.progress.portalContext);
    if (!job.progress.embedding) {
      await this.store.heartbeat(job);
      job.progress.embedding = await this.ai.embed(spell.spell);
      await this.store.save(job);
    }
    if (!job.progress.candidates) {
      job.progress.candidates = await this.store.candidates(
        job,
        spell.spell,
        job.progress.embedding,
        this.policy.embeddings
      );
      await this.store.save(job);
    }
    const before = await this.assets.input(
      request.input.uri,
      request.input.hash
    );
    if (!job.progress.image) {
      await this.store.heartbeat(job);
      const generated = await this.ai.edit(
        spell.spell,
        before,
        job.progress.portalContext
      );
      const image = await this.assets.put(generated.bytes, "png");
      job.progress.image = {
        ...image,
        usage: generated.usage,
        model: generated.model
      };
      await this.store.save(job);
    }
    if (!job.progress.originality) {
      await this.store.heartbeat(job);
      const assessed = await this.ai.originality(
        spell.spell,
        job.progress.candidates,
        job.progress.portalContext
      );
      const sources = assessed.sources.filter((source) =>
        job.progress.candidates?.some(
          (candidate) =>
            !candidate.sameAuthor &&
            candidate.requestId === source.requestId &&
            candidate.spell.includes(source.excerpt)
        )
      );
      job.progress.originality = {
        ...assessed,
        sources,
        copied:
          assessed.copied &&
          assessed.confidence === "clear" &&
          !assessed.meaningfulContribution &&
          sources.length > 0
      };
      await this.store.save(job);
    }
    const after = await this.assets.read(
      job.progress.image.hash.slice(2),
      "png"
    );
    if (!job.progress.grading) {
      await this.store.heartbeat(job);
      job.progress.grading = await this.ai.grade(
        spell.spell,
        before,
        after,
        job.progress.portalContext
      );
      await this.store.save(job);
    }
    if (!job.progress.completion) {
      const gradingCase = resolvePortalGradingCase(
        this.policy,
        job.progress.portalContext
      );
      if (gradingCase)
        verifyPortalGradingAssessment(gradingCase, job.progress.grading);
      const base = job.progress.grading.scores;
      const originality: PortalOriginality = job.progress.originality;
      const scores = applyPortalOriginality(base, originality, rubric.copyCap);
      const evidence = await this.assets.putJson({
        cutoffBlock: job.acceptedBlock,
        cutoffTimestamp: job.acceptedAt,
        assessment: originality
      });
      const publicSpell = await this.assets.putJson({
        spell: spell.spell,
        salt: spell.salt,
        submitter: request.submitter,
        tokenId: request.tokenId.toString(),
        artVersion: request.artVersion.toString(),
        nonce: request.nonce.toString(),
        commitment: job.commitment,
        requestBinding: binding
      });
      const report = await this.assets.putJson({
        requestId: job.requestId,
        requestBinding: binding,
        input: request.input,
        output: job.progress.image,
        rubricId: request.rubricId,
        competitionTheme: job.progress.portalContext?.theme ?? null,
        portalTransformation:
          portalTransformation(this.policy, job.progress.portalContext) ?? null,
        effectiveImagePrompt: portalImagePrompt(
          this.policy,
          spell.spell,
          job.progress.portalContext
        ),
        baseScores: base,
        gradingCase:
          resolvePortalGradingCase(this.policy, job.progress.portalContext) ??
          null,
        gradingAssessment: job.progress.grading.assessment ?? null,
        scores,
        copyCap: rubric.copyCap,
        originality,
        evidenceHash: evidence.hash,
        reason: job.progress.grading.reason,
        models: {
          policy: this.policy,
          image: job.progress.image.model,
          grading: job.progress.grading.model
        },
        usage: {
          image: job.progress.image.usage,
          grading: job.progress.grading.usage
        },
        spellHash: keccak256(toHex(spell.spell))
      });
      job.progress.completion = {
        requestBinding: binding,
        artwork: { uri: job.progress.image.uri, hash: job.progress.image.hash },
        scores: [
          scores.creativity,
          scores.harmony,
          scores.craft,
          scores.impact
        ],
        baseCreativity: base.creativity,
        copied: originality.copied,
        evidenceHash: originality.copied
          ? evidence.hash
          : `0x${"0".repeat(64)}`,
        reportHash: report.hash,
        modelsHash: rubric.modelPolicy,
        reportURI: report.uri,
        spellURI: publicSpell.uri,
        completedAt: "0",
        evidenceArtifact: evidence.hash,
        spellArtifact: publicSpell.hash
      };
      await this.store.save(job);
    }
    if (!this.submit) return;
    // Re-read immediately before spending gas; the completion also binds this request onchain.
    if ((await this.chain.binding(id)) !== binding)
      throw new Error("Portal request changed before completion.");
    if (
      job.progress.transactionHash &&
      Date.now() - (job.progress.transactionSubmittedAt ?? Date.now()) > 120_000
    ) {
      try {
        await this.chain.client.getTransaction({
          hash: job.progress.transactionHash as Hex
        });
      } catch (error) {
        if (error instanceof TransactionNotFoundError) {
          delete job.progress.transactionHash;
          delete job.progress.transactionSubmittedAt;
          await this.store.save(job);
        } else throw error;
      }
    }
    if (!job.progress.transactionHash) {
      const result = completionFromProgress(job.progress.completion);
      job.progress.transactionHash = await this.submit(id, result);
      job.progress.transactionSubmittedAt = Date.now();
      await this.store.save(job);
    }
    const receipt = await this.chain.client.waitForTransactionReceipt({
      hash: job.progress.transactionHash as Hex,
      confirmations: Number(this.confirmations + 1n),
      timeout: 60_000
    });
    if (receipt.status !== "success") {
      delete job.progress.transactionHash;
      delete job.progress.transactionSubmittedAt;
      await this.store.save(job);
      throw new Error(
        "The grading transaction reverted; the saved result will be retried."
      );
    }
    await this.publish(job, spell.spell);
  }

  private async publish(job: PortalJob, spell: string) {
    const id = BigInt(job.requestId);
    const head = await this.chain.client.getBlock();
    if (head.number < this.confirmations)
      throw new Error("Portal result awaits confirmations.");
    const safeBlock = head.number - this.confirmations;
    const [request, result] = await Promise.all([
      this.chain.request(id, safeBlock),
      this.chain.result(id, safeBlock)
    ]);
    if (!request.completed || result.requestBinding !== job.binding)
      throw new Error("Portal result is not finalized.");
    if (
      job.progress.completion &&
      result.artwork.hash !==
        (job.progress.completion.artwork as { hash: string }).hash
    )
      throw new Error("Finalized result differs from the cached artwork.");
    const slab = await publishPortalSlab(this.assets, {
      chainId: this.chain.deployment.chainId,
      grading: this.chain.deployment.grading,
      requestId: job.requestId,
      tokenId: request.tokenId.toString(),
      kindId: request.kindId.toString(),
      version: (request.artVersion + 1n).toString(),
      spell,
      result
    });
    const completion = job.progress.completion;
    const artifacts = [
      slab.hash,
      slab.manifest.hash,
      result.artwork.hash,
      result.reportHash,
      ...(completion
        ? [
            String(completion.spellArtifact),
            String(completion.evidenceArtifact)
          ]
        : [])
    ];
    await this.store.publish(job, {
      tokenId: request.tokenId.toString(),
      submitter: request.submitter,
      spell,
      embedding: job.progress.embedding ?? [],
      embeddingModel: this.policy.embeddings,
      block: head.number.toString(),
      timestamp: Number(head.timestamp),
      result: portalJson({
        slab,
        request,
        result,
        gradingReason: job.progress.grading?.reason ?? null,
        originality: job.progress.originality ?? null
      }),
      artifacts: artifacts
        .filter((h) => /^0x[0-9a-f]{64}$/.test(h))
        .map((h) => h.slice(2))
    });
  }

  async tick() {
    await this.ingest();
    const job = await this.store.claim(portalModelPolicyHash(this.policy));
    if (!job) return false;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.store.heartbeat(job).catch(() => {
        leaseLost = true;
      });
    }, 60_000);
    heartbeat.unref();
    try {
      await this.process(job);
      if (leaseLost) throw new Error("Portal job lease lost.");
      if (!this.submit)
        await this.store.retry(
          job,
          "Prepared result awaits the authorized grading transaction."
        );
    } catch (error) {
      await this.store.retry(
        job,
        error instanceof Error ? error.message : "Portal worker failed."
      );
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}

export function completionFromProgress(
  value: Record<string, unknown>
): PortalCompletion {
  const hash = z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .transform((value) => value as Hex);
  const score = z.number().int().min(1).max(100);
  const result = z
    .object({
      requestBinding: hash,
      artwork: z.object({ uri: z.string().min(8), hash }),
      scores: z.tuple([score, score, score, score]),
      baseCreativity: score,
      copied: z.boolean(),
      evidenceHash: hash,
      reportHash: hash,
      modelsHash: hash,
      reportURI: z.string().min(8),
      spellURI: z.string().min(8)
    })
    .parse(value);
  return { ...result, completedAt: 0n };
}
