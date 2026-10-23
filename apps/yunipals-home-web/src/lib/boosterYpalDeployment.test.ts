import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  hashDomain,
  keccak256,
  padHex,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { packRegistryAbi } from "@protopals/yunipals-market-core/boosterAbi";
import { validateBoosterCatalog } from "@protopals/yunipals-market-core/boosterCatalog";
import {
  checkYpalPublishedArtwork,
  readYpalDeployment,
  readYpalLaunchPackage,
  validateYpalLaunchPackage,
  ypalDeploymentManifest,
  ypalImplementationSlot,
  ypalLaunchAction,
  ypalLaunchPackageSha256,
  ypalLaunchSteps,
  ypalPackArguments,
  ypalArtworkDescriptor,
  ypalRuntime,
  type YpalLaunchAddresses,
  type YpalLaunchReceipts,
  type YpalLaunchState
} from "./boosterYpalDeployment";

const raw = readFileSync(
  new URL("../../public/boosters/ypal-fresh-launch-v1.json", import.meta.url)
);
const bundle = () => validateYpalLaunchPackage(JSON.parse(raw.toString()));
const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
} as const;
function fixture(through = 10) {
  const b = bundle(),
    addresses: YpalLaunchAddresses = {},
    calls: string[] = [];
  const receipts = new Map<Hex, Record<string, unknown>>(),
    transactions = new Map<Hex, Record<string, unknown>>();
  const saved: YpalLaunchReceipts = {},
    codes = new Map<string, Hex>();
  let prefix: YpalLaunchState = { completed: 0, addresses, nextStep: "ypal" };
  for (let i = 0; i < ypalLaunchSteps.length; i++) {
    const step = ypalLaunchSteps[i],
      action = ypalLaunchAction(b, step, prefix);
    const txHash = hash(i + 1),
      blockHash = hash(i + 100),
      contractAddress = i < 7 ? address(i + 1000) : null;
    const transaction = {
      hash: txHash,
      blockHash,
      blockNumber: BigInt(100 + i),
      chainId: 8453,
      from: b.owner,
      to: action.to ?? null,
      input: action.data,
      value: 0n,
      nonce: 987 + i
    };
    const logs =
      step === "configure"
        ? [
            {
              address: addresses.registry!,
              topics: encodeEventTopics({
                abi: packRegistryAbi,
                eventName: "TypeConfigured",
                args: { packTypeId: 1n, engine: addresses.engine! }
              }),
              data: encodeAbiParameters(parseAbiParameters("bytes32"), [
                validateBoosterCatalog(b.pack.catalog).catalogHash
              ]),
              blockNumber: BigInt(100 + i),
              blockHash,
              transactionHash: txHash,
              transactionIndex: 0,
              logIndex: 0,
              removed: false
            }
          ]
        : [];
    receipts.set(txHash, {
      transactionHash: txHash,
      blockHash,
      blockNumber: BigInt(100 + i),
      status: "success",
      contractAddress,
      logs
    });
    transactions.set(txHash, transaction);
    if (i < 7) {
      addresses[step as keyof YpalLaunchAddresses] = contractAddress!;
      const artifact =
        step === "ypal"
          ? b.artifacts.ypal
          : step === "registryImplementation"
            ? b.artifacts.registry
            : step === "monstersImplementation"
              ? b.artifacts.monsters
              : step === "engineImplementation"
                ? b.artifacts.engine
                : b.artifacts.proxy;
      codes.set(
        contractAddress!.toLowerCase(),
        ypalRuntime(artifact, contractAddress!, b.pmon)
      );
    }
    if (step === "configure") prefix.typeId = 1n;
    if (i < through) saved[step] = txHash;
    prefix = {
      ...prefix,
      completed: i + 1,
      nextStep: ypalLaunchSteps[i + 1] ?? null
    };
  }
  const options = {
    chain: 8453,
    roles: true,
    locked: false,
    domain: undefined as Hex | undefined,
    count: through >= 9 ? 1n : 0n,
    active: through === 10,
    metadata: undefined as string | undefined,
    canonical: true,
    slot: undefined as Hex | undefined
  };
  const client = {
    async getChainId() {
      return options.chain;
    },
    async getBlockNumber() {
      return 200n;
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return {
        hash: options.canonical ? hash(Number(blockNumber)) : hash(999)
      };
    },
    async getCode({ address }: { address: Address }) {
      return codes.get(address.toLowerCase()) ?? "0x";
    },
    async getStorageAt({ address: actual }: { address: Address }) {
      const key = (["registry", "monsters", "engine"] as const).find(
        (k) => addresses[k]!.toLowerCase() === actual.toLowerCase()
      )!;
      return (
        options.slot ?? padHex(addresses[`${key}Implementation`]!, { size: 32 })
      );
    },
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      const value = receipts.get(hash);
      if (!value) {
        const error = Error("fixture pending");
        error.name = "TransactionReceiptNotFoundError";
        throw error;
      }
      return value;
    },
    async getTransaction({ hash }: { hash: Hex }) {
      return transactions.get(hash);
    },
    async readContract({ functionName }: { functionName: string }) {
      calls.push(functionName);
      if (functionName === "proxiableUUID") return ypalImplementationSlot;
      if (functionName === "hasRole") return options.roles;
      if (functionName === "pmon") return b.pmon;
      if (functionName === "burnAddress") return b.burnAddress;
      if (functionName === "owner") return b.owner;
      if (functionName === "isLocked") return options.locked;
      if (functionName === "name") return "Yunipals";
      if (functionName === "symbol") return "YPAL";
      if (functionName === "decimals") return 18;
      if (functionName === "DOMAIN_SEPARATOR")
        return (
          options.domain ??
          hashDomain({
            domain: {
              name: "Yunipals",
              version: "1",
              chainId: 8453n,
              verifyingContract: addresses.ypal!
            },
            types: domainTypes
          })
        );
      if (functionName === "registry") return addresses.registry;
      if (functionName === "monsters") return addresses.monsters;
      if (functionName === "wrapper") return b.vrfWrapper;
      if (functionName === "MAX_OPEN_PACKS") return 10;
      if (functionName === "PERMIT_OPEN_VERSION") return 1n;
      if (functionName === "tokenMetadataBaseURI")
        return (
          options.metadata ??
          b.tokenMetadataBasePrefix + addresses.monsters!.toLowerCase() + "/"
        );
      if (functionName === "typeCount") return options.count;
      if (functionName === "getPack")
        return {
          rules: ypalPackArguments(b, addresses).rules,
          catalogHash: validateBoosterCatalog(b.pack.catalog).catalogHash,
          ruleHash: hash(500),
          totalVariants: options.active ? 264 : 0,
          openings: 0n,
          active: options.active,
          salesPaused: false
        };
      if (functionName === "getCatalog") return b.pack.catalog;
      throw Error("Unexpected fixture call " + functionName);
    }
  } as unknown as PublicClient;
  return {
    b,
    client,
    saved,
    addresses,
    transactions,
    receipts,
    codes,
    calls,
    options
  };
}
async function withFetch(response: Response, action: () => Promise<unknown>) {
  const prior = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.cache, "no-store");
    return response;
  };
  try {
    return await action();
  } finally {
    globalThis.fetch = prior;
  }
}

