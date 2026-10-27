#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const preimageSha256 =
  "8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c";
export const artifactSha256 =
  "10c34c878d5a617fe31d4fffd6a8b020610b39b988de1cf2aac0cb11e7ac59d8";
const anchor =
  'const sourceRequest = unifiedSourcePaidLogs && unifiedWorkload === "unified_source" ? new AbortController() : void 0;';
const replacement = anchor.replace(
  "unifiedSourcePaidLogs &&",
  "(unifiedSourcePaidPrimary || unifiedSourcePaidLogs) &&"
);
const digest = (raw) => createHash("sha256").update(raw).digest("hex");

export function derive(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 111657 || digest(raw) !== preimageSha256)
    throw Error("exact_reviewed_pool_one_proxy_preimage_required");
  const text = raw.toString("utf8");
  if (text.split(anchor).length !== 2)
    throw Error("exact_single_paid_source_queue_anchor_required");
  const result = Buffer.from(text.replace(anchor, replacement));
  const offset = raw.indexOf(anchor);
  if (
    result.length !== 111687 ||
    digest(result) !== artifactSha256 ||
    !raw.subarray(0, offset).equals(result.subarray(0, offset)) ||
    !raw.subarray(offset + Buffer.byteLength(anchor)).equals(
      result.subarray(offset + Buffer.byteLength(replacement))
    )
  )
    throw Error("only_explicit_paid_primary_queue_seam_may_change");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = fileURLToPath(
    new URL("../ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs", import.meta.url)
  );
  const candidate = derive(readFileSync(source));
  const published = readFileSync(new URL("./rpc-budget-proxy.mjs", import.meta.url));
  if (!candidate.equals(published)) throw Error("exact_derived_candidate_required");
  console.log(JSON.stringify({
    format: "yunipals-alchemy-primary-queue-derivation-v1",
    preimageSha256,
    artifactSha256,
    artifactBytes: candidate.length,
    allOtherCompiledBytesIdentical: true,
    sourceMapRebuilt: false,
    databaseCalls: 0,
    providerCalls: 0,
    serviceActions: 0
  }));
}
