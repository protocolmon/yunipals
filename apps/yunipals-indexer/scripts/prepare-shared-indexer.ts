import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import type { SourceManifest } from "../../../packages/yunipals-indexer-client/src/sources.js";
import { validateUnifiedRpcProfile } from "../../../packages/yunipals-indexer-server/src/rpc-policy.js";
import {
  assertRetainedIndexerSources,
  buildSharedIndexerManifest,
  createSharedIndexerDeployment
} from "../lib/unified/shared-deployment.js";
import { ownershipDepthPolicies } from "../lib/unified/sources.js";

const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    "arena-baseline": { type: "string" },
    profile: { type: "string" },
    schema: { type: "string" },
    "build-id": { type: "string" },
    "read-schema": { type: "string" },
    output: { type: "string" }
  }
});
try {
  for (const key of ["baseline", "profile", "output"] as const)
    if (!values[key] || !isAbsolute(values[key]))
      throw new Error(`An absolute --${key} path is required.`);
  if (!values.schema || !values["build-id"] || !values["read-schema"])
    throw new Error(
      "The actual compiled schema/build and ownership view are required."
    );
  const baseline = JSON.parse(
    await readFile(values.baseline!, "utf8")
  ) as SourceManifest;
  const manifest = buildSharedIndexerManifest(process.env);
  const depths = ownershipDepthPolicies(process.env);
  assertRetainedIndexerSources(baseline, manifest, depths);
  if (values["arena-baseline"]) {
    if (!isAbsolute(values["arena-baseline"]))
      throw new Error("An absolute Arena baseline is required.");
    const arenaBaseline = JSON.parse(
      await readFile(values["arena-baseline"], "utf8")
    ) as SourceManifest;
    assertRetainedIndexerSources(arenaBaseline, manifest, depths);
  }
  const rpcProfile = validateUnifiedRpcProfile(
    JSON.parse(await readFile(values.profile!, "utf8"))
  );
  const deployment = createSharedIndexerDeployment({
    schema: values.schema,
    buildId: values["build-id"],
    ownershipReadSchema: values["read-schema"],
    ownershipDepthPolicies: depths,
    manifest,
    rpcProfile
  });
  await writeFile(values.output!, JSON.stringify(deployment, null, 2) + "\n", {
    flag: "wx",
    mode: 0o644
  });
  console.log(
    JSON.stringify({
      event: "shared_indexer_prepared",
      releaseId: deployment.releaseId,
      profileId: deployment.rpcProfileId,
      enabledSources: manifest.sources.filter((source) => source.enabled).length,
      activated: false,
      output: values.output
    })
  );
} catch {
  console.error(
    "Shared deployment preparation refused; verify retained sources and compiled identities."
  );
  process.exitCode = 1;
}
