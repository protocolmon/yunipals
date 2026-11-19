import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import {
  createWalletClient,
  defineChain,
  encodeFunctionData,
  keccak256,
  toHex,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  adventureAbi,
  evolutionAbi
} from "@protopals/yunipals-market-core/evolutionAbi";
import { configuredPortalWorkerPolicy } from "../lib/portals/policy.js";
import {
  portalDatabaseOptions,
  portalSqlIdentifier,
  portalDatabaseSchema
} from "../lib/portals/database.js";
import { OpenAIPortalAI } from "../lib/portals/provider.js";
import {
  PgPortalTransactionJournal,
  PortalTransactionSender,
  portalTransactionSchema
} from "../lib/portals/transactions.js";
import {
  portalRpcTransport,
  portalRpcUrls,
  verifyPortalRpcChains
} from "../lib/portals/rpc.js";
import { createEvolutionRuntime } from "../lib/evolution/runtime.js";
import {
  evolutionRenderingHash,
  evolutionRenderingPolicy
} from "../lib/evolution/art.js";
import { evolutionWorkerSchema } from "../lib/evolution/store.js";
import { EvolutionWorker } from "../lib/evolution/worker.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);
async function main() {
  const policy = configuredPortalWorkerPolicy(
    process.env.PORTALS_MODEL_POLICIES_JSON
  );
  if (process.argv.includes("--policy")) {
    console.log(
      JSON.stringify(
        {
          hash: evolutionRenderingHash(policy),
          policy: evolutionRenderingPolicy(policy)
        },
        null,
        2
      )
    );
    return;
  }
  if (process.argv.includes("--migrate")) {
    const db = new pg.Pool(portalDatabaseOptions(process.env));
    try {
      await db.query(evolutionWorkerSchema);
      await db.query(portalTransactionSchema);
      const table = `${portalSqlIdentifier(portalDatabaseSchema(process.env))}.evolution_v1_job`;
      const worker = portalSqlIdentifier(
        process.env.PORTALS_WORKER_DATABASE_ROLE ?? ""
      );
      await db.query(`REVOKE ALL ON ${table} FROM PUBLIC`);
      await db.query(`GRANT SELECT,INSERT,UPDATE ON ${table} TO ${worker}`);
      console.log("Evolution worker migration complete.");
    } finally {
      await db.end();
    }
    return;
  }
  if (process.env.EVOLUTION_WORKER_ENABLED !== "true")
    throw new Error(
      "Enable EVOLUTION_WORKER_ENABLED explicitly before paid processing."
    );
  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw new Error(
      "Load the existing portal AI configuration before starting evolution."
    );
  const runtime = await createEvolutionRuntime();
  try {
    if (
      (await runtime.chain.client.readContract({
        address: runtime.chain.evolution,
        abi: evolutionAbi,
        functionName: "renderingPolicy"
      })) !== evolutionRenderingHash(policy)
    )
      throw new Error(
        "The configured image policy does not match the evolution contract."
      );
    const provider = new OpenAIPortalAI(key, policy);
    const prepare = process.argv.includes("--prepare");
    let sender: PortalTransactionSender | undefined;
    if (!prepare) {
      const privateKey = process.env.PORTALS_GRADER_PRIVATE_KEY;
      const fee = process.env.PORTALS_MAX_EXECUTION_FEE_WEI;
      if (
        !privateKey ||
        !/^0x[0-9a-fA-F]{64}$/.test(privateKey) ||
        !fee ||
        !/^[1-9][0-9]*$/.test(fee)
      )
        throw new Error(
          "Existing portal signer and execution fee ceiling are required."
        );
      const urls = await verifyPortalRpcChains(
        portalRpcUrls(process.env),
        runtime.portal.chain.deployment.chainId
      );
      const chain = defineChain({
        id: runtime.portal.chain.deployment.chainId,
        name: "Yunipals",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: urls } }
      });
      const wallet = createWalletClient({
        chain,
        account: privateKeyToAccount(privateKey as Hex),
        transport: portalRpcTransport(urls)
      });
      if (
        !(await runtime.chain.client.readContract({
          address: runtime.chain.evolution,
          abi: evolutionAbi,
          functionName: "hasRole",
          args: [keccak256(toHex("GENERATOR_ROLE")), wallet.account.address]
        }))
      )
        throw new Error(
          "Existing portal signer requires GENERATOR_ROLE on evolution."
        );
      sender = new PortalTransactionSender(
        new PgPortalTransactionJournal(runtime.portal.db),
        runtime.chain.client,
        wallet,
        12n,
        BigInt(fee)
      );
    }
    const worker = new EvolutionWorker(
      runtime.reader,
      runtime.chain,
      runtime.store,
      runtime.assets,
      provider,
      sender
        ? (id, binding, artifact) =>
            sender!.send({
              operation: `evolve:${runtime.chain.evolution.toLowerCase()}:${id}:${binding}`,
              to: runtime.chain.evolution,
              data: encodeFunctionData({
                abi: evolutionAbi,
                functionName: "complete",
                args: [id, binding, artifact]
              })
            })
        : undefined,
      sender
        ? (kind, id) =>
            sender!.send({
              operation: `settle:${kind}:${runtime.chain.evolution.toLowerCase()}:${id}`,
              to:
                kind === "adventure"
                  ? runtime.chain.adventures
                  : runtime.chain.evolution,
              data:
                kind === "adventure"
                  ? encodeFunctionData({
                      abi: adventureAbi,
                      functionName: "settle",
                      args: [id]
                    })
                  : encodeFunctionData({
                      abi: evolutionAbi,
                      functionName: "settlePresence",
                      args: [id]
                    })
            })
        : undefined
    );
    if (prepare || process.argv.includes("--once")) {
      await worker.tick();
      return;
    }
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    process.once("SIGTERM", () => abort.abort());
    while (!abort.signal.aborted) {
      try {
        await worker.tick();
      } catch {
        console.error(
          "Evolution worker awaiting canonical chain/indexer/database availability."
        );
      }
      await delay(5000, undefined, { signal: abort.signal }).catch((error) => {
        if (!abort.signal.aborted) throw error;
      });
    }
  } finally {
    await runtime.close();
  }
}
main().catch(() => {
  console.error(
    "Evolution worker could not start. Verify the configured policy, bindings, roles and service availability."
  );
  process.exitCode = 1;
});