test("frozen package checksum and strict fresh-only scope", async () => {
  const digest = Buffer.from(
    await crypto.subtle.digest("SHA-256", raw)
  ).toString("hex");
  assert.equal(digest, ypalLaunchPackageSha256);
  const b = await withFetch(new Response(raw), () => readYpalLaunchPackage());
  assert.equal((b as ReturnType<typeof bundle>).pack.supplyCap, "0");
  await withFetch(new Response(raw.toString() + " "), () =>
    assert.rejects(readYpalLaunchPackage(), /checksum/)
  );
  for (const key of [
    "expectedStartingNonce",
    "predictedAddresses",
    "transactions"
  ]) {
    const value = JSON.parse(raw.toString());
    value[key] = 0;
    assert.throws(() => validateYpalLaunchPackage(value));
  }
});
test("foreign wallet/backing/burn/VRF, test pack and catalog drift are refused", () => {
  for (const key of ["owner", "pmon", "burnAddress", "vrfWrapper"]) {
    const value = JSON.parse(raw.toString());
    value[key] = address(99);
    assert.throws(() => validateYpalLaunchPackage(value));
  }
  for (const change of [
    (v: ReturnType<typeof bundle>) => (v.pack.supplyCap = "1" as "0"),
    (v: ReturnType<typeof bundle>) => (v.pack.catalog.colors = [1]),
    (v: ReturnType<typeof bundle>) => (v.pack.maxBatch = 8 as 7)
  ]) {
    const value = JSON.parse(raw.toString());
    change(value);
    assert.throws(() => validateYpalLaunchPackage(value));
  }
});
test("altered code, overlapping/wrong immutable references and EIP170 overflow refuse", () => {
  for (const change of [
    (v: ReturnType<typeof bundle>) =>
      (v.artifacts.engine.creationBytecode += "00"),
    (v: ReturnType<typeof bundle>) =>
      (v.artifacts.ypal.immutableReferences[0].value = "self"),
    (v: ReturnType<typeof bundle>) =>
      (v.artifacts.monsters.immutableReferences[1].offset =
        v.artifacts.monsters.immutableReferences[0].offset),
    (v: ReturnType<typeof bundle>) => {
      v.artifacts.proxy.runtimeTemplate = ("0x" + "60".repeat(24577)) as Hex;
      v.artifacts.proxy.runtimeTemplateKeccak256 = keccak256(
        v.artifacts.proxy.runtimeTemplate
      );
    }
  ]) {
    const value = bundle();
    change(value);
    assert.throws(() => validateYpalLaunchPackage(value));
  }
});
test("actual receipt addresses construct every proxy initializer without nonce predictions", () => {
  const f = fixture(),
    state: YpalLaunchState = {
      completed: 7,
      addresses: f.addresses,
      nextStep: "metadata"
    };
  for (const key of ["registry", "monsters", "engine"] as const) {
    const action = ypalLaunchAction(f.b, key, state);
    assert.equal("nonce" in action, false);
    assert.equal(action.to, undefined);
    const appended =
      `0x${action.data.slice(f.b.artifacts.proxy.creationBytecode.length)}` as Hex;
    const [implementation, init] = decodeAbiParameters(
      parseAbiParameters("address,bytes"),
      appended
    );
    assert.equal(
      implementation.toLowerCase(),
      f.addresses[`${key}Implementation`]!.toLowerCase()
    );
    const signatures = {
      registry: "function initialize(address)",
      monsters: "function initialize(address,address)",
      engine: "function initialize(address,address,address,address)"
    } as const;
    const decoded = decodeFunctionData({
      abi: parseAbi([signatures[key]]),
      data: init
    });
    assert.equal(
      (decoded.args![0] as Address).toLowerCase(),
      f.b.owner.toLowerCase()
    );
    if (key !== "registry")
      assert.equal(
        (decoded.args![1] as Address).toLowerCase(),
        f.addresses.registry!.toLowerCase()
      );
  }
  const data = ypalLaunchAction(f.b, "metadata", state).data;
  const decoded = decodeFunctionData({
    abi: parseAbi(["function setTokenMetadataBaseURI(string)"]),
    data
  });
  assert.equal(
    decoded.args[0],
    f.b.tokenMetadataBasePrefix + f.addresses.monsters!.toLowerCase() + "/"
  );
});
test("all ten actual receipts verify one fresh type and export actual block provenance", async () => {
  const f = fixture(),
    state = await readYpalDeployment(f.client, f.b, f.saved);
  assert.equal(state.completed, 10);
  assert.equal(state.typeId, 1n);
  assert.equal(state.nextStep, null);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(state.addresses).map(([k, v]) => [k, v.toLowerCase()])
    ),
    Object.fromEntries(
      Object.entries(f.addresses).map(([k, v]) => [k, v.toLowerCase()])
    )
  );
  const manifest = ypalDeploymentManifest(f.b, state);
  assert.equal(manifest.format, "yunipals-ypal-fresh-deployment-confirmed-v1");
  assert.equal(manifest.sourceStartBlock, "102");
  assert.equal(manifest.packTypeId, "1");
  assert.equal(Object.keys(manifest.receipts).length, 10);
  assert.equal(manifest.receipts.ypal.status, "success");
  assert.equal(
    manifest.receipts.ypal.contractAddress?.toLowerCase(),
    f.addresses.ypal!.toLowerCase()
  );
  assert.equal(manifest.receipts.configure.transactionHash, f.saved.configure);
  assert.equal(manifest.packageSha256, ypalLaunchPackageSha256);
});
test("every successful prefix is recoverable without treating absent actions as complete", async () => {
  for (let n = 0; n <= 10; n++) {
    const f = fixture(n),
      state = await readYpalDeployment(f.client, f.b, f.saved);
    assert.equal(state.completed, n);
    assert.equal(state.nextStep, ypalLaunchSteps[n] ?? null);
    if (n < 10)
      assert.throws(() => ypalDeploymentManifest(f.b, state), /all ten/);
  }
});
test("a pending hash is preserved and out-of-order saved receipts refuse", async () => {
  const f = fixture(0);
  f.saved.ypal = hash(9999);
  const state = await readYpalDeployment(f.client, f.b, f.saved);
  assert.equal(state.pending?.hash, hash(9999));
  assert.equal(state.completed, 0);
  assert.equal(state.nextStep, "ypal");
  delete f.saved.ypal;
  f.saved.registry = hash(3);
  await assert.rejects(
    readYpalDeployment(f.client, f.b, f.saved),
    /original order/
  );
});
test("reverted and canonical self-cancelled transactions are terminal and never advance", async () => {
  for (const cancelled of [false, true]) {
    const f = fixture(0);
    f.saved.ypal = hash(1);
    f.receipts.get(hash(1))!.status = cancelled ? "success" : "reverted";
    if (cancelled)
      Object.assign(f.transactions.get(hash(1))!, {
        to: f.b.owner,
        input: "0x",
        value: 0n
      });
    const state = await readYpalDeployment(f.client, f.b, f.saved);
    assert.equal(state.failed?.cancelled, cancelled);
    assert.equal(state.completed, 0);
  }
});
test("receipt payload, sender, chain, header and transaction identity are authoritative", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) =>
      (f.transactions.get(hash(1))!.input = "0x6000"),
    (f: ReturnType<typeof fixture>) =>
      (f.transactions.get(hash(1))!.from = address(99)),
    (f: ReturnType<typeof fixture>) =>
      (f.transactions.get(hash(1))!.chainId = 1),
    (f: ReturnType<typeof fixture>) =>
      (f.transactions.get(hash(1))!.blockHash = hash(999)),
    (f: ReturnType<typeof fixture>) => (f.options.canonical = false)
  ]) {
    const f = fixture(1);
    mutate(f);
    await assert.rejects(readYpalDeployment(f.client, f.b, f.saved));
  }
});
test("code, implementation, roles, permit domain, metadata and fresh-type drift refuse", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) =>
      f.codes.set(f.addresses.engine!.toLowerCase(), "0x6000"),
    (f: ReturnType<typeof fixture>) =>
      (f.options.slot = padHex(address(99), { size: 32 })),
    (f: ReturnType<typeof fixture>) => (f.options.roles = false),
    (f: ReturnType<typeof fixture>) => (f.options.locked = true),
    (f: ReturnType<typeof fixture>) => (f.options.domain = hash(999)),
    (f: ReturnType<typeof fixture>) =>
      (f.options.metadata = "https://foreign.example/"),
    (f: ReturnType<typeof fixture>) => (f.options.count = 2n)
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(readYpalDeployment(f.client, f.b, f.saved));
  }
});
test("configuration receipt must contain the actual one fresh type and approved batch catalog", async () => {
  for (const count of [0, 2]) {
    const f = fixture(9),
      row = f.receipts.get(hash(9))!;
    row.logs =
      count === 0
        ? []
        : [...(row.logs as unknown[]), ...(row.logs as unknown[])];
    await assert.rejects(
      readYpalDeployment(f.client, f.b, f.saved),
      /single fresh public pack/
    );
  }
  const f = fixture(9);
  f.options.count = 2n;
  await assert.rejects(
    readYpalDeployment(f.client, f.b, f.saved),
    /registry changed/
  );
});
test("only the exact already-approved immutable artwork manifest passes", async () => {
  const b = bundle(),
    valid = JSON.parse(
      readFileSync(
        new URL("./fixtures/ypal-approved-art-manifest.json", import.meta.url),
        "utf8"
      )
    );
  assert.equal(
    "0x" +
      Buffer.from(
        await crypto.subtle.digest("SHA-256", ypalArtworkDescriptor(valid))
      ).toString("hex"),
    b.pack.artworkHash
  );
  await withFetch(Response.json(valid), () => checkYpalPublishedArtwork(b));
  await withFetch(Response.json({ ...valid, catalogHash: hash(55) }), () =>
    assert.rejects(checkYpalPublishedArtwork(b), /artwork differs/)
  );
  await withFetch(
    Response.json({ ...valid, recipeVersion: "forged-but-label-unchanged" }),
    () => assert.rejects(checkYpalPublishedArtwork(b), /artwork differs/)
  );
  assert.equal(
    new TextDecoder().decode(
      ypalArtworkDescriptor({
        z: "é🦄",
        nested: { b: 2, a: 1 },
        artworkHash: "ignored"
      })
    ),
    '{"nested":{"a":1,"b":2},"z":"\\u00e9\\ud83e\\udd84"}'
  );
});
