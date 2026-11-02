import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { validateSharedIndexerDeployment } from "../lib/unified/shared-deployment.js";
import { verifySharedCanonicalHistory } from "../lib/unified/shared-parity.js";
import { evidenceRpc } from "../lib/unified/rpc.js";
import { manifestDigest } from "../lib/unified/sources.js";
import {
  runSharedIndexerObserver,
  sharedObserverEnvironment
} from "../lib/unified/shared-observer.js";

const { values } = parseArgs({
  options: {
    "output-directory": { type: "string" },
    "baseline-release": { type: "string" },
    "arena-baseline-release": { type: "string" }
  }
});
const output = values["output-directory"];
const file = process.env.UNIFIED_INDEXER_DEPLOYMENT_FILE;
if (
  !output?.startsWith("/") ||
  !file?.startsWith("/") ||
  !/^0x[0-9a-f]{64}$/.test(values["baseline-release"] ?? "") ||
  !/^0x[0-9a-f]{64}$/.test(values["arena-baseline-release"] ?? "")
)
  throw new Error(
    "Explicit deployment, output directory and both registered baselines required."
  );
const deployment = validateSharedIndexerDeployment(
  JSON.parse(await readFile(file, "utf8"))
);
const env = sharedObserverEnvironment(deployment, process.env);
if (
  manifestDigest(
    JSON.parse(await readFile(env.UNIFIED_RPC_PROFILE_FILE, "utf8"))
  ) !== manifestDigest(deployment.rpcProfile)
)
  throw new Error("Qualification profile differs from the prepared source.");
await mkdir(output, { recursive: true, mode: 0o700 });
const qualifiedFile = join(output, "qualified.json");
try {
  const previous = JSON.parse(await readFile(qualifiedFile, "utf8"));
  if (
    previous.releaseId !== deployment.releaseId ||
    previous.scope !== "public_source_ingestion" ||
    previous.format !== "yunipals-shared-source-qualification-v1" ||
    previous.main?.matched !== true ||
    previous.arena?.matched !== true ||
    previous.main?.currentReadinessRechecked !== true ||
    previous.arena?.currentReadinessRechecked !== true ||
    manifestDigest(previous.deployment) !== manifestDigest(deployment)
  )
    throw new Error("Qualification directory belongs to another source.");
  console.log(
    JSON.stringify({
      event: "shared_source_already_qualified",
      releaseId: deployment.releaseId
    })
  );
  process.exit(0);
} catch (error) {
  if (
    !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
  )
    throw error;
}
const pool = new pg.Pool({
  connectionString: process.env.UNIFIED_INDEXER_DATABASE_URL,
  ...(process.env.UNIFIED_INDEXER_DATABASE_URL
    ? {}
    : {
        host: "/var/run/postgresql",
        port: 5432,
        database: "yunipals_backfill",
        user: "yunipals_unified_support"
      }),
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  options: "-c default_transaction_read_only=on",
  application_name: "yunipals_shared_source_qualification"
});
const attempt = randomUUID();
let phase = "source-health";
const status = async (value: Record<string, unknown>) => {
  const row = {
    checkedAt: new Date().toISOString(),
    releaseId: deployment.releaseId,
    phase,
    ...value
  };
  const temporary = join(output, `.status-${attempt}.json`);
  await writeFile(temporary, JSON.stringify(row, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx"
  });
  await rename(temporary, join(output, "status.json"));
  console.log(JSON.stringify({ event: "shared_source_qualification", ...row }));
};
try {
  const checking = {
    status: "checking",
    consumersSwitched: false,
    privateJobsChanged: false
  };
  await status(checking);
  await runSharedIndexerObserver(pool, deployment, "health", env);
  phase = "main-history";
  await status(checking);
  const main = await verifySharedCanonicalHistory(
    pool,
    values["baseline-release"]!,
    deployment
  );
  phase = "arena-history";
  await status(checking);
  const arena = await verifySharedCanonicalHistory(
    pool,
    values["arena-baseline-release"]!,
    deployment,
    {
      archivedArenaBaseline: true,
      canonicalHash: async (chainId, block) =>
        (await evidenceRpc(chainId, env).block(block)).hash
    }
  );
  const result = {
    format: "yunipals-shared-source-qualification-v1",
    scope: "public_source_ingestion",
    checkedAt: new Date().toISOString(),
    releaseId: deployment.releaseId,
    deployment,
    main,
    arena,
    consumersSwitched: false,
    privateJobsChanged: false,
    ownerTransactionsSubmitted: 0
  };
  await writeFile(
    join(output, `accepted-${attempt}.json`),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600, flag: "wx" }
  );
  await writeFile(qualifiedFile, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx"
  });
  await status({
    status: "qualified",
    consumersSwitched: false,
    privateJobsChanged: false
  });
} catch (error) {
  const waiting =
    phase === "source-health" &&
    error instanceof Error &&
    error.message === "shared_source_unhealthy";
  await status({
    status: waiting ? "waiting-for-native-catchup" : "needs-attention",
    failureCode: waiting
      ? "shared_source_unhealthy"
      : error instanceof Error &&
          error.message.startsWith("Canonical history differs for ")
        ? "canonical_history_mismatch"
        : "qualification_refused",
    consumersSwitched: false,
    privateJobsChanged: false
  });
  if (!waiting) process.exitCode = 1;
} finally {
  await pool.end();
}
