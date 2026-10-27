// Explicit public Base deployment reads; not a source-profile admission.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, lstat, open, mkdir, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  resolve(ROOT, "apps/yunipals-home-web/package.json")
);
const {
  createPublicClient,
  http,
  encodeAbiParameters,
  keccak256
} = require("viem");
const INPUT = "/var/backups/yunipals-ypal-backend-input-v1-20261023";
const BACKEND_SHA =
  "94b78e09d3e5d845229a4ea8afdc481cd17b744e1b6bd9f070cb3fe9aa09a371";
const PACKAGE_SHA =
  "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886";
const ABI_SHA =
  "580b38c39dc3e76f92762195f4b6862123775f13d95d092b3fafa39d73adc0ba";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const encoded = (v) => JSON.stringify(v, null, 2) + "\n";

async function protectedRead(path, maximum = 2_000_000) {
  const before = await lstat(path);
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.uid === 0 &&
      !(before.mode & 0o022) &&
      before.nlink === 1 &&
      before.size <= maximum
  );
  let parent = dirname(path);
  while (true) {
    const st = await lstat(parent);
    assert(
      st.isDirectory() &&
        !st.isSymbolicLink() &&
        st.uid === 0 &&
        !(st.mode & 0o022)
    );
    if (parent === "/") break;
    parent = dirname(parent);
  }
  const raw = await readFile(path),
    after = await lstat(path);
  for (const key of [
    "ino",
    "dev",
    "mode",
    "uid",
    "gid",
    "size",
    "mtimeMs",
    "ctimeMs"
  ])
    assert.equal(before[key], after[key]);
  return raw;
}

export const PUBLIC_POLICY = Object.freeze({
  provider: "https://mainnet.base.org",
  chainId: 8453,
  freeOnly: true,
  paidCalls: 0,
  maximumRequests: 160,
  maximumSeconds: 180,
  financialProfileUsed: false,
  sourceAdmissionQualified: false,
  replayPermitSupplied: false
});
const METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call"
]);
export function publicDeploymentClient(fetcher = fetch, clock = Date.now) {
  const started = clock();
  let calls = 0;
  const guarded = async (request, init = {}) => {
    const url = typeof request === "string" ? request : request.url;
    assert.equal(new URL(url).href, PUBLIC_POLICY.provider + "/");
    assert.equal(init.method, "POST");
    const headers = new Headers(init.headers ?? request.headers);
    assert(
      !headers.has("authorization") &&
        !headers.has("cookie") &&
        !headers.has("x-yunipals-unified-rpc-profile") &&
        !headers.has("x-yunipals-unified-rpc-permit")
    );
    const body = JSON.parse(init.body);
    assert(
      !Array.isArray(body) && METHODS.has(body.method),
      "deployment read method only"
    );
    assert(
      calls < PUBLIC_POLICY.maximumRequests &&
        0 <= clock() - started &&
        clock() - started < PUBLIC_POLICY.maximumSeconds * 1000,
      "bounded public deployment read exhausted"
    );
    calls += 1;
    return fetcher(request, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(
        Math.min(
          8000,
          PUBLIC_POLICY.maximumSeconds * 1000 - (clock() - started)
        )
      )
    });
  };
  return {
    client: createPublicClient({
      transport: http(PUBLIC_POLICY.provider, {
        retryCount: 0,
        timeout: 8000,
        batch: false,
        fetchFn: guarded
      })
    }),
    requestCount: () => calls
  };
}

