import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  sharedIndexerConsumerSettings,
  validateSharedIndexerDeployment
} from "../lib/unified/shared-deployment.js";
import { verifySharedCanonicalHistory } from "../lib/unified/shared-parity.js";
import { evidenceRpc } from "../lib/unified/rpc.js";
import { manifestDigest } from "../lib/unified/sources.js";

const { values } = parseArgs({
  options: {
    deployment: { type: "string" },
    "baseline-release": { type: "string" },
    "archived-arena-baseline": { type: "boolean", default: false },
    output: { type: "string" }
  }
});
if (
  !values.deployment?.startsWith("/") ||
  !values.output?.startsWith("/") ||
  !/^0x[0-9a-f]{64}$/.test(values["baseline-release"] ?? "") ||
  !process.env.UNIFIED_INDEXER_DATABASE_URL
)
  throw new Error(
    "Explicit deployment, baseline release, database and fresh output paths are required."
  );
const pool = new pg.Pool({
  connectionString: process.env.UNIFIED_INDEXER_DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  application_name: "yunipals_shared_parity",
  options: "-c default_transaction_read_only=on"
});
try {
  const deployment = validateSharedIndexerDeployment(
    JSON.parse(await readFile(values.deployment, "utf8"))
  );
  let canonicalHash:
    | ((chainId: number, block: bigint) => Promise<string>)
    | undefined;
  if (values["archived-arena-baseline"]) {
    const file = process.env.UNIFIED_RPC_PROFILE_FILE;
    if (
      !file?.startsWith("/") ||
      manifestDigest(JSON.parse(await readFile(file, "utf8"))) !==
        manifestDigest(deployment.rpcProfile)
    )
      throw new Error(
        "Archived parity requires the exact reviewed RPC profile file."
      );
    const env = {
      ...sharedIndexerConsumerSettings(deployment),
      UNIFIED_RPC_PROFILE_FILE: file
    };
    canonicalHash = async (chainId, block) =>
      (await evidenceRpc(chainId, env).block(block)).hash;
  }
  const result = await verifySharedCanonicalHistory(
    pool,
    values["baseline-release"]!,
    deployment,
    {
      archivedArenaBaseline: values["archived-arena-baseline"],
      canonicalHash
    }
  );
  await writeFile(values.output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o644
  });
  console.log(
    JSON.stringify({
      event: "shared_indexer_parity_verified",
      sources: result.sources.length,
      targetReleaseId: result.targetReleaseId
    })
  );
} catch {
  console.error(
    "Shared source parity refused; verify canonical coverage, branch, observations and complete journal equality."
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
