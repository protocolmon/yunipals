#!/usr/bin/env node
/** Derive only the new combined proxies' one-connection budget pool. */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const format = "yunipals-combined-rpc-pool-one-artifact-v1";
export const preimageSha256 =
  "d8e58d18f7f88bb8b13d4f2d85d562ddd71f7ffc2c96b913410d5a656202f5c8";
export const artifactSha256 =
  "8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c";
export const artifactBytes = 111657;
export const installedPreimage =
  "/opt/yunipals-unified/operations/free-replay-20261020/source6-selective-source-proxy-v6/rpc-budget-proxy.mjs";
export const anchor = `function createOpenSeaRequestBudget(input = process.env) {
  const { databaseUrl, scope, coordinatorId } = readOpenSeaBudgetEnvironment(input);
  const pool = new pg3.Pool({
    connectionString: databaseUrl,
    application_name: "yunipals_opensea_budget",
    max: 2,
`;
export const sha256 = (raw) => createHash("sha256").update(raw).digest("hex");

export function derive(raw) {
  if (
    !Buffer.isBuffer(raw) ||
    raw.length !== artifactBytes ||
    sha256(raw) !== preimageSha256
  )
    throw Error("exact_public_v6_preimage_required");
  const text = raw.toString("utf8");
  if (text.split(anchor).length !== 2)
    throw Error("single_compiled_budget_pool_anchor_required");
  const changed = anchor.replace("max: 2,", "max: 1,");
  const result = Buffer.from(text.replace(anchor, changed));
  const offset =
    raw.indexOf(Buffer.from(anchor)) + anchor.indexOf("max: 2,") + 5;
  if (
    result.length !== raw.length ||
    sha256(result) !== artifactSha256 ||
    raw[offset] !== 50 ||
    result[offset] !== 49 ||
    !raw.subarray(0, offset).equals(result.subarray(0, offset)) ||
    !raw.subarray(offset + 1).equals(result.subarray(offset + 1))
  )
    throw Error("only_one_budget_pool_byte_may_change");
  return result;
}

export function proof(raw) {
  const candidate = derive(raw);
  return {
    format,
    preimage: { path: installedPreimage, sha256: preimageSha256 },
    artifact: {
      file: "rpc-budget-proxy.mjs",
      sha256: artifactSha256,
      bytes: candidate.length
    },
    change: {
      factory: "createOpenSeaRequestBudget",
      poolMaxBefore: 2,
      poolMaxAfter: 1,
      changedBytes: 1
    },
    intendedUnits: ["ethereum", "base", "polygon", "bnb"].map(
      (chain) => "yunipals-combined-rpc@" + chain + ".service"
    ),
    allOtherCompiledBytesIdentical: true,
    selectedForProduction: false,
    oldProxyArtifactsModified: false,
    databaseConnections: 0,
    providerRequests: 0,
    serviceActions: 0,
    roleOrBudgetChanges: 0
  };
}

function writeNew(path, raw) {
  const fd = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o644
  );
  try {
    fchmodSync(fd, 0o644);
    writeFileSync(fd, raw);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function publishNew(directory, raw) {
  const candidate = derive(raw),
    report = proof(raw);
  mkdirSync(directory, { mode: 0o755 });
  const dir = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    fchmodSync(dir, 0o755);
    writeNew(resolve(directory, "rpc-budget-proxy.mjs"), candidate);
    writeNew(
      resolve(directory, "artifact.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
  return report;
}

export function main(args = process.argv.slice(2)) {
  let input = installedPreimage,
    output;
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1]) throw Error("fixed_builder_arguments_required");
    if (args[i] === "--preimage" && input === installedPreimage)
      input = args[i + 1];
    else if (args[i] === "--write-new" && output === undefined)
      output = args[i + 1];
    else throw Error("fixed_builder_arguments_required");
  }
  const raw = readFileSync(input);
  console.log(
    JSON.stringify(output ? publishNew(resolve(output), raw) : proof(raw))
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
