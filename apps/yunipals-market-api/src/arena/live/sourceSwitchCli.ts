import { parseArgs } from "node:util";
import pg from "pg";
import { createPublicClient, http, isAddress, type PublicClient } from "viem";
import { base } from "viem/chains";
import { rpcBudgetProxyUrl } from "@/rpcBudgetProxyRegistry";
import { ArenaRollbackSource, arenaRollbackSourceId } from "./rollbackSource";
import { NativeArenaSource, arenaNativeConfiguration } from "./nativeSource";
import { ArenaSourceSwitch, arenaSourceSwitchVerifier } from "./sourceSwitch";
import {
  assertArenaSourceBinding,
  selectedArenaSource
} from "./sourceSelection";

// No strategy encryption key, wallet, signer file or provider configuration is
// loaded. Database selectors are environment-variable names, never CLI secrets.
async function run() {
  const { values } = parseArgs({
    options: {
      "target-kind": { type: "string" },
      "target-database-env": { type: "string" },
      "target-release-id": { type: "string" },
      "minimum-block": { type: "string" },
      "minimum-hash": { type: "string" },
      apply: { type: "string" }
    }
  });
  const current = arenaNativeConfiguration(),
    contract = process.env.ARENA_CONTRACT?.toLowerCase(),
    start = process.env.ARENA_DEPLOYMENT_BLOCK,
    operationalUrl = process.env.ARENA_DATABASE_URL,
    targetEnv = values["target-database-env"];
  if (
    current.mode !== "unified" ||
    !contract ||
    !isAddress(contract) ||
    !start ||
    !/^[1-9][0-9]*$/.test(start) ||
    !operationalUrl ||
    !targetEnv ||
    !/^[A-Z][A-Z0-9_]*$/.test(targetEnv) ||
    !process.env[targetEnv] ||
    !["unified", "legacy_rollback"].includes(values["target-kind"] ?? "") ||
    !values["minimum-block"] ||
    !/^(0|[1-9][0-9]*)$/.test(values["minimum-block"]) ||
    !values["minimum-hash"] ||
    !/^0x[0-9a-f]{64}$/.test(values["minimum-hash"])
  )
    throw new Error(
      "Explicit source selectors and last accepted block/hash are required."
    );
  const kind = values["target-kind"] as "unified" | "legacy_rollback",
    targetUrl = process.env[targetEnv]!;
  const targetId =
    kind === "legacy_rollback"
      ? arenaRollbackSourceId(targetUrl, contract, BigInt(start))
      : values["target-release-id"];
  if (!targetId || !/^0x[0-9a-f]{64}$/.test(targetId))
    throw new Error("A pinned target release identity is required.");
  const options = {
    max: 2,
    connectionTimeoutMillis: 2000,
    statement_timeout: 10000,
    lock_timeout: 1000,
    idle_in_transaction_session_timeout: 15000
  };
  const pool = new pg.Pool({
      ...options,
      connectionString: operationalUrl,
      application_name: "arena_source_switch"
    }),
    sourcePool = new pg.Pool({
      ...options,
      connectionString: targetUrl,
      application_name: "arena_source_switch_read",
      options: "-c default_transaction_read_only=on"
    });
  try {
    const deployment = `8453:${contract}`,
      selected = await selectedArenaSource(pool, deployment);
    if (
      selected &&
      (selected.kind !== current.sourceKind ||
        selected.source_id !== current.releaseId)
    )
      throw new Error("Current Arena selectors differ from the saved epoch.");
    const [operational, source] = await Promise.all([
      pool.query(
        "SELECT current_database() AS db,inet_server_addr()::text AS host,inet_server_port() AS port"
      ),
      sourcePool.query(
        "SELECT current_database() AS db,inet_server_addr()::text AS host,inet_server_port() AS port"
      )
    ]);
    if (
      kind === "legacy_rollback" &&
      JSON.stringify(operational.rows[0]) === JSON.stringify(source.rows[0])
    )
      throw new Error(
        "Arena rollback requires an isolated public projection database."
      );
    const client = createPublicClient({
      chain: base,
      transport: http(rpcBudgetProxyUrl("base", "production"), {
        retryCount: 0,
        timeout: 15000
      })
    }) as PublicClient;
    const minimum = {
      block: values["minimum-block"],
      hash: values["minimum-hash"]
    };
    const sourceReader =
      kind === "legacy_rollback"
        ? new ArenaRollbackSource(
            sourcePool,
            targetId,
            contract,
            BigInt(start),
            minimum,
            client
          )
        : new NativeArenaSource(sourcePool, targetId, contract, BigInt(start));
    const binding = selected
      ? {
          epoch: selected.epoch,
          kind: selected.kind,
          sourceId: selected.source_id
        }
      : undefined;
    const service = {
      pool,
      deployment,
      // Presence marks compatible consumer semantics, not the target source.
      nativeSource: { read: sourceReader.read.bind(sourceReader) },
      assertSourceSelection: async (
        db: Pick<pg.PoolClient, "query"> = pool
      ) => {
        const mode = (
          await db.query<{ indexer_mode: string }>(
            "SELECT indexer_mode FROM yunipals_arena.deployment WHERE id=$1",
            [deployment]
          )
        ).rows[0];
        if (mode?.indexer_mode !== "unified")
          throw new Error("Arena compatibility consumers are not selected.");
        await assertArenaSourceBinding(db, deployment, binding);
      }
    };
    const change = new ArenaSourceSwitch(
      service,
      { kind, sourceId: targetId, source: sourceReader },
      client,
      arenaSourceSwitchVerifier(client),
      minimum
    );
    console.log(
      JSON.stringify({
        event: "arena_source_switch",
        ...(await change.run(values.apply))
      })
    );
  } finally {
    await Promise.allSettled([pool.end(), sourcePool.end()]);
  }
}
try {
  await run();
} catch {
  console.error(
    "Arena source switch refused. Check halted consumers, source epoch, isolated caught-up coverage, canonical origin/input state, accepted block/hash and exact review hash. Private state was not restored or reassigned."
  );
  process.exitCode = 1;
}
