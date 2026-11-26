import { adventureAbi } from "@protopals/yunipals-market-core/evolutionAbi";
import type { Hex } from "viem";
import type { PortalAssets } from "../portals/assets.js";
import type { OpenAIPortalAI } from "../portals/provider.js";
import { EvolutionReader } from "../../../../packages/yunipals-indexer-server/src/evolution.js";
import {
  cardFinishes,
  serumDefinition,
  serumPresences
} from "@protopals/yunipals-market-core/serums";
import { evolutionPrompt, evolutionRenderingHash } from "./art.js";
import type { EvolutionChain } from "./chain.js";
import { saveHoloLayers } from "./holo.js";
import type {
  EvolutionArtifact,
  EvolutionJob,
  EvolutionStore
} from "./store.js";

export class EvolutionWorker {
  readonly policy: Hex;
  private readonly settlementRetries = new Map<
    string,
    { attempts: number; retryAt: number }
  >();
  constructor(
    readonly reader: EvolutionReader,
    readonly chain: EvolutionChain,
    readonly store: EvolutionStore,
    readonly assets: PortalAssets,
    readonly ai: Pick<
      OpenAIPortalAI,
      "editImages" | "policy" | "calibrateHolo"
    >,
    readonly submit?: (
      id: bigint,
      binding: Hex,
      artifact: EvolutionArtifact
    ) => Promise<Hex>,
    readonly settle?: (
      kind: "adventure" | "fusion",
      randomnessId: bigint
    ) => Promise<Hex>
  ) {
    this.policy = evolutionRenderingHash(ai.policy);
  }
  async tick() {
    const pendingSettlements = new Set<string>();
    if (this.settle)
      for (const domain of ["adventure", "job"] as const) {
        let after = 0n;
        for (;;) {
          const batch = await this.reader.unsettled(domain, after);
          if (
            (await this.chain.client.getBlock({ blockNumber: batch.block }))
              .hash !== batch.hash
          )
            throw new Error("Settlement branch changed.");
          await this.chain.assertBindings(batch.block);
          for (const row of batch.rows) {
            after = BigInt(String(row.value.requestId));
            const id =
              domain === "adventure"
                ? after
                : BigInt(String(row.value.randomnessId));
            const address =
              domain === "adventure"
                ? this.chain.adventures
                : this.chain.evolution;
            const key = `${domain}:${id}`;
            pendingSettlements.add(key);
            const retry = this.settlementRetries.get(key);
            if (retry && retry.retryAt > Date.now()) continue;
            try {
              const proof = await this.chain.client.readContract({
                address,
                abi: adventureAbi,
                functionName: "randomRequests",
                args: [id],
                blockNumber: batch.block
              });
              if (proof[2])
                await this.settle(
                  domain === "adventure" ? "adventure" : "fusion",
                  id
                );
              this.settlementRetries.delete(key);
            } catch {
              // A failed settlement must not hold up other reservations. The
              // transaction journal retains signed bytes across retries/restarts.
              const attempts = (retry?.attempts ?? 0) + 1;
              this.settlementRetries.set(key, {
                attempts,
                retryAt:
                  Date.now() +
                  Math.min(3_600_000, 5000 * 2 ** Math.min(10, attempts))
              });
              console.error(
                JSON.stringify({
                  event: "evolution_settlement_retry",
                  domain,
                  randomnessId: id.toString(),
                  attempt: attempts
                })
              );
            }
          }
          if (batch.rows.length < 100) break;
        }
      }
    // Remove retry entries once the confirmed indexer no longer lists them.
    for (const key of this.settlementRetries.keys())
      if (!pendingSettlements.has(key)) this.settlementRetries.delete(key);
    let after = 0n;
    // Replay confirmed outstanding jobs each pass. No separate log poller or fragile intake cursor.
    for (;;) {
      const batch = await this.reader.jobs(after);
      if (
        (await this.chain.client.getBlock({ blockNumber: batch.block }))
          .hash !== batch.hash
      )
        throw new Error("Evolution indexer boundary is no longer canonical.");
      await this.chain.assertBindings(batch.block);
      for (const row of batch.rows) {
        const id = BigInt(String(row.value.requestId));
        after = id;
        if (row.value.renderingPolicy !== this.policy) continue;
        const binding = await this.chain.binding(id, batch.block);
        const job = await this.store.claim(id.toString(), binding, this.policy);
        if (!job) continue;
        try {
          await this.process(job);
        } catch {
          // Do not persist provider payloads, secrets or misleading completion states.
          await this.store.release(job);
          console.error(
            JSON.stringify({
              event: "evolution_job_retry",
              requestId: job.requestId,
              attempt: job.attempts,
              stage: job.progress.artifact
                ? "submission"
                : job.progress.holo
                  ? "metadata"
                  : job.progress.image
                    ? "holo"
                    : "generation"
            })
          );
        }
      }
      if (batch.rows.length < 100) break;
    }
  }
  async verify(job: EvolutionJob) {
    if (job.policy !== this.policy)
      throw new Error("Evolution rendering policy mismatch.");
    return this.reader.snapshot(async (_db, context) => {
      if (
        context.deployment !== this.store.deployment ||
        context.cards !== this.chain.cards.toLowerCase() ||
        context.adventures !== this.chain.adventures.toLowerCase() ||
        (await this.chain.client.getBlock({ blockNumber: context.block }))
          .hash !== context.hash
      )
        throw new Error("Evolution source changed.");
      const [request, binding] = await Promise.all([
        this.chain.request(BigInt(job.requestId), context.block),
        this.chain.binding(BigInt(job.requestId), context.block)
      ]);
      if (binding !== job.binding || !request.ready)
        throw new Error("Evolution binding changed.");
      if (
        (await this.chain.client.getBlock({ blockNumber: context.block }))
          .hash !== context.hash
      )
        throw new Error("Evolution source reorganized.");
      return { request, block: context.block };
    });
  }
  async process(job: EvolutionJob) {
    const id = BigInt(job.requestId);
    const { request, block } = await this.verify(job);
    if (request.completed) {
      await this.store.release(job, true);
      return;
    }
    const resultLevel =
      request.parentB !== 0n
        ? await this.chain.fusionLevel(request.parentA, request.parentB, block)
        : (await this.chain.history(request.parentA, block)).level;
    const singularityPolicy =
      resultLevel === 3
        ? await this.chain.assertSingularityPolicy(block)
        : undefined;
    if (
      (job.progress.prompt || job.progress.image || job.progress.artifact) &&
      job.progress.singularityPolicy !== singularityPolicy
    )
      throw new Error("Saved artwork uses a different Singularity policy.");
    if (!job.progress.parents || !job.progress.prompt) {
      const parents = await Promise.all(
        [request.parentA, request.parentB]
          .filter((v) => v !== 0n)
          .map((v) => this.chain.history(v, block))
      );
      if (singularityPolicy) job.progress.singularityPolicy = singularityPolicy;
      job.progress.parents = parents;
      job.progress.prompt = evolutionPrompt(
        parents,
        request.resultPresence,
        request.resultFinish,
        request.parentB === 0n ? request.dose : undefined,
        resultLevel
      );
      await this.store.save(job);
    }
    if (!job.progress.image) {
      const inputs = await Promise.all(
        [request.inputA, ...(request.parentB ? [request.inputB] : [])].map(
          (v) => this.assets.input(v.uri, v.hash)
        )
      );
      await this.verify(job);
      const generated = await this.ai.editImages(job.progress.prompt, inputs);
      const saved = await this.assets.put(generated.bytes, "png");
      job.progress.image = {
        ...saved,
        model: generated.model,
        usage: generated.usage
      };
      await this.store.save(job);
    }
    if (!job.progress.holo && !job.progress.artifact) {
      // Calibrate the completed artwork, never reuse masks from either parent.
      // A segmentation retry retains the already-paid image checkpoint.
      await this.verify(job);
      const image = await this.assets.input(
        job.progress.image.uri,
        job.progress.image.hash
      );
      const calibrated = await this.ai.calibrateHolo(image);
      job.progress.holo = {
        layers: await saveHoloLayers(
          this.assets,
          image,
          job.progress.image.hash,
          calibrated.geometry
        ),
        model: calibrated.model,
        usage: calibrated.usage
      };
      await this.store.save(job);
    }
    if (!job.progress.artifact) {
      const parents = job.progress.parents;
      const fusion = request.parentB !== 0n;
      const serum = fusion ? null : serumDefinition(request.dose);
      const level = resultLevel;
      const sources = (
        await Promise.all(
          [request.parentA, request.parentB]
            .filter((v) => v !== 0n)
            .map((v) => this.chain.sources(v, block))
        )
      ).flat();
      const metadata = await this.assets.putJson({
        name: serum
          ? `${serum.essence} ${serum.form} Yunipal`
          : level === 3
            ? "Yunipal Singularity"
            : `Yunipal Fusion · Level ${level}`,
        description:
          "A Yunipals trading card. Physical serum effects and immutable source ancestry are retained; Presence describes its current expression and bearing.",
        image: job.progress.image.uri,
        yunipals: { status: "ready", holo: job.progress.holo!.layers },
        attributes: [
          {
            trait_type: "Card kind",
            value: level === 3 ? "Singularity" : level ? "Fusion" : "Base"
          },
          { trait_type: "Fusion level", value: level },
          { trait_type: "Finish", value: cardFinishes[request.resultFinish] },
          {
            trait_type: "Presence",
            value: serumPresences[request.resultPresence]
          },
          {
            trait_type: "Local doses",
            value: fusion ? 0 : parents[0].doses.length + 1
          },
          ...(serum
            ? [
                { trait_type: "Latest essence", value: serum.essence },
                { trait_type: "Latest form", value: serum.form },
                { trait_type: "Serum rarity", value: serum.rarity }
              ]
            : [])
        ],
        evolution: {
          requestId: job.requestId,
          binding: job.binding,
          renderingPolicy: job.policy,
          ...(singularityPolicy ? { singularityPolicy } : {}),
          sources,
          parents,
          appliedDose: serum ? request.dose : null,
          finish: request.resultFinish,
          presence: request.resultPresence
        }
      });
      job.progress.artifact = {
        uri: job.progress.image.uri,
        hash: job.progress.image.hash,
        metadataURI: metadata.uri,
        metadataHash: metadata.hash
      };
      await this.store.save(job);
    }
    const current = await this.verify(job);
    if (current.request.completed) {
      await this.store.release(job, true);
      return;
    }
    // Recheck the live request as well: never submit a stale confirmed branch's result.
    if ((await this.chain.binding(id)) !== job.binding)
      throw new Error("Live evolution binding changed.");
    if (this.submit) {
      job.progress.transactionHash = await this.submit(
        id,
        job.binding,
        job.progress.artifact
      );
      await this.store.save(job);
    }
    await this.store.release(job);
  }
}
