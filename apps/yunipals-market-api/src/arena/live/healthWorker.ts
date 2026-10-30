import { mkdir, rename, writeFile } from "node:fs/promises";
import pg from "pg";
import { isAddress, type Address } from "viem";
import { arenaNativeConfiguration } from "./nativeSource";
import { selectedArenaRuntimeSource } from "./selectedSourceRuntime";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { arenaHealth } from "./health";
import {
  arenaDeploymentId,
  arenaVersion
} from "@protopals/yunipals-market-core/arenaProtocol";

const contract = process.env.ARENA_CONTRACT;
if (!contract || !isAddress(contract) || !process.env.ARENA_DATABASE_URL)
  throw new Error("Arena monitor deployment configuration is required.");
const version = arenaVersion(process.env.ARENA_CONTRACT_VERSION);
const kind = process.env.ARENA_MEDIA_KIND ?? "video";
if (kind !== "video" && kind !== "anime")
  throw new Error("Invalid Arena monitor mode.");
const deployment = arenaDeploymentId(contract, kind, version);
const pool = new pg.Pool({
  connectionString: process.env.ARENA_DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
  application_name: "yunipals_arena_monitor"
});
const native = arenaNativeConfiguration();
const sourcePool =
  native.mode === "unified"
    ? new pg.Pool({
        connectionString: native.databaseUrl,
        max: 1,
        connectionTimeoutMillis: 2000,
        statement_timeout: 5000,
        options: "-c default_transaction_read_only=on"
      })
    : undefined;
const directory =
  version === 2
    ? `/var/lib/yunipals-arena-modes/${kind}/health`
    : "/var/lib/yunipals-arena/health";
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let service: ArenaIntake | undefined;
  if (native.mode === "unified") {
    if (!/^[1-9][0-9]*$/.test(process.env.ARENA_DEPLOYMENT_BLOCK ?? ""))
      throw new Error("Monitor deployment block required.");
    // Monitoring is DB-only. Rollback endpoint anchoring belongs to its normal
    // actor; this monitor refuses it rather than generating hidden RPC traffic.
    const { nativeSource, binding } = await selectedArenaRuntimeSource({
      pool,
      sourcePool,
      native,
      deployment: {
        id: deployment,
        contractVersion: version,
        contract: contract as Address,
        startBlock: BigInt(process.env.ARENA_DEPLOYMENT_BLOCK!)
      },
      mediaKind: kind,
      base: {
        getChainId: async () => {
          throw new Error("Monitor has no RPC.");
        },
        getBlock: async () => {
          throw new Error("Monitor has no RPC.");
        }
      }
    });
    service = new ArenaIntake(
      pool,
      deployment,
      contract as Address,
      "https://www.yunipals.com",
      new StrategyCipher(Buffer.alloc(32)),
      { message: async () => false, strategy: async () => false },
      nativeSource,
      binding,
      kind,
      version
    );
  }
  const value = await arenaHealth(
    pool,
    deployment,
    process.env.ARENA_ENTRIES_ENABLED === "true",
    service
  );
  const temporary = `${directory}/.status-${process.pid}.json`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx"
  });
  await rename(temporary, `${directory}/status.json`);
  console.log(
    JSON.stringify({
      status: value.status,
      issues: value.issues,
      externalRequests: 0
    })
  );
  if (value.status === "needs-attention") process.exitCode = 1;
} catch {
  console.error(
    "Arena operational health check failed; private database details suppressed."
  );
  process.exitCode = 1;
} finally {
  await Promise.all([pool.end(), sourcePool?.end()]);
}
