import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  encodeFunctionData,
  keccak256,
  padHex,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import {
  assertPermitReceiptIdentity,
  permitImplementationRuntime,
  permitImplementationSlot,
  permitUpgradeAbi,
  permitUpgradeCalldata,
  permitUpgradePackageSha256,
  checkPermitImplementation,
  checkPermitUpgradeState,
  readPermitUpgradePackage,
  recoverPermitImplementation,
  validatePermitUpgradePackage
} from "./boosterPermitSetup";
const raw = readFileSync(
  new URL(
    "../../public/boosters/engine-permit-upgrade-v1.json",
    import.meta.url
  )
);
const implementation = "0x1111111111111111111111111111111111111111" as Address,
  hash = `0x${"ab".repeat(32)}` as Hex,
  oldCode = "0x60016000" as Hex,
  proxyCode = "0x60026000" as Hex;
const bundle = () => validatePermitUpgradePackage(JSON.parse(raw.toString()));
type Options = {
  chain?: number;
  proxy?: Hex;
  current?: Address;
  currentCode?: Hex;
  role?: boolean;
  candidate?: Hex;
  uuid?: Hex;
  maximum?: number;
  permitVersion?: bigint | number;
  proxyPermitVersion?: bigint;
  registry?: Address;
  receipt?: Record<string, unknown>;
  transaction?: Record<string, unknown>;
};
function fixture(options: Options = {}) {
  const b = bundle();
  b.proxyRuntimeCodeKeccak256 = keccak256(proxyCode);
  b.currentImplementation.runtimeCodeKeccak256 = keccak256(oldCode);
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
          options.candidate ?? permitImplementationRuntime(b, implementation)
        );
      return options.currentCode ?? oldCode;
    },
    async readContract({
      functionName,
      address
    }: {
      functionName: string;
      address: Address;
    }) {
      calls.push(functionName);
      if (functionName === "hasRole") return options.role ?? true;
      if (functionName === "proxiableUUID")
        return options.uuid ?? permitImplementationSlot;
      if (functionName === "MAX_OPEN_PACKS") return options.maximum ?? 10;
      if (functionName === "PERMIT_OPEN_VERSION")
        return address.toLowerCase() === b.proxy.toLowerCase()
          ? (options.proxyPermitVersion ?? options.permitVersion ?? 1n)
          : (options.permitVersion ?? 1n);
      if (functionName === "registry")
        return options.registry ?? b.unchanged.registry;
      if (functionName === "monsters") return b.unchanged.monsters;
      if (functionName === "wrapper") return b.unchanged.wrapper;
      throw Error("Unexpected read:" + functionName);
    },
    async getTransactionReceipt() {
      return {
        transactionHash: hash,
        blockHash: hash,
        blockNumber: 100n,
        status: "success",
        contractAddress: implementation,
        ...options.receipt
      };
    },
    async getTransaction() {
      return {
        hash,
        blockHash: hash,
        blockNumber: 100n,
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
test("reviewed public package SHA, size, profile and zero initialization are exact", async () => {
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  assert.equal(actual, permitUpgradePackageSha256);
  const b = await withFetch(new Response(raw), () =>
    readPermitUpgradePackage()
  );
  assert.equal(b.candidate.runtimeBytes, 24569);
  assert.equal(b.candidate.buildProfile, "permit");
  assert.equal(b.capability.maxOpenPacks, 10);
  assert.equal(b.configurationCalldata, "0x");
  assert.equal(b.nonce.supplied, false);
});
test("changed package bytes and hidden deployment nonce/to are refused", async () => {
  await withFetch(new Response(raw.toString() + " "), () =>
    assert.rejects(readPermitUpgradePackage(), /checksum/)
  );
  for (const key of ["to", "nonce"]) {
    const value = JSON.parse(raw.toString());
    value.deploymentTransaction[key] = "0x0";
    assert.throws(() => validatePermitUpgradePackage(value));
  }
});
test("package refuses initialization, changed baseline/dependencies/profile or storage", () => {
  for (const [keys, replacement] of [
    [["configurationCalldata"], "0x1234"],
    [["currentImplementation", "sourceSha256"], "0".repeat(64)],
    [["candidate", "sourceSha256"], "0".repeat(64)],
    [["capability", "permitVersion"], 2],
    [["candidate", "runtimeCodeKeccak256"], hash],
    [["upgradeTransaction"], {}],
    [["unchanged", "wrapper"], implementation],
    [["candidate", "optimizerRuns"], 200],
    [["candidate", "storage", "gapSlots"], 40]
  ] as const) {
    const value: Record<string, unknown> = JSON.parse(raw.toString());
    let target = value;
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = replacement;
    assert.throws(() => validatePermitUpgradePackage(value));
  }
});
test("runtime replaces only both compiler __self spans with the actual receipt address", () => {
  const b = bundle(),
    runtime = permitImplementationRuntime(b, implementation);
  let restored = runtime;
  for (const span of Object.values(b.candidate.immutableReferences).flat()) {
    const start = 2 + span.start * 2;
    assert.equal(
      runtime.slice(start, start + 64),
      padHex(implementation, { size: 32 }).slice(2)
    );
    restored = (restored.slice(0, start) +
      "0".repeat(64) +
      restored.slice(start + 64)) as Hex;
  }
  assert.equal(restored, b.candidate.runtimeBytecodeTemplate);
  assert.notEqual(keccak256(runtime), b.candidate.runtimeTemplateKeccak256);
});
test("overlapping or nonzero immutable references are refused", () => {
  const bad = JSON.parse(raw.toString()),
    groups = Object.values(bad.candidate.immutableReferences) as {
      start: number;
      length: number;
    }[][];
  groups[0][1].start = groups[0][0].start;
  assert.throws(() => validatePermitUpgradePackage(bad), /references/);
});
test("altered candidate code stays refused even when its internal hashes are recomputed", () => {
  for (const mode of ["creation", "runtime"]) {
    const bad = JSON.parse(raw.toString());
    if (mode === "creation") {
      bad.candidate.creationBytecode = "0x6000";
      bad.candidate.creationCodeKeccak256 = keccak256("0x6000");
      bad.deploymentTransaction.data = "0x6000";
    } else {
      bad.candidate.runtimeBytecodeTemplate = "0x6000";
      bad.candidate.runtimeTemplateKeccak256 = keccak256("0x6000");
      bad.candidate.runtimeBytes = 2;
    }
    assert.throws(() => validatePermitUpgradePackage(bad), /approved Base/);
  }
});
test("preflight checks current Base proxy, upgrade role and unchanged fixed dependencies", async () => {
  const { b, client, calls } = fixture();
  assert.equal((await checkPermitUpgradeState(client, b)).complete, false);
  assert.equal(calls.filter((v) => v === "hasRole").length, 1);
  assert.equal(calls.filter((v) => v === "MAX_OPEN_PACKS").length, 0);
});
for (const [name, options] of [
  ["chain", { chain: 1 }],
  ["proxy", { proxy: "0x6003" }],
  ["role", { role: false }],
  [
    "old implementation",
    { current: "0x2222222222222222222222222222222222222222" }
  ],
  ["old code", { currentCode: "0x6003" }],
  ["registry", { registry: implementation }]
] as const)
  test(`preflight refuses changed ${name}`, async () => {
    const { b, client } = fixture(options);
    await assert.rejects(checkPermitUpgradeState(client, b));
  });
test("candidate requires exact address-patched runtime, UUPS UUID, max10 and uint256 permit version1", async () => {
  const good = fixture();
  assert.equal(
    await checkPermitImplementation(good.client, good.b, implementation),
    implementation
  );
  for (const options of [
    { candidate: "0x6003" as Hex },
    { uuid: hash },
    { maximum: 11 },
    { permitVersion: 0n },
    { permitVersion: 2n },
    { permitVersion: 1 }
  ]) {
    const { b, client } = fixture(options);
    await assert.rejects(
      checkPermitImplementation(client, b, implementation),
      /approved UUPS/
    );
  }
  await assert.rejects(
    checkPermitImplementation(good.client, good.b, good.b.proxy),
    /newly deployed/
  );
});
test("completion requires installed exact candidate plus approved permit capability", async () => {
  const good = fixture({ current: implementation });
  assert.equal(
    (await checkPermitUpgradeState(good.client, good.b, implementation))
      .complete,
    true
  );
  const bad = fixture({ current: implementation, maximum: 11 });
  await assert.rejects(
    checkPermitUpgradeState(bad.client, bad.b, implementation),
    /approved UUPS|permit limit/
  );
  const wrongVersion = fixture({
    current: implementation,
    proxyPermitVersion: 0n
  });
  await assert.rejects(
    checkPermitUpgradeState(
      wrongVersion.client,
      wrongVersion.b,
      implementation
    ),
    /permit limit/
  );
});
test("recovery accepts only successful exact owner creation receipt", async () => {
  const { b, client } = fixture();
  assert.equal(
    await recoverPermitImplementation(client, b, hash),
    implementation
  );
});
test("receipt recovery independently refuses an RPC on another chain", async () => {
  const { b, client } = fixture({ chain: 1 });
  await assert.rejects(
    recoverPermitImplementation(client, b, hash),
    /Base mainnet/
  );
});
for (const [name, options] of [
  ["revert", { receipt: { status: "reverted" } }],
  ["address", { receipt: { contractAddress: null } }],
  ["sender", { transaction: { from: implementation } }],
  ["call", { transaction: { to: implementation } }],
  ["bytecode", { transaction: { input: "0x6003" } }],
  ["value", { transaction: { value: 1n } }]
] as const)
  test(`receipt recovery refuses wrong ${name}`, async () => {
    const { b, client } = fixture(options);
    await assert.rejects(
      recoverPermitImplementation(client, b, hash),
      /not a successful deployment/
    );
  });
test("upgrade calldata cannot initialize or configure the existing engine", () => {
  const b = bundle();
  assert.equal(
    permitUpgradeCalldata(b, implementation),
    encodeFunctionData({
      abi: permitUpgradeAbi,
      functionName: "upgradeToAndCall",
      args: [implementation, "0x"]
    })
  );
});
test("receipt hashes and canonical mined block must identify the same transaction", async () => {
  const receipt = { transactionHash: hash, blockHash: hash, blockNumber: 100n };
  const transaction = { hash, blockHash: hash, blockNumber: 100n };
  assert.doesNotThrow(() =>
    assertPermitReceiptIdentity(receipt, transaction, hash)
  );
  for (const changed of [
    { ...transaction, hash: `0x${"cd".repeat(32)}` as Hex },
    { ...transaction, blockHash: null },
    { ...transaction, blockNumber: null },
    { ...transaction, blockNumber: 99n }
  ])
    assert.throws(
      () => assertPermitReceiptIdentity(receipt, changed, hash),
      /does not match/
    );
  const wrong = fixture({
    receipt: { transactionHash: `0x${"cd".repeat(32)}` }
  });
  await assert.rejects(
    recoverPermitImplementation(wrong.client, wrong.b, hash),
    /does not match/
  );
});
