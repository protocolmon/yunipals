import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { ethSetupBundle, matchesEthRuntime } from "./boosterEthSetup";
import source from "./fixtures/eth-payment-package-source.json" with { type: "json" };

test("deployment runtime checks allow only declared immutable spans", () => {
  const template = `0x${"00".repeat(32)}aabb`;
  const refs = { self: [{ start: 0, length: 32 }] };
  const deployed = `0x${"11".repeat(32)}aabb` as Hex;
  assert.equal(matchesEthRuntime(deployed, template, refs), true);
  assert.equal(matchesEthRuntime(deployed, template, {}), false);
  assert.equal(
    matchesEthRuntime(`${deployed.slice(0, -2)}ff` as Hex, template, refs),
    false
  );
  assert.equal(matchesEthRuntime(`${deployed}00`, template, refs), false);
});

test("the reviewed ETH launch package is preserved across later engine releases", async () => {
  const bytes = await readFile(
    new URL("./fixtures/eth-payment-package.json", import.meta.url)
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    source.packageSha256
  );
});

test("review package matches contracts compiled from its pinned source", async (context) => {
  // A newer engine can add portal mint facts without silently rewriting a
  // previously reviewed deployment package. CI compiles this exact source.
  const root = process.env.BOOSTER_ETH_REVIEW_ARTIFACT_DIRECTORY;
  if (!root)
    return context.skip(
      `Compile source ${source.commit} and set BOOSTER_ETH_REVIEW_ARTIFACT_DIRECTORY (see booster-eth.yml).`
    );
  const artifact = async (name: string) =>
    JSON.parse(
      await readFile(resolve(root, `${name}.sol/${name}.json`), "utf8")
    );
  const [engine, adapter] = await Promise.all([
    artifact("BoosterPacks"),
    artifact("BoosterEthPayment")
  ]);
  assert.equal(ethSetupBundle.engineCreation, engine.bytecode.object);
  assert.equal(ethSetupBundle.engineRuntime, engine.deployedBytecode.object);
  assert.ok((ethSetupBundle.engineRuntime.length - 2) / 2 <= 24576);
  assert.equal(ethSetupBundle.adapterRuntime, adapter.deployedBytecode.object);
  const constructor = encodeAbiParameters(
    parseAbiParameters("address,address,address,address,address,address"),
    [
      ethSetupBundle.engine,
      ethSetupBundle.ypal,
      ethSetupBundle.proto,
      ethSetupBundle.weth,
      ethSetupBundle.v2,
      ethSetupBundle.v3
    ] as [Hex, Hex, Hex, Hex, Hex, Hex]
  );
  assert.equal(
    ethSetupBundle.adapterCreation,
    adapter.bytecode.object + constructor.slice(2)
  );
});

test("deployment admission rejects foreign senders, creation data, code and roles", async () => {
  const { ethSetupState } = await import("./boosterEthSetup");
  const { baseEthRoutes } = await import("./boosterEth");
  const { padHex } = await import("viem");
  const implementation = "0x1111111111111111111111111111111111111111";
  const adapter = "0x2222222222222222222222222222222222222222";
  const engineHash = `0x${"11".repeat(32)}` as Hex;
  const adapterHash = `0x${"22".repeat(32)}` as Hex;
  const b = ethSetupBundle;
  let wrongSender = false,
    wrongData = false,
    wrongCode = false,
    grant = true;
  function runtime(
    template: string,
    references: Record<string, { start: number; length: number }[]>,
    address: Hex
  ) {
    let value = template;
    for (const span of Object.values(references).flat())
      value =
        value.slice(0, 2 + span.start * 2) +
        padHex(address).slice(2) +
        value.slice(2 + (span.start + span.length) * 2);
    return value;
  }
  const client = {
    getChainId: async () => 8453,
    getStorageAt: async () => padHex(implementation),
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
      status: "success",
      transactionHash: hash,
      contractAddress: hash === engineHash ? implementation : adapter
    }),
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      from: wrongSender ? adapter : b.owner,
      to: null,
      value: 0n,
      input: wrongData
        ? "0x"
        : hash === engineHash
          ? b.engineCreation
          : b.adapterCreation
    }),
    getCode: async ({ address }: { address: string }) =>
      wrongCode
        ? "0xff"
        : address === implementation
          ? runtime(b.engineRuntime, b.engineImmutables, implementation)
          : runtime(b.adapterRuntime, b.adapterImmutables, adapter),
    readContract: async ({
      address,
      functionName
    }: {
      address: string;
      functionName: string;
    }) => {
      if (functionName === "hasRole") return grant;
      if (functionName === "VERSION") return 1n;
      if (functionName === "PAYMENT_ADAPTER_ROLE") return engineHash;
      if (address === b.engine)
        return b.dependencies[functionName as keyof typeof b.dependencies];
      if (functionName === "engine") return b.engine;
      if (functionName === "ypal") return b.ypal;
      return baseEthRoutes[functionName as keyof typeof baseEthRoutes];
    }
  } as unknown as import("viem").PublicClient;
  const receipts = { implementation: engineHash, adapter: adapterHash };
  assert.equal((await ethSetupState(client, receipts)).activated, true);
  wrongSender = true;
  await assert.rejects(() => ethSetupState(client, receipts), /receipt/);
  wrongSender = false;
  wrongData = true;
  await assert.rejects(() => ethSetupState(client, receipts), /receipt/);
  wrongData = false;
  wrongCode = true;
  await assert.rejects(() => ethSetupState(client, receipts), /runtime/);
  wrongCode = false;
  grant = false;
  await assert.rejects(() => ethSetupState(client, receipts), /roles/);
});
