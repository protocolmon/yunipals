import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  encodeFunctionData,
  keccak256,
  padHex,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import {
  checkMetadataAPI,
  checkMetadataImplementation,
  checkMetadataUpgradeState,
  metadataImplementationRuntime,
  metadataImplementationSlot,
  metadataUpgradeAbi,
  metadataUpgradeCalldata,
  metadataUpgradePackageSha256,
  readMetadataUpgradePackage,
  recoverMetadataImplementation,
  validateMetadataUpgradePackage
} from "./boosterMetadataSetup";
const raw = readFileSync(
  new URL(
    "../../public/boosters/monsters-token-metadata-upgrade-v1.json",
    import.meta.url
  )
);
const implementation = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"ab".repeat(32)}` as Hex;
const originalCode = "0x60016000" as Hex;
const proxyCode = "0x60026000" as Hex;
function bundle() {
  return validateMetadataUpgradePackage(JSON.parse(raw.toString()));
}
type Options = {
  chain?: number;
  proxy?: Hex;
  current?: Address;
  currentCode?: Hex;
  role?: boolean;
  candidate?: Hex;
  uuid?: Hex;
  baseURI?: string;
  tokenURI?: string;
  receipt?: Record<string, unknown>;
  transaction?: Record<string, unknown>;
};
function fixture(options: Options = {}) {
  const b = bundle();
  // Only the synthetic RPC fixture substitutes these digests. The shipped package is independently pinned below.
  b.proxyRuntimeCodeKeccak256 = keccak256(proxyCode);
  b.currentImplementation.runtimeCodeKeccak256 = keccak256(originalCode);
  const calls: string[] = [];
  const client = {
    async getChainId() {
      return options.chain ?? 8453;
    },
    async getStorageAt() {
      return padHex(options.current ?? b.currentImplementation.address, {
        size: 32
      });
    },
    async getCode({ address }: { address: Address }) {
      if (address.toLowerCase() === b.proxy.toLowerCase())
        return options.proxy ?? proxyCode;
      if (address.toLowerCase() === implementation.toLowerCase())
        return (
          options.candidate ?? metadataImplementationRuntime(b, implementation)
        );
      return options.currentCode ?? originalCode;
    },
    async readContract({ functionName }: { functionName: string }) {
      calls.push(functionName);
      if (functionName === "hasRole") return options.role ?? true;
      if (functionName === "proxiableUUID")
        return options.uuid ?? metadataImplementationSlot;
      if (functionName === "tokenMetadataBaseURI")
        return options.baseURI ?? b.metadataBaseURI;
      if (functionName === "tokenURI")
        return options.tokenURI ?? `${b.metadataBaseURI}1.json`;
      throw new Error(`Unexpected read: ${functionName}`);
    },
    async getTransactionReceipt() {
      return {
        status: "success",
        contractAddress: implementation,
        ...options.receipt
      };
    },
    async getTransaction() {
      return {
        from: b.owner,
        to: null,
        input: b.candidate.creationBytecode,
        value: 0n,
        ...options.transaction
      };
    }
  } as unknown as PublicClient;
  return { b, client, calls };
}
function metadata() {
  return {
    image: "https://example.test/shared-variant.webp",
    yunipals: {
      birthMetadataVersion: 1,
      chainId: 8453,
      collection: bundle().proxy,
      tokenId: "1",
      originalTokenId: "1",
      birthDay: 0,
      bornAt: "1792690409",
      originalBornAt: "1792690409",
      mint: { transactionHash: hash, blockHash: hash }
    }
  };
}
async function withFetch<T>(response: Response, action: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.cache, "no-store");
    return response;
  };
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}
test("shipped package matches the exact SHA and contains no guessed nonce", async () => {
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  assert.equal(actual, metadataUpgradePackageSha256);
  const b = await withFetch(new Response(raw), () =>
    readMetadataUpgradePackage()
  );
  assert.equal(b.nonce.supplied, false);
  assert.equal(b.metadataProbe.tokenId, "1");
  assert.equal(b.metadataProbe.birthDay, 0);
  assert.equal((b.candidate.creationBytecode.length - 2) / 2, 14066);
});
test("changed package bytes are refused before a transaction is prepared", async () => {
  await withFetch(new Response(`${raw.toString()} `), async () =>
    assert.rejects(readMetadataUpgradePackage(), /checksum/)
  );
});
test("package independently verifies setter calldata for the fixed API URL", () => {
  const value = JSON.parse(raw.toString());
  value.configurationCalldata = encodeFunctionData({
    abi: metadataUpgradeAbi,
    functionName: "setTokenMetadataBaseURI",
    args: ["https://wrong.test/"]
  });
  assert.throws(() => validateMetadataUpgradePackage(value), /approved/);
});
test("deployment cannot smuggle a recipient or nonce", () => {
  for (const key of ["nonce", "to"]) {
    const value = JSON.parse(raw.toString());
    value.deploymentTransaction[key] = "0x0";
    assert.throws(() => validateMetadataUpgradePackage(value));
  }
});
test("runtime patch replaces exactly both zero __self spans with actual receipt address", () => {
  const b = bundle();
  const actual = metadataImplementationRuntime(b, implementation);
  let restored = actual;
  for (const span of Object.values(b.candidate.immutableReferences).flat()) {
    const start = 2 + span.start * 2;
    assert.equal(
      actual.slice(start, start + 64),
      padHex(implementation, { size: 32 }).slice(2)
    );
    restored =
      `${restored.slice(0, start)}${"0".repeat(64)}${restored.slice(start + 64)}` as Hex;
  }
  assert.equal(restored, b.candidate.runtimeBytecodeTemplate);
  assert.notEqual(keccak256(actual), b.candidate.runtimeTemplateKeccak256);
});
test("overlapping immutable references are refused", () => {
  const value = JSON.parse(raw.toString());
  const spans = Object.values(value.candidate.immutableReferences)[0] as {
    start: number;
    length: number;
  }[];
  spans[1].start = spans[0].start;
  assert.throws(() => validateMetadataUpgradePackage(value), /references/);
});
test("live preflight checks approved proxy and both owner permissions", async () => {
  const { b, client, calls } = fixture();
  assert.equal((await checkMetadataUpgradeState(client, b)).complete, false);
  assert.equal(calls.filter((v) => v === "hasRole").length, 2);
});
for (const [name, options, message] of [
  ["wrong chain", { chain: 1 }, /proxy or chain/],
  ["changed proxy", { proxy: "0x6003" }, /proxy or chain/],
  ["missing role", { role: false }, /permissions/],
  [
    "different current implementation",
    { current: "0x2222222222222222222222222222222222222222" },
    /existing implementation changed/
  ],
  [
    "changed old implementation bytecode",
    { currentCode: "0x6003" },
    /existing implementation changed/
  ]
] as const)
  test(`preflight refuses ${name}`, async () => {
    const { b, client } = fixture(options);
    await assert.rejects(checkMetadataUpgradeState(client, b), message);
  });
test("candidate must match runtime patched to its address and UUPS UUID", async () => {
  const good = fixture();
  assert.equal(
    await checkMetadataImplementation(good.client, good.b, implementation),
    implementation
  );
  for (const options of [{ candidate: "0x6003" as Hex }, { uuid: hash }]) {
    const { b, client } = fixture(options);
    await assert.rejects(
      checkMetadataImplementation(client, b, implementation),
      /approved UUPS/
    );
  }
  await assert.rejects(
    checkMetadataImplementation(good.client, good.b, good.b.proxy),
    /newly deployed/
  );
});
test("completion requires installed candidate plus exact metadata base and token1 URI", async () => {
  const good = fixture({ current: implementation });
  assert.equal(
    (await checkMetadataUpgradeState(good.client, good.b, implementation))
      .complete,
    true
  );
  const bad = fixture({
    current: implementation,
    tokenURI: "https://wrong.test/1.json"
  });
  await assert.rejects(
    checkMetadataUpgradeState(bad.client, bad.b, implementation),
    /configuration differs/
  );
});
test("recovery accepts only actual contractAddress of successful approved owner deployment", async () => {
  const { b, client } = fixture();
  assert.equal(
    await recoverMetadataImplementation(client, b, hash),
    implementation
  );
});
for (const [name, options] of [
  ["reverted", { receipt: { status: "reverted" } }],
  ["missing address", { receipt: { contractAddress: null } }],
  ["wrong sender", { transaction: { from: implementation } }],
  ["ordinary call", { transaction: { to: implementation } }],
  ["wrong bytecode", { transaction: { input: "0x6003" } }],
  ["nonzero value", { transaction: { value: 1n } }]
] as const)
  test(`receipt recovery rejects ${name}`, async () => {
    const { b, client } = fixture(options);
    await assert.rejects(
      recoverMetadataImplementation(client, b, hash),
      /not a successful deployment/
    );
  });
test("atomic upgrade encodes only actual implementation and frozen configuration call", () => {
  const b = bundle();
  assert.equal(
    metadataUpgradeCalldata(b, implementation),
    encodeFunctionData({
      abi: metadataUpgradeAbi,
      functionName: "upgradeToAndCall",
      args: [implementation, b.configurationCalldata]
    })
  );
});
test("API readiness requires actual token1 original birth day0 metadata", async () => {
  const result = await withFetch(Response.json(metadata()), () =>
    checkMetadataAPI(bundle())
  );
  assert.equal(result.yunipals.birthDay, 0);
});
test("202 art pending and unavailable API block upgrade", async () => {
  for (const status of [202, 404, 503])
    await withFetch(Response.json(metadata(), { status }), async () =>
      assert.rejects(checkMetadataAPI(bundle()), /API is not ready/)
    );
});
test("wrong token, collection, age convention, original timestamp or absent mint proof block upgrade", async () => {
  for (const change of [
    { tokenId: "73" },
    { collection: implementation },
    { birthDay: 1 },
    { originalBornAt: "1792600000" },
    { mint: {} }
  ]) {
    const value = metadata();
    Object.assign(value.yunipals, change);
    await withFetch(Response.json(value), async () =>
      assert.rejects(checkMetadataAPI(bundle()), /verified birth metadata/)
    );
  }
});
