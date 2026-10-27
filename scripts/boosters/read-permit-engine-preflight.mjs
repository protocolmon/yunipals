import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(
  new URL("../../apps/yunipals-home-web/package.json", import.meta.url)
);
const {
  createPublicClient,
  http,
  parseAbi,
  keccak256,
  hashDomain
} = require("viem");
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
  "0xeba9d4deb6914ab67a820ea27c2fc3f43812e471"
);
assert.equal(
  keccak256(implementationCode),
  "0xa5eadd4114e6f37b1189c9729f3ea7a03ef21675ccdf69d8b3da0d6aa522ee7a"
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
assert.equal(maxOpenPacks, 10);
const token = "0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3";
const permitTokenAbi = parseAbi([
  "function name() view returns(string)",
  "function DOMAIN_SEPARATOR() view returns(bytes32)",
  "function nonces(address owner) view returns(uint256)"
]);
const [tokenName, separator, nonce] = await Promise.all([
  client.readContract({
    address: token,
    abi: permitTokenAbi,
    functionName: "name",
    blockNumber
  }),
  client.readContract({
    address: token,
    abi: permitTokenAbi,
    functionName: "DOMAIN_SEPARATOR",
    blockNumber
  }),
  client.readContract({
    address: token,
    abi: permitTokenAbi,
    functionName: "nonces",
    args: [confirmed.admin],
    blockNumber
  })
]);
const expectedSeparator = hashDomain({
  domain: {
    name: tokenName,
    version: "1",
    chainId: 8453n,
    verifyingContract: token
  },
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" }
    ]
  }
});
assert.equal(separator.toLowerCase(), expectedSeparator.toLowerCase());
console.log(
  JSON.stringify(
    {
      format: "yunipals-permit-engine-current-chain-preflight-v1",
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
      tokenPermit: {
        address: token,
        name: tokenName,
        domainVersion: "1",
        domainMatches: true,
        ownerNonce: nonce.toString()
      },
      signatures: 0,
      broadcasts: 0
    },
    null,
    2
  )
);