export async function qualifyNow(
  client,
  backend,
  packageRaw,
  manifestRaw,
  artworkRaw,
  guard = async () => PUBLIC_POLICY,
  clock = Date.now
) {
  assert.equal(sha(packageRaw), PACKAGE_SHA);
  const before = await guard();
  const input = await backend.inputs(packageRaw);
  const manifest = JSON.parse(manifestRaw);
  const qualification = await backend.qualify(
    client,
    input,
    JSON.parse(manifestRaw),
    artworkRaw
  );
  const rulesParameter = input.packRegistryAbi.find(
    (v) => v.type === "function" && v.name === "configureType"
  ).inputs[1];
  const expectedRuleHash = keccak256(
    encodeAbiParameters(
      [rulesParameter, { type: "bytes32" }],
      [backend.rules(input.bundle, manifest), manifest.catalogHash]
    )
  );
  const header = await client.getBlock({
    blockNumber: BigInt(qualification.blockNumber)
  });
  assert.equal(
    header.hash.toLowerCase(),
    qualification.blockHash.toLowerCase()
  );
  assert(
    typeof header.timestamp === "bigint" &&
      0 <= clock() - Number(header.timestamp) * 1000 &&
      clock() - Number(header.timestamp) * 1000 <= 120000,
    "fresh canonical Base header required"
  );
  const after = await guard();
  assert.deepEqual(after, before);
  return {
    format: "yunipals-ypal-backend-qualification-owner-v1",
    backendProducerSha256: BACKEND_SHA,
    packageSha256: PACKAGE_SHA,
    confirmedFileSha256: sha(manifestRaw),
    confirmedCanonicalSha256: qualification.confirmedManifestSha256,
    qualifiedAt: new Date(clock()).toISOString(),
    qualifiedAtEpochSeconds: Math.floor(clock() / 1000),
    qualification,
    expectedRuleHash,
    freeRpcGuard: { before, after },
    financialProfileUsed: false,
    sourceAdmissionQualified: false,
    hostQualified: false,
    serviceChanges: 0,
    databaseWrites: 0,
    chainTransactionsSent: 0
  };
}

async function save(path, raw) {
  const stream = await open(path, "wx", 0o600);
  try {
    await stream.chmod(0o600);
    await stream.writeFile(raw);
    await stream.sync();
  } finally {
    await stream.close();
  }
  const dir = await open(dirname(path), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "read-only": { type: "boolean" },
      "record-initial": { type: "boolean" },
      "record-run": { type: "string" }
    }
  });
  assert.equal(
    [
      values["read-only"],
      values["record-initial"],
      values["record-run"]
    ].filter(Boolean).length,
    1
  );
  const file = fileURLToPath(import.meta.url),
    backendFile = resolve(dirname(file), "ypal-backend-prepare-v1.mjs");
  const producerSha256 = sha(await protectedRead(file));
  assert.equal(sha(await protectedRead(backendFile)), BACKEND_SHA);
  assert.equal(
    sha(
      await protectedRead(
        resolve(ROOT, "packages/yunipals-market-core/src/boosterAbi.ts")
      )
    ),
    ABI_SHA
  );
  const backend = await import(backendFile);
  const { client, requestCount } = publicDeploymentClient();
  const result = {
    ...(await qualifyNow(
      client,
      backend,
      await protectedRead(INPUT + "/launch.unsigned.json"),
      await protectedRead(INPUT + "/confirmed.json"),
      await protectedRead(INPUT + "/artwork-manifest.json")
    )),
    producerSha256,
    publicReadRequestCount: requestCount()
  };
  if (!values["read-only"]) {
    assert.equal(process.getuid(), 0);
    assert.equal(process.getgid(), 0);
    let path = INPUT + "/chain-qualification.json";
    if (values["record-run"]) {
      assert(/^[a-z0-9-]{1,48}$/.test(values["record-run"]));
      const base = INPUT + "/qualifications";
      try {
        await mkdir(base, { mode: 0o700 });
        await chmod(base, 0o700);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const st = await lstat(base);
      assert(
        st.isDirectory() &&
          !st.isSymbolicLink() &&
          st.uid === 0 &&
          (st.mode & 0o777) === 0o700
      );
      const dir = base + "/" + values["record-run"];
      await mkdir(dir, { mode: 0o700 });
      await chmod(dir, 0o700);
      path = dir + "/result.json";
    }
    await save(path, encoded(result));
    console.log(
      encoded({
        format: result.format,
        file: path,
        sha256: sha(encoded(result)),
        currentStateQualified: true,
        serviceChanges: 0,
        databaseWrites: 0,
        chainTransactionsSent: 0
      })
    );
  } else console.log(encoded(result));
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error(
      "Fresh YPAL qualification refused; no host transition or chain transaction was attempted."
    );
    process.exitCode = 1;
  });
