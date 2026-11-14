import { SharedPortalLedger } from "../lib/portals/shared-ledger.js";
import { IndexedPortalJobs } from "../lib/portals/indexed-jobs.js";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  createWalletClient,
  defineChain,
  encodeFunctionData,
  keccak256,
  toHex,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portalModelPolicyHash } from "@protopals/yunipals-market-core/portals";
import { createPortalRuntime } from "../lib/portals/runtime.js";
import { OpenAIPortalAI } from "../lib/portals/provider.js";
import { PortalWorker } from "../lib/portals/worker.js";
import { PortalThemeWorker } from "../lib/portals/theme-worker.js";
import { portalCompetitionAbi } from "@protopals/yunipals-market-core/portalAbi";
import { configuredPortalWorkerPolicy } from "../lib/portals/policy.js";
import {
  portalRpcTransport,
  portalRpcUrls,
  portalLogBlockRange,
  verifyPortalRpcChains
} from "../lib/portals/rpc.js";
import {
  PgPortalTransactionJournal,
  PortalTransactionSender
} from "../lib/portals/transactions.js";
import { portalGradingAbi } from "@protopals/yunipals-market-core/portalAbi";
import {
  createPortalSchema,
  portalDatabaseSchema,
  grantPortalRoles,
  grantPortalPrivateRoles
} from "../lib/portals/database.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);

