import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  erc721Abi,
  hashDomain,
  http,
  keccak256,
  parseAbi,
  size
} from "viem";

import {
  marketplaceChains,
  seaportDeployment
} from "../src/lib/marketplace/registry.ts";
import {
  createNativeListing,
  seaportOrderHash,
  seaportReadAbi
} from "../src/lib/marketplace/seaport.ts";

const { values } = parseArgs({
  options: {
    chain: { type: "string", multiple: true },
    block: { type: "string" },
    "token-id": { type: "string" },
    output: { type: "string" }
  }
});
const selected = values.chain ?? Object.keys(marketplaceChains);
if (
  !selected.length ||
  selected.some((chain) => !(chain in marketplaceChains))
) {
  throw new Error("Choose ethereum, base, polygon, or bnb with --chain.");
}
if ((values.block || values["token-id"]) && selected.length !== 1) {
  throw new Error("--block and --token-id require exactly one --chain.");
}
for (const number of [values.block, values["token-id"]].filter(Boolean)) {
  if (!/^(0|[1-9][0-9]*)$/.test(number)) {
    throw new Error("Block and token ID must be unsigned integer strings.");
  }
}

const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
};
const erc165Abi = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)"
]);

async function inspect(chain) {
  const config = marketplaceChains[chain];
  const envName = `YUNIPALS_${chain.toUpperCase()}_RPC_URL`;
  const rpcUrl = process.env[envName];
  const result = {
    chain,
    chainId: config.chainId,
    status: "failed",
    checks: {}
  };
  if (!rpcUrl) return { ...result, reason: `Missing ${envName}.` };
  let parsed;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    return { ...result, reason: `${envName} must contain a valid RPC URL.` };
  }
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    )
  ) {
    return { ...result, reason: "RPC must use HTTPS or be a loopback fork." };
  }
  const client = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0, timeout: 15_000 })
  });
  let stage = "chain";
  try {
    const chainId = await client.getChainId();
    if (chainId !== config.chainId) throw new Error("RPC_CHAIN_MISMATCH");
    const blockNumber = values.block
      ? BigInt(values.block)
      : await client.getBlockNumber();
    result.blockNumber = blockNumber.toString();
    stage = "deployment";
    const [block, code, nftCode, name, information, supports721] =
      await Promise.all([
        client.getBlock({ blockNumber }),
        client.getCode({ address: seaportDeployment.address, blockNumber }),
        client.getCode({ address: config.contractAddress, blockNumber }),
        client.readContract({
          address: seaportDeployment.address,
          abi: seaportReadAbi,
          functionName: "name",
          blockNumber
        }),
        client.readContract({
          address: seaportDeployment.address,
          abi: seaportReadAbi,
          functionName: "information",
          blockNumber
        }),
        client.readContract({
          address: config.contractAddress,
          abi: erc165Abi,
          functionName: "supportsInterface",
          args: ["0x80ac58cd"],
          blockNumber
        })
      ]);
    result.blockHash = block.hash;
    result.seaport = {
      address: seaportDeployment.address,
      name,
      version: information[0],
      codeBytes: code ? size(code) : 0,
      codeHash: code ? keccak256(code) : null,
      conduitController: information[2]
    };
    result.collection = {
      address: config.contractAddress,
      codeBytes: nftCode ? size(nftCode) : 0,
      supports721
    };
    const domain = {
      name: seaportDeployment.name,
      version: seaportDeployment.version,
      chainId,
      verifyingContract: seaportDeployment.address
    };
    result.checks = {
      seaportCode: Boolean(code && code !== "0x"),
      collectionCode: Boolean(nftCode && nftCode !== "0x"),
      name: name === seaportDeployment.name,
      version: information[0] === seaportDeployment.version,
      domain:
        information[1].toLowerCase() ===
        hashDomain({ domain, types: domainTypes }).toLowerCase(),
      erc721: supports721
    };
    stage = "order_hash";
    // Hashing doesn't transfer an NFT or require this fixture ID to exist.
    const order = createNativeListing({
      seller: "0x0000000000000000000000000000000000000001",
      collection: config.contractAddress,
      tokenId: BigInt(values["token-id"] ?? "1"),
      totalPrice: 10n ** 18n,
      startTime: block.timestamp,
      endTime: block.timestamp + 86_400n,
      counter: 0n,
      salt: 123456n
    });
    const contractHash = await client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getOrderHash",
      args: [order],
      blockNumber
    });
    result.checks.orderHash =
      contractHash.toLowerCase() === seaportOrderHash(order).toLowerCase();
    if (values["token-id"]) {
      stage = "token_ownership";
      const tokenId = BigInt(values["token-id"]);
      const owner = await client.readContract({
        address: config.contractAddress,
        abi: erc721Abi,
        functionName: "ownerOf",
        args: [tokenId],
        blockNumber
      });
      result.token = { tokenId: tokenId.toString(), owner };
    }
    result.status = Object.values(result.checks).every(Boolean)
      ? "passed"
      : "failed";
    return result;
  } catch (error) {
    // Provider errors may contain credential-bearing URLs; never persist them.
    return {
      ...result,
      stage,
      reason:
        error instanceof Error && error.message === "RPC_CHAIN_MISMATCH"
          ? error.message
          : (error?.name ?? "RpcError")
    };
  }
}

const chains = await Promise.all(selected.map(inspect));
const report = {
  checkedAt: new Date().toISOString(),
  scope:
    "Read-only deployment, domain, interface and order-hash checks. Does not establish NFT transfer, wallet, lifecycle or full trading compatibility.",
  chains
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (values.output) await writeFile(values.output, output, { mode: 0o600 });
process.stdout.write(output);
if (chains.some((chain) => chain.status !== "passed")) process.exitCode = 1;
