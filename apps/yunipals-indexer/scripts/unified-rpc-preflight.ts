import { buildSourceManifest } from "../lib/unified/sources.js";
import { preflightUnifiedRpc } from "../lib/unified/rpc-preflight.js";
import { unifiedRpcProfileId } from "../../../packages/yunipals-indexer-server/src/rpc-policy.js";

try {
  const result = await preflightUnifiedRpc(buildSourceManifest(), {
    ...process.env,
    UNIFIED_RPC_POLICY_REQUIRED: "true"
  });
  if (!result) throw new Error("Reviewed profile required.");
  console.log(
    JSON.stringify({
      event: "unified_rpc_preflight_passed",
      profileId: unifiedRpcProfileId(result.profile),
      historicalReads: 0,
      diagnostics: result.diagnostics
    })
  );
} catch {
  console.error(
    "Unified RPC preflight failed; verify the reviewed profile, explicit proxies, background allocations and upstream chain identity."
  );
  process.exitCode = 1;
}