async function main() {
  if (process.argv.includes("--policy")) {
    const policy = configuredPortalWorkerPolicy(
      process.env.PORTALS_MODEL_POLICIES_JSON
    );
    console.log(
      JSON.stringify(
        {
          policy,
          hash: portalModelPolicyHash(policy),
          rubricId: keccak256(toHex(policy.rubric))
        },
        null,
        2
      )
    );
    return;
  }
  if (
    !process.argv.includes("--migrate") &&
    process.env.PORTALS_WORKER_ENABLED !== "true"
  )
    throw new Error(
      "The portal worker is disabled. Explicitly configure PORTALS_WORKER_ENABLED to start paid AI processing."
    );
  const runtime = await createPortalRuntime();
  try {
    if (process.argv.includes("--migrate")) {
      const schema = portalDatabaseSchema(process.env);
      const roles = {
        api: process.env.PORTALS_API_DATABASE_ROLE ?? "",
        worker: process.env.PORTALS_WORKER_DATABASE_ROLE ?? "",
        ledger: process.env.PORTALS_LEDGER_DATABASE_ROLE ?? ""
      };
      if (
        (runtime.ledger instanceof SharedPortalLedger
          ? [roles.api, roles.worker]
          : Object.values(roles)
        ).some((role) => !/^[a-z][a-z0-9_]{0,62}$/.test(role))
      )
        throw new Error(
          "Configure the three portal runtime role names before migration."
        );
      await createPortalSchema(runtime.db, schema);
      await runtime.store.migrate();
      if (runtime.ledger instanceof SharedPortalLedger)
        await grantPortalPrivateRoles(runtime.db, schema, roles);
      else {
        await runtime.ledger.migrate();
        await grantPortalRoles(runtime.db, schema, roles);
      }
      console.log("Portal database tables are ready.");
      return;
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key)
      throw new Error(
        "Load the existing OpenAI service configuration before starting the worker."
      );
    const policy = configuredPortalWorkerPolicy(
      process.env.PORTALS_MODEL_POLICIES_JSON
    );
    const provider = new OpenAIPortalAI(key, policy);
    const privateKey = process.env.PORTALS_GRADER_PRIVATE_KEY;
    const prepare = process.argv.includes("--prepare");
    if (!prepare && (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)))
      throw new Error(
        "The authorized grading wallet is required. Use --prepare to retain a result without submitting a transaction."
      );
    const network = defineChain({
      id: runtime.chain.deployment.chainId,
      name: "Yunipals portal chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.PORTALS_RPC_URL!] } }
    });
    const wallet = privateKey
      ? createWalletClient({
          account: privateKeyToAccount(privateKey as Hex),
          chain: network,
          // Sign through verified endpoints only, like the reads above.
          transport: portalRpcTransport(
            await verifyPortalRpcChains(
              portalRpcUrls(process.env),
              runtime.chain.deployment.chainId
            )
          )
        })
      : null;
    const feeCeiling = process.env.PORTALS_MAX_EXECUTION_FEE_WEI;
    if (
      wallet &&
      !prepare &&
      (!feeCeiling || !/^[1-9][0-9]*$/.test(feeCeiling))
    )
      throw new Error(
        "Configure PORTALS_MAX_EXECUTION_FEE_WEI before broadcasting worker transactions."
      );
    const sender =
      wallet && !prepare
        ? new PortalTransactionSender(
            new PgPortalTransactionJournal(runtime.db),
            runtime.chain.client,
            wallet,
            BigInt(process.env.PORTALS_CONFIRMATIONS ?? "12"),
            BigInt(feeCeiling!)
          )
        : null;
    if (wallet && !prepare) {
      const role = keccak256(toHex("GRADER_ROLE"));
      if (
        !(await runtime.chain.client.readContract({
          address: runtime.chain.deployment.grading,
          abi: portalGradingAbi,
          functionName: "hasRole",
          args: [role, wallet.account.address]
        }))
      )
        throw new Error(
          "The configured wallet does not have the grading role."
        );
      if (
        process.env.PORTALS_GRADER_ADDRESS &&
        wallet.account.address.toLowerCase() !==
          process.env.PORTALS_GRADER_ADDRESS.toLowerCase()
      )
        throw new Error(
          "The grading wallet does not match the configured address."
        );
      if (policy.competitionThemes) {
        const pool = await runtime.chain.client.readContract({
          address: runtime.chain.deployment.grading,
          abi: portalGradingAbi,
          functionName: "competition"
        });
        if (
          !(await runtime.chain.client.readContract({
            address: pool,
            abi: portalCompetitionAbi,
            functionName: "hasRole",
            args: [keccak256(toHex("THEME_ROLE")), wallet.account.address]
          }))
        )
          throw new Error(
            "The configured wallet does not have the competition theme role."
          );
      }
    }
    const start = BigInt(process.env.PORTALS_START_BLOCK ?? "0");
    if (start === 0n && process.env.PORTALS_ALLOW_LOCAL_CHAIN !== "true")
      throw new Error(
        "Set PORTALS_START_BLOCK to the verified grading deployment block."
      );
    const worker = new PortalWorker(
      runtime.chain,
      runtime.store,
      runtime.assets,
      provider,
      policy,
      start,
      BigInt(process.env.PORTALS_CONFIRMATIONS ?? "12"),
      sender
        ? (id, result) =>
            sender.send({
              operation: `grade:${runtime.chain.deployment.grading.toLowerCase()}:${id}:${result.requestBinding}`,
              to: runtime.chain.deployment.grading,
              data: encodeFunctionData({
                abi: portalGradingAbi,
                functionName: "complete",
                args: [id, result]
              })
            })
        : undefined,
      portalLogBlockRange(process.env),
      runtime.ledger instanceof SharedPortalLedger
        ? new IndexedPortalJobs(
            runtime.ledger,
            runtime.db,
            runtime.store,
            runtime.chain
          )
        : undefined
    );
    const themes = new PortalThemeWorker(
      runtime.chain,
      runtime.store,
      runtime.assets,
      provider,
      policy,
      BigInt(process.env.PORTALS_CONFIRMATIONS ?? "12"),
      sender && wallet
        ? async (theme) => {
            const { request } = await runtime.chain.client.simulateContract({
              address: theme.pool,
              abi: portalCompetitionAbi,
              functionName: "publishTheme",
              args: [
                theme.batchId,
                theme.sourcesHash,
                theme.artifactHash,
                theme.modelPolicy,
                theme.title,
                theme.brief,
                theme.uri
              ],
              account: wallet.account
            });
            return sender.send({
              operation: `theme:${theme.pool.toLowerCase()}:${theme.batchId}:${theme.sourcesHash}`,
              to: theme.pool,
              data: encodeFunctionData(request)
            });
          }
        : undefined,
      sender && wallet
        ? async (pool, id) => {
            const { request } = await runtime.chain.client.simulateContract({
              address: pool,
              abi: portalCompetitionAbi,
              functionName: "recordCompleted",
              args: [id],
              account: wallet.account
            });
            return sender.send({
              operation: `competition:${pool.toLowerCase()}:${id}`,
              to: pool,
              data: encodeFunctionData(request)
            });
          }
        : undefined,
      runtime.ledger instanceof SharedPortalLedger ? runtime.ledger : undefined
    );
    if (process.argv.includes("--once") || prepare) {
      await worker.tick();
      await themes.tick();
      console.log(
        prepare
          ? "Portal preparation pass finished."
          : "Portal worker pass finished."
      );
      return;
    }
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    process.once("SIGTERM", () => abort.abort());
    console.log("Portal grading worker started.");
    while (!abort.signal.aborted) {
      try {
        await worker.tick();
        await themes.tick();
      } catch {
        console.error(
          "Portal worker could not reach its chain or database; retrying."
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
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Portal worker failed."
  );
  process.exitCode = 1;
});
