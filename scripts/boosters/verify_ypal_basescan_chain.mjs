// Receipt-derived preparation and read-only qualification. No wallet or explorer API.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(
  path.join(root, "apps/yunipals-home-web/package.json")
);
const { createPublicClient, http, keccak256 } = require("viem");
export const PUBLIC_RPC = "https://mainnet.base.org";
export const RPC_CAP = 128;
export const READ_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call"
]);
export const BACKEND_SHA =
  "94b78e09d3e5d845229a4ea8afdc481cd17b744e1b6bd9f070cb3fe9aa09a371";
export const PACKAGE_SHA =
  "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const backendFile = path.join(
  root,
  "ops/booster-launch/ypal-backend-prepare-v1.mjs"
);
const packageFile = path.join(
  root,
  "apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json"
);

export function publicReadClient(fetcher = fetch) {
  let calls = 0;
  const started = Date.now();
  const methods = {};
  const guardedFetch = async (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.href, PUBLIC_RPC + "/");
    assert.equal(options?.method, "POST");
    assert.equal(typeof options?.body, "string");
    assert(options.body.length <= 200000);
    const body = JSON.parse(options.body);
    assert(
      !Array.isArray(body) && READ_METHODS.has(body.method),
      "fixed readonly RPC method required"
    );
    assert(calls < RPC_CAP, "finite deployment qualification RPC cap reached");
    assert(
      Date.now() - started < 180000,
      "bounded deployment qualification expired"
    );
    const headers = new Headers(options.headers);
    assert(
      !headers.has("authorization") &&
        !headers.has("x-yunipals-unified-rpc-profile")
    );
    calls++;
    methods[body.method] = (methods[body.method] ?? 0) + 1;
    const response = await fetcher(PUBLIC_RPC, {
      ...options,
      redirect: "error"
    });
    assert(response.ok, "fixed public Base RPC refused the readonly request");
    const raw = await response.arrayBuffer();
    assert(raw.byteLength <= 2000000, "bounded public RPC response required");
    assert(
      Date.now() - started < 180000,
      "bounded deployment qualification expired"
    );
    return new Response(raw, {
      status: response.status,
      headers: response.headers
    });
  };
  return {
    client: createPublicClient({
      transport: http(PUBLIC_RPC, {
        retryCount: 0,
        timeout: 8000,
        batch: false,
        fetchFn: guardedFetch
      })
    }),
    summary: () => ({
      endpoint: PUBLIC_RPC,
      requestCap: RPC_CAP,
      maximumSeconds: 180,
      rpcCalls: calls,
      methodCounts: { ...methods },
      retryCount: 0,
      financialIndexerProfileUsed: false,
      profileChanges: 0,
      paidProvider: false,
      transactionMethodsAllowed: false
    })
  };
}

export async function prepare(manifest, client) {
  assert.equal(
    hash(fs.readFileSync(backendFile)),
    BACKEND_SHA,
    "frozen chain qualifier changed"
  );
  const backend = await import(pathToFileURL(backendFile).href);
  const raw = fs.readFileSync(packageFile);
  assert.equal(hash(raw), PACKAGE_SHA);
  const input = await backend.inputs(raw);
  const b = input.bundle;
  const confirmed = backend.manifest(b, manifest);
  const contracts = backend.STEPS.slice(0, 7).map((step) => {
    const key = step.replace("Implementation", "");
    const proxy = ["registry", "monsters", "engine"].includes(step);
    const artifactKey = step === "ypal" ? "ypal" : proxy ? "proxy" : key;
    const artifact = b.artifacts[artifactKey];
    const address = step.endsWith("Implementation")
      ? confirmed.implementations[key]
      : confirmed[step];
    const creation = backend.action(b, input.packRegistryAbi, confirmed, step);
    assert.equal(creation.to, null);
    assert(creation.data.startsWith(artifact.creationBytecode));
    return {
      step,
      address,
      artifactKey,
      contractName: artifact.contractName,
      constructorArguments: creation.data.slice(
        artifact.creationBytecode.length
      ),
      creationInputKeccak256: keccak256(creation.data),
      runtimeKeccak256: keccak256(backend.runtime(artifact, address, b.pmon)),
      implementation: proxy ? confirmed.implementations[key] : null,
      receipt: confirmed.receipts[step]
    };
  });
  const qualification = client
    ? await backend.readConfirmedDeployment(client, b, confirmed)
    : null;
  assert.equal(hash(fs.readFileSync(backendFile)), BACKEND_SHA);
  assert.equal(hash(fs.readFileSync(packageFile)), PACKAGE_SHA);
  return {
    format: "yunipals-ypal-basescan-chain-preparation-v1",
    packageSha256: PACKAGE_SHA,
    backendSha256: BACKEND_SHA,
    contracts,
    qualification,
    chainQualified: qualification !== null,
    explorerCalls: 0,
    transactionsSent: 0
  };
}

async function main() {
  assert(
    Number(process.versions.node.split(".")[0]) >= 24,
    "Node 24 or newer required"
  );
  const argv = process.argv.slice(2);
  const qualify = argv.includes("--qualify");
  if (qualify) argv.splice(argv.indexOf("--qualify"), 1);
  assert.equal(argv.length, 1, "one actual confirmed manifest file required");
  const file = path.resolve(argv[0]);
  const info = fs.lstatSync(file);
  assert(
    info.isFile() &&
      !info.isSymbolicLink() &&
      info.nlink === 1 &&
      info.size <= 200000
  );
  const raw = fs.readFileSync(file);
  assert.equal(hash(fs.readFileSync(backendFile)), BACKEND_SHA);
  const reader = qualify ? publicReadClient() : null;
  const result = await prepare(JSON.parse(raw), reader?.client);
  assert.deepEqual(
    fs.readFileSync(file),
    raw,
    "confirmed manifest changed during qualification"
  );
  console.log(
    JSON.stringify({
      ...result,
      confirmedManifestFileSha256: hash(raw),
      publicReadOnlyQualification: reader?.summary() ?? null
    })
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "YPAL explorer chain preparation refused; no explorer or transaction action occurred."
    );
    process.exitCode = 1;
  });
}
