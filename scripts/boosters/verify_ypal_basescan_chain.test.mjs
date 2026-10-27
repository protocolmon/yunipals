import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  prepare,
  publicReadClient,
  PUBLIC_RPC,
  RPC_CAP
} from "./verify_ypal_basescan_chain.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(root + "apps/yunipals-home-web/package.json");
const {
  encodeAbiParameters,
  parseAbiParameters,
  decodeAbiParameters,
  decodeFunctionData,
  parseAbi
} = require("viem");
const bundle = JSON.parse(
  fs.readFileSync(
    root + "apps/yunipals-home-web/public/boosters/ypal-fresh-launch-v1.json"
  )
);
const art = JSON.parse(
  fs.readFileSync(
    root +
      "apps/yunipals-home-web/src/lib/fixtures/ypal-approved-art-manifest.json"
  )
);
const address = (n) => "0x" + n.toString(16).padStart(40, "0");
const hash = (n) => "0x" + n.toString(16).padStart(64, "0");
const steps = [
  "ypal",
  "registryImplementation",
  "registry",
  "monstersImplementation",
  "monsters",
  "engineImplementation",
  "engine",
  "metadata",
  "configure",
  "activate"
];
export function confirmedFixture() {
  const rows = Object.fromEntries(
    steps.map((step, i) => [
      step,
      {
        transactionHash: hash(i + 1),
        blockNumber: String(i + 100),
        blockHash: hash(i + 1000),
        status: "success",
        contractAddress: i < 7 ? address(i + 1000) : null
      }
    ])
  );
  return {
    format: "yunipals-ypal-fresh-deployment-confirmed-v1",
    launchId: "base-ypal-v1",
    chainId: 8453,
    owner: bundle.owner,
    pmon: bundle.pmon,
    burnAddress: bundle.burnAddress,
    vrfWrapper: bundle.vrfWrapper,
    ypal: address(1000),
    registry: address(1002),
    monsters: address(1004),
    engine: address(1006),
    implementations: {
      registry: address(1001),
      monsters: address(1003),
      engine: address(1005)
    },
    packTypeId: "1",
    packageSha256:
      "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886",
    sourceStartBlock: "102",
    metadataBaseURI: bundle.tokenMetadataBasePrefix + address(1004) + "/",
    artworkHash: bundle.pack.artworkHash,
    catalogHash: art.catalogHash,
    receipts: rows
  };
}

const confirmed = confirmedFixture();
const plan = await prepare(confirmed);
assert.equal(plan.chainQualified, false);
assert.equal(plan.qualification, null);
assert.equal(plan.contracts.length, 7);
assert.equal(plan.explorerCalls, 0);
assert.equal(plan.transactionsSent, 0);
assert.deepEqual(
  plan.contracts.map((row) => row.address),
  steps.slice(0, 7).map((step) => confirmed.receipts[step].contractAddress)
);
assert.equal(
  plan.contracts[0].constructorArguments,
  encodeAbiParameters(parseAbiParameters("address,address"), [
    bundle.pmon,
    bundle.burnAddress
  ]).slice(2)
);
assert(
  plan.contracts
    .filter((row) => row.step.endsWith("Implementation"))
    .every((row) => row.constructorArguments === "")
);
console.log(
  "PASS pure receipt-derived seven-contract preparation; no chain or explorer claim"
);

for (const row of plan.contracts.filter((row) => row.implementation)) {
  const [implementation, data] = decodeAbiParameters(
    parseAbiParameters("address,bytes"),
    "0x" + row.constructorArguments
  );
  assert.equal(
    implementation.toLowerCase(),
    confirmed.implementations[row.step].toLowerCase()
  );
  const signatures = {
    registry: "function initialize(address)",
    monsters: "function initialize(address,address)",
    engine: "function initialize(address,address,address,address)"
  };
  const init = decodeFunctionData({
    abi: parseAbi([signatures[row.step]]),
    data
  });
  assert.equal(init.args[0].toLowerCase(), bundle.owner.toLowerCase());
  if (row.step !== "registry")
    assert.equal(init.args[1].toLowerCase(), confirmed.registry);
  if (row.step === "engine") {
    assert.equal(init.args[2].toLowerCase(), confirmed.monsters);
    assert.equal(init.args[3].toLowerCase(), bundle.vrfWrapper.toLowerCase());
  }
}
console.log(
  "PASS proxy initializer constructor args use actual confirmed dependencies"
);

const seen = [];
const fetcher = async (url, options) => {
  assert.equal(url, PUBLIC_RPC);
  const body = JSON.parse(options.body);
  seen.push(body.method);
  const value =
    body.method === "eth_chainId"
      ? "0x2105"
      : body.method === "eth_getStorageAt"
        ? hash(5)
        : body.method === "eth_call"
          ? hash(1)
          : "0x1";
  return Response.json({ jsonrpc: "2.0", id: body.id, result: value });
};
const reader = publicReadClient(fetcher);
assert.equal(await reader.client.getChainId(), 8453);
await reader.client.getStorageAt({
  address: confirmed.registry,
  slot: hash(0)
});
await reader.client.readContract({
  address: confirmed.registry,
  abi: parseAbi(["function typeCount() view returns(uint256)"]),
  functionName: "typeCount"
});
assert.deepEqual(seen, ["eth_chainId", "eth_getStorageAt", "eth_call"]);
assert.equal(reader.summary().financialIndexerProfileUsed, false);
assert.equal(reader.summary().paidProvider, false);
assert.equal(reader.summary().profileChanges, 0);
console.log(
  "PASS actual viem wire uses only fixed public Base readonly endpoint, without source-profile claims"
);

await assert.rejects(
  reader.client.request({
    method: "eth_sendRawTransaction",
    params: ["0x1234"]
  })
);
assert.equal(seen.length, 3);
assert.equal(reader.summary().rpcCalls, 3);
console.log("PASS transaction RPC rejected before transport entry");

const bounded = publicReadClient(fetcher);
for (let i = 0; i < RPC_CAP; i++)
  await bounded.client.request({ method: "eth_blockNumber" });
await assert.rejects(bounded.client.request({ method: "eth_blockNumber" }));
assert.equal(bounded.summary().rpcCalls, 128);
assert.equal(bounded.summary().maximumSeconds, 180);
console.log(
  "PASS exact128-request cap refuses further reads without retry or fallback"
);

const foreign = confirmedFixture();
foreign.receipts.registry.contractAddress = address(9999);
await assert.rejects(prepare(foreign));
console.log(
  "PASS foreign receipt address cannot change the intended contract set"
);
console.log("6 YPAL verifier bridge controls passed; synthetic RPC only");
