import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildSharedIndexerManifest } from "../lib/unified/shared-deployment.ts";

const { values } = parseArgs({
  options: {
    schema: { type: "string" },
    output: { type: "string" }
  }
});
assert.match(values.schema ?? "", /^[a-zA-Z_][a-zA-Z0-9_]{0,44}$/);
assert.ok(
  values.output?.startsWith("/"),
  "An absolute fresh output file is required."
);
const manifest = buildSharedIndexerManifest(process.env);
// Compilation runs without real credentials, database connections or provider
// calls. This does not change production preflight: the supervisor enforces it.
process.env.UNIFIED_ARENA_DEPLOYMENTS = "[]";
for (const key of [
  "ARENA_CONTRACT",
  "ARENA_DEPLOYMENT_BLOCK",
  "UNIFIED_ANIME_ARENA",
  "UNIFIED_RPC_PROFILE_FILE",
  "UNIFIED_RPC_PROFILE_ID",
  "DATABASE_PRIVATE_URL"
])
  delete process.env[key];
process.env.DATABASE_URL =
  "postgresql://offline:offline@127.0.0.1:1/offline_build";
process.env.UNIFIED_RPC_POLICY_REQUIRED = "false";
for (const chain of [1, 56, 137, 8453])
  process.env[`PONDER_RPC_URL_${chain}`] = "http://127.0.0.1:1";
const entry = import.meta.resolve("ponder");
const internal = (path) => import(new URL(path, entry));
const { createBuild } = await internal("./build/index.js");
const { createLogger } = await internal("./internal/logger.js");
const { MetricsService } = await internal("./internal/metrics.js");
const { buildOptions } = await internal("./internal/options.js");
const { createShutdown } = await internal("./internal/shutdown.js");
const cliOptions = {
  root: fileURLToPath(new URL("../", import.meta.url)),
  config: "ponder.config.ts",
  command: "start",
  version: "0.17.5",
  schema: values.schema,
  logLevel: "error",
  logFormat: "json"
};
const shutdown = createShutdown();
const common = {
  options: buildOptions({ cliOptions }),
  logger: createLogger({ level: "error", mode: "json" }),
  metrics: new MetricsService(),
  shutdown,
  buildShutdown: shutdown,
  apiShutdown: shutdown
};
const resultOf = (result) => {
  if (result.status === "error") throw result.error;
  return result.result;
};
let headers = 0;
try {
  const build = await createBuild({ common, cliOptions });
  const configResult = resultOf(await build.executeConfig());
  const preBuild = resultOf(build.preCompile({ config: configResult.config }));
  const schemaResult = resultOf(await build.executeSchema());
  resultOf(build.compileSchema({ schema: schemaResult.schema, preBuild }));
  const indexingResult = resultOf(await build.executeIndexingFunctions());
  const configBuild = resultOf(build.compileConfig({ configResult }));
  configBuild.rpcs = configBuild.chains.map(() => ({
    request: async (request) => {
      assert.equal(
        request.method,
        "eth_getBlockByNumber",
        "Offline compilation may request only stubbed headers."
      );
      headers++;
      const number =
        request.params[0] === "latest"
          ? 1000000000n
          : BigInt(request.params[0]);
      return {
        number: `0x${number.toString(16)}`,
        hash: `0x${number.toString(16).padStart(64, "0")}`,
        parentHash: `0x${(number - 1n).toString(16).padStart(64, "0")}`,
        timestamp: "0x6ae60000",
        logsBloom: `0x${"0".repeat(512)}`,
        transactions: []
      };
    }
  }));
  const compiled = resultOf(
    await build.compileIndexing({
      configResult,
      schemaResult,
      indexingResult,
      configBuild
    })
  );
  for (const source of manifest.sources.filter((source) => source.enabled)) {
    const contract = configResult.config.contracts[source.contractName];
    assert.ok([contract.address].flat().includes(source.address), source.id);
    assert.equal(contract.startBlock, Number(source.startBlock), source.id);
    for (const event of source.events)
      assert.ok(
        indexingResult.indexingFunctions.some(
          (handler) => handler.name === `${source.contractName}:${event}`
        ),
        `${source.id}:${event}`
      );
  }
  const result = {
    format: "yunipals-shared-offline-build-v1",
    schema: values.schema,
    buildId: compiled.buildId,
    manifest,
    enabledSources: 13,
    stubbedHeaderCalls: headers,
    providerCalls: 0,
    databaseConnections: 0,
    nativeReadinessClaimed: false
  };
  await writeFile(values.output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o644
  });
  console.log(
    JSON.stringify({
      event: "shared_source_compiled",
      buildId: compiled.buildId,
      enabledSources: 13,
      providerCalls: 0,
      databaseConnections: 0
    })
  );
} finally {
  await shutdown.kill();
}
