import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(
  new URL("../../apps/yunipals-home-web/package.json", import.meta.url)
);
const { createPublicClient, http, parseAbi, keccak256 } = require("viem");
const { base } = require("viem/chains");
const confirmed = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/boosters/mainnet-smoke/deployment.confirmed.json",
      import.meta.url
    )
  )
);
const proxy = confirmed.contracts.engine.proxy;
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const abi = parseAbi([
  "function hasRole(bytes32,address) view returns(bool)",
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)",
  "function requestsPaused() view returns(bool)",
  "function MAX_OPEN_PACKS() view returns(uint32)"
]);
const client = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org", { retryCount: 0, timeout: 10000 })
});
const blockNumber = await client.getBlockNumber();
const [
  chainId,
  proxyCode,
  stored,
  role,
  registry,
  monsters,
  wrapper,
  requestsPaused
] = await Promise.all([
  client.getChainId(),
  client.getCode({ address: proxy, blockNumber }),
  client.getStorageAt({ address: proxy, slot, blockNumber }),
  client.readContract({
    address: proxy,
    abi,
    functionName: "hasRole",
    args: [
      keccak256(new TextEncoder().encode("UPGRADER_ROLE")),
      confirmed.admin
    ],
    blockNumber
  }),
  ...["registry", "monsters", "wrapper", "requestsPaused"].map((functionName) =>
    client.readContract({ address: proxy, abi, functionName, blockNumber })
  )
]);
assert.equal(chainId, 8453);
assert.match(stored, /^0x0{24}[0-9a-fA-F]{40}$/);
const implementation = `0x${stored.slice(-40)}`;
const implementationCode = await client.getCode({
  address: implementation,
  blockNumber
});
assert.equal(
  implementation.toLowerCase(),
  confirmed.contracts.engine.implementation.toLowerCase()
);
assert.equal(
  keccak256(implementationCode),
  "0x5a38a2010b49e7acdf9c76659d12aefd5da62bee6ec93973c898a71452852c8a"
);
assert.equal(
  keccak256(proxyCode),
  "0xa7022e521c634305b0b86f45a8c10af47878d58952877dac7af4a6cbbb165d34"
);
assert(role);
assert.equal(
  registry.toLowerCase(),
  confirmed.contracts.registry.proxy.toLowerCase()
);
assert.equal(
  monsters.toLowerCase(),
  confirmed.contracts.monsters.proxy.toLowerCase()
);
assert.equal(wrapper.toLowerCase(), confirmed.wrapper.toLowerCase());
let maxOpenPacks = null;
try {
  maxOpenPacks = Number(
    await client.readContract({
      address: proxy,
      abi,
      functionName: "MAX_OPEN_PACKS",
      blockNumber
    })
  );
} catch (error) {
  assert(error.name === "ContractFunctionExecutionError");
}
console.log(
  JSON.stringify(
    {
      format: "yunipals-batch-engine-current-chain-preflight-v1",
      observedAt: new Date().toISOString(),
      chainId,
      blockNumber: blockNumber.toString(),
      owner: confirmed.admin,
      proxy,
      proxyCodeKeccak256: keccak256(proxyCode),
      implementation,
      implementationCodeKeccak256: keccak256(implementationCode),
      upgraderRole: true,
      registry,
      monsters,
      wrapper,
      requestsPaused,
      maxOpenPacks,
      signatures: 0,
      broadcasts: 0
    },
    null,
    2
  )
);
