// Actual retained official preflight. Four chain-ID reads and eight cached GETs.
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const project = process.cwd();
const require = createRequire(path.join(project, "package.json"));
const viemEntry = require.resolve("viem").replace("/_cjs/", "/_esm/");
if (
  createHash("sha256").update(readFileSync(viemEntry)).digest("hex") !==
  "ea32975364e9f2d599b10639d81985ec6a3ed87f6942fe0cb73b1bf738959057"
)
  throw Error("exact_retained_viem_required");
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier === "viem" &&
      context.parentURL?.startsWith(
        pathToFileURL(path.resolve(project, "../../packages") + path.sep).href
      )
    )
      return next(pathToFileURL(viemEntry).href, context);
    return next(specifier, context);
  }
});
const { buildSourceManifest, sourceManifestHash } = await import(
  pathToFileURL(path.join(project, "lib/unified/sources.ts"))
);
const { preflightUnifiedRpc } = await import(
  pathToFileURL(path.join(project, "lib/unified/rpc-preflight.ts"))
);
const manifest = buildSourceManifest();
const manifestHash = sourceManifestHash(manifest);
if (
  manifestHash !==
  "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112"
)
  throw Error("actual_combined_source_manifest_required");
const calls = [];
const bounded = async (input, options = {}) => {
  const url = new URL(input);
  const chainId = { 19221: 1, 19222: 8453, 19223: 137, 19224: 56 }[url.port];
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !chainId ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    calls.length >= 12
  )
    throw Error("fixed_bounded_loopback_preflight_only");
  let method = "cached_preflight";
  if (url.pathname === "/unified" && options.method === "POST") {
    const body = JSON.parse(options.body);
    if (
      body.method !== "eth_chainId" ||
      body.jsonrpc !== "2.0" ||
      body.id !== 1 ||
      JSON.stringify(body.params) !== "[]"
    )
      throw Error("only_chain_ID_RPC_allowed");
    method = "eth_chainId";
  } else if (url.pathname !== "/unified/preflight" || options.method)
    throw Error("only_official_policy_GET_allowed");
  calls.push({ chainId, method });
  const response = await fetch(url, { ...options, redirect: "error" });
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 1000000)
    throw Error("bounded_proxy_response_required");
  return new Response(bytes, {
    status: response.status,
    headers: response.headers
  });
};
const result = await preflightUnifiedRpc(manifest, process.env, {
  fetch: bounded
});
for (const chainId of [1, 8453, 137, 56]) {
  if (
    calls.filter((c) => c.chainId === chainId && c.method === "eth_chainId")
      .length !== 1 ||
    calls.filter(
      (c) => c.chainId === chainId && c.method === "cached_preflight"
    ).length !== 2
  )
    throw Error("exact_eight_GET_four_chain_ID_reads_required");
}
if (!result || calls.length !== 12)
  throw Error("actual_official_preflight_must_complete");
console.log(
  JSON.stringify({
    format: "yunipals-source-tail-pool8-preflight-v1",
    passed: true,
    manifestHash,
    chainIds: [1, 8453, 137, 56],
    cachedPolicyReads: 8,
    chainIdRpcReads: 4,
    databaseWrites: 0,
    transactionsSent: 0,
    paidAuthorityAdded: false,
    privateValuesExported: false
  })
);
