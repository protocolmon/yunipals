import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { buildSourceManifest } from "../lib/unified/sources.js";
import { buildSharedIndexerManifest } from "../lib/unified/shared-deployment.js";
import {
  unifiedRpcManifestId,
  unifiedRpcProfileId,
  validateUnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy.js";

const { values } = parseArgs({
  options: {
    scope: { type: "string" },
    "coordinator-id": { type: "string" },
    output: { type: "string" },
    shared: { type: "boolean", default: false },
    "endpoint-base-port": { type: "string" },
    "log-range": { type: "string", default: "500" }
  }
});
if (!values.output?.startsWith("/"))
  throw new Error("An absolute draft output path is required.");
const basePort =
  values["endpoint-base-port"] === undefined
    ? null
    : Number(values["endpoint-base-port"]);
if (
  basePort !== null &&
  (!Number.isInteger(basePort) || basePort < 1023 || basePort > 65531)
)
  throw new Error(
    "Endpoint base port must allow four distinct loopback ports."
  );
const profile = validateUnifiedRpcProfile({
  version: 1,
  model: "alchemy-2026-09-08",
  scope: values.scope,
  coordinatorId: values["coordinator-id"],
  reviewId: randomUUID(),
  manifest: values.shared
    ? buildSharedIndexerManifest(process.env)
    : buildSourceManifest(),
  ...(basePort === null
    ? {}
    : {
        endpoints: Object.fromEntries(
          [
            [1, 1],
            [8453, 2],
            [137, 3],
            [56, 4]
          ].map(([chain, offset]) => [
            chain,
            `http://127.0.0.1:${basePort + offset!}/unified`
          ])
        )
      }),
  limits: {
    batchCalls: 10,
    logRange: Number(values["log-range"]),
    addresses: 50,
    topicValues: 128
  }
});
await writeFile(values.output, `${JSON.stringify(profile, null, 2)}\n`, {
  flag: "wx",
  mode: 0o640
});
console.log(
  JSON.stringify({
    event: "unified_rpc_profile_drafted",
    profileId: unifiedRpcProfileId(profile),
    manifestHash: unifiedRpcManifestId(profile),
    approved: false
  })
);
