import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  unifiedRpcManifestId,
  unifiedRpcProfileId,
  validateUnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy.js";
import { manifestDigest } from "../../../packages/yunipals-indexer-server/src/identity.js";

const { values } = parseArgs({
  options: { file: { type: "string" }, apply: { type: "string" } }
});
if (!values.file?.startsWith("/"))
  throw new Error("Use --file with an absolute reviewed policy input path.");
const input = JSON.parse(await readFile(values.file, "utf8"));
if (
  Object.keys(input).sort().join() !==
  ["profile", "expiresAt", "permits"].sort().join()
)
  throw new Error("Invalid RPC review input.");
const profile = validateUnifiedRpcProfile(input.profile);
const profileId = unifiedRpcProfileId(profile);
const now = Date.now();
const expiry = (value: unknown, maximum: number) => {
  if (
    typeof value !== "string" ||
    new Date(value).toISOString() !== value ||
    Date.parse(value) <= now ||
    Date.parse(value) > now + maximum
  )
    throw new Error("Invalid RPC approval expiry.");
};
expiry(input.expiresAt, 30 * 86400000);
if (!Array.isArray(input.permits) || input.permits.length > 4)
  throw new Error("Invalid replay permit count.");
const chains = new Set<number>();
for (const permit of input.permits) {
  if (
    Object.keys(permit).sort().join() !==
      [
        "permitId",
        "chainId",
        "fromBlock",
        "throughBlock",
        "maximumCu",
        "expiresAt"
      ]
        .sort()
        .join() ||
    !/^0x[0-9a-f]{64}$/.test(permit.permitId) ||
    chains.has(permit.chainId) ||
    !/^(0|[1-9][0-9]*)$/.test(permit.fromBlock) ||
    !/^(0|[1-9][0-9]*)$/.test(permit.throughBlock) ||
    BigInt(permit.throughBlock) < BigInt(permit.fromBlock) ||
    BigInt(permit.throughBlock) > 9223372036854775807n ||
    !Number.isSafeInteger(permit.maximumCu) ||
    permit.maximumCu < 1 ||
    permit.maximumCu > 1000000000 ||
    !profile.manifest.sources.some(
      (source) => source.enabled && source.chainId === permit.chainId
    )
  )
    throw new Error("Invalid bounded RPC permit.");
  expiry(permit.expiresAt, 86400000);
  if (Date.parse(permit.expiresAt) > Date.parse(input.expiresAt))
    throw new Error("Permit outlives profile.");
  chains.add(permit.chainId);
}
const connectionString = process.env.UNIFIED_RPC_REVIEW_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "UNIFIED_RPC_REVIEW_DATABASE_URL is required; use an operator migration role."
  );
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000
});
try {
  const policy = (
    await pool.query(
      `SELECT c.coordinator_id::text,b.enabled,b.daily_cu::text,b.foreground_reserve_cu::text,
    (SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text) ORDER BY workload)
     FROM yunipals_market.rpc_compute_allocation WHERE scope=$1 AND workload IN ('unified_source','unified_evidence')) AS allocations
    FROM yunipals_market.opensea_request_budget c JOIN yunipals_market.rpc_compute_budget b USING(scope)
    WHERE c.scope=$1 AND c.enabled`,
      [profile.scope]
    )
  ).rows[0];
  if (
    !policy ||
    policy.coordinator_id !== profile.coordinatorId ||
    !policy.enabled ||
    policy.allocations?.length !== 2 ||
    policy.allocations.some(
      (row: { priority: string }) => row.priority !== "background"
    )
  )
    throw new Error(
      "Reviewed coordinator and background budgets must already be provisioned and enabled."
    );
  const reviewHash = manifestDigest({ input, policy });
  console.log(
    JSON.stringify({
      event: "unified_rpc_policy_review",
      reviewHash,
      profileId,
      manifestHash: unifiedRpcManifestId(profile),
      policy,
      permits: input.permits,
      applied: false
    })
  );
  if (values.apply) {
    if (values.apply !== reviewHash)
      throw new Error(
        "RPC review hash changed; review the current input and budget again."
      );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(178858,9028)");
      // INSERT-only approval. Reusing an identity never resets its counters.
      await client.query(
        `INSERT INTO yunipals_market.unified_rpc_profile(profile_id,scope,manifest_hash,policy,enabled,expires_at)
        VALUES($1,$2,$3,$4::jsonb,true,$5) ON CONFLICT DO NOTHING`,
        [
          profileId,
          profile.scope,
          unifiedRpcManifestId(profile),
          JSON.stringify(profile),
          input.expiresAt
        ]
      );
      const retained = (
        await client.query(
          "SELECT scope,manifest_hash,policy,enabled,expires_at FROM yunipals_market.unified_rpc_profile WHERE profile_id=$1 FOR UPDATE",
          [profileId]
        )
      ).rows[0];
      if (
        !retained ||
        retained.scope !== profile.scope ||
        !retained.enabled ||
        unifiedRpcProfileId(retained.policy) !== profileId ||
        retained.expires_at.toISOString() !== input.expiresAt
      )
        throw new Error(
          "Existing profile approval differs; use a newly reviewed identity."
        );
      for (const permit of input.permits) {
        await client.query(
          `INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT DO NOTHING`,
          [
            permit.permitId,
            profileId,
            permit.chainId,
            permit.fromBlock,
            permit.throughBlock,
            permit.maximumCu,
            permit.expiresAt
          ]
        );
        const stored = (
          await client.query(
            "SELECT * FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1 FOR UPDATE",
            [permit.permitId]
          )
        ).rows[0];
        if (
          !stored ||
          stored.profile_id !== profileId ||
          stored.chain_id !== permit.chainId ||
          stored.from_block !== permit.fromBlock ||
          stored.through_block !== permit.throughBlock ||
          stored.maximum_cu !== String(permit.maximumCu) ||
          !stored.enabled ||
          stored.expires_at.toISOString() !== permit.expiresAt
        )
          throw new Error(
            "Existing permit differs; counters cannot be reset by review."
          );
      }
      await client.query("COMMIT");
      console.log(
        JSON.stringify({
          event: "unified_rpc_policy_approved",
          reviewHash,
          profileId
        })
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} catch {
  console.error("Unified RPC review failed; no provider call was made.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
