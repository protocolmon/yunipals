import { evolutionAbi } from "@protopals/yunipals-market-core/evolutionAbi";
import pg from "pg";
import type { Address } from "viem";
import { EvolutionReader } from "../../../../packages/yunipals-indexer-server/src/evolution.js";
import { createPortalRuntime } from "../portals/runtime.js";
import { PortalAssets } from "../portals/assets.js";
import { EvolutionChain } from "./chain.js";
import { EvolutionStore } from "./store.js";

export async function createEvolutionRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  if (
    env.EVOLUTION_ENABLED !== "true" ||
    env.PORTALS_INDEXER_MODE !== "unified" ||
    !env.PORTALS_INDEXER_DATABASE_URL
  )
    throw new Error(
      "Evolution requires the enabled global indexer configuration."
    );
  const portal = await createPortalRuntime(env);
  const pool = new pg.Pool({
    connectionString: env.PORTALS_INDEXER_DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000
  });
  try {
    const reader = new EvolutionReader(pool, env.PORTALS_INDEXER_RELEASE_ID);
    const context = await reader.snapshot(async (_db, context) => context);
    if (context.cards !== portal.chain.deployment.cards.toLowerCase())
      throw new Error("Evolution and portal collection mismatch.");
    const chain = new EvolutionChain(
      portal.chain.client,
      context.cards as Address,
      context.evolution as Address,
      context.adventures as Address,
      portal.chain.deployment.grading
    );
    await chain.assertBindings(context.block);
    const usdc = await chain.client.readContract({
      address: chain.evolution,
      abi: evolutionAbi,
      functionName: "usdc",
      blockNumber: context.block
    });
    if (usdc.toLowerCase() !== portal.chain.deployment.usdc.toLowerCase())
      throw new Error("Evolution and portal payment token mismatch.");
    const assets = new PortalAssets(
      portal.assets.directory,
      portal.assets.origin,
      portal.assets.allowedHosts,
      portal.assets.ipfsGateway,
      portal.assets.sharedRead,
      "/v1/evolution/assets"
    );
    return {
      portal,
      reader,
      chain,
      assets,
      store: new EvolutionStore(portal.db, context.deployment),
      close: async () => {
        await Promise.all([pool.end(), portal.close()]);
      }
    };
  } catch (error) {
    await Promise.all([pool.end(), portal.close()]);
    throw error;
  }
}
export type EvolutionRuntime = Awaited<
  ReturnType<typeof createEvolutionRuntime>
>;
