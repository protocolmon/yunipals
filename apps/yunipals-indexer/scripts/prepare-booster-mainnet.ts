/** Read-only mainnet preflight and unsigned EOA deployment plan. Never signs or sends. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import { base } from "viem/chains";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    admin: {
      type: "string",
      default: "0xB3883Cd96d72B08b8226452305A28D65974a3727"
    },
    rpc: { type: "string", default: "https://mainnet.base.org" },
    output: {
      type: "string",
      default: path.join(
        root,
        "docs/boosters/mainnet-smoke/deployment.unsigned.json"
      )
    }
  }
});
const admin = getAddress(values.admin!);
const wrapper = getAddress("0xb0407dbe851f8318bd31404A49e658143C982F23");
const proto = getAddress("0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3");
const client = createPublicClient({
  chain: base,
  transport: http(values.rpc!, { timeout: 30000, retryCount: 2 })
});
if ((await client.getChainId()) !== 8453)
  throw new Error("Base mainnet required");
const [
  block,
  nonce,
  pendingNonce,
  adminCode,
  eth,
  protoCode,
  wrapperCode,
  gasPrice
] = await Promise.all([
  client.getBlock(),
  client.getTransactionCount({ address: admin }),
  client.getTransactionCount({ address: admin, blockTag: "pending" }),
  client.getCode({ address: admin }),
  client.getBalance({ address: admin }),
  client.getCode({ address: proto }),
  client.getCode({ address: wrapper }),
  client.getGasPrice()
]);
if (adminCode && adminCode !== "0x")
  throw new Error(
    "This plan requires an EOA deployer. Keep the supplied admin, and prepare a separate deployer for a contract wallet."
  );
if (pendingNonce !== nonce)
  throw new Error(
    "Wallet has pending transactions; wait before predicting deployment addresses"
  );
if (!protoCode || !wrapperCode)
  throw new Error("PROTO/wrapper missing on Base");
const protoAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function pmon() view returns (address)",
  "function burnAddress() view returns (address)"
]);
const [protoBalance, decimals, pmon, burnAddress, fee] = await Promise.all([
  client.readContract({
    address: proto,
    abi: protoAbi,
    functionName: "balanceOf",
    args: [admin],
    blockNumber: block.number
  }),
  client.readContract({
    address: proto,
    abi: protoAbi,
    functionName: "decimals",
    blockNumber: block.number
  }),
  client.readContract({
    address: proto,
    abi: protoAbi,
    functionName: "pmon",
    blockNumber: block.number
  }),
  client.readContract({
    address: proto,
    abi: protoAbi,
    functionName: "burnAddress",
    blockNumber: block.number
  }),
  client.readContract({
    address: wrapper,
    abi: parseAbi([
      "function estimateRequestPriceNative(uint32,uint32,uint256) view returns (uint256)"
    ]),
    functionName: "estimateRequestPriceNative",
    args: [700000, 1, gasPrice],
    blockNumber: block.number
  })
]);
if (decimals !== 18) throw new Error("Expected 18-decimal PROTO");
async function artifact(name: string) {
  const data = JSON.parse(
    await readFile(
      path.join(root, "contracts/boosters/out", `${name}.sol`, `${name}.json`),
      "utf8"
    )
  ) as {
    abi: Abi;
    bytecode: { object: Hex };
    deployedBytecode: {
      object: Hex;
      immutableReferences?: Record<string, { start: number; length: number }[]>;
    };
  };
  if (!/^0x[0-9a-fA-F]+$/.test(data.bytecode.object))
    throw new Error(`Build missing: ${name}`);
  return data;
}
const [registry, monsters, engine, proxy] = await Promise.all([
  artifact("PackRegistry"),
  artifact("YunipalMonsters"),
  artifact("BoosterPacks"),
  artifact("ERC1967Proxy")
]);
const addresses = Array.from({ length: 6 }, (_, i) =>
  getContractAddress({ from: admin, nonce: BigInt(nonce + i) })
);
const transactions: {
  label: string;
  predictedAddress: Address;
  unsigned: { from: Address; chainId: Hex; nonce: Hex; value: Hex; data: Hex };
  bytecodeKeccak256: Hex;
  runtimeCodeKeccak256: Hex;
}[] = [];
const add = (label: string, data: Hex) => {
  const i = transactions.length;
  const compiled = [registry, proxy, monsters, proxy, engine, proxy][i];
  let runtime = compiled.deployedBytecode.object;
  // UUPS implementations have one immutable __self; proxy runtimes have none.
  const references = Object.values(
    compiled.deployedBytecode.immutableReferences ?? {}
  );
  if (references.length > 1)
    throw new Error(
      "Review new immutable constructor fields before preparing deployment"
    );
  for (const reference of references.flat()) {
    if (reference.length !== 32) throw new Error("Unexpected immutable width");
    const start = 2 + reference.start * 2;
    runtime = (runtime.slice(0, start) +
      addresses[i].slice(2).toLowerCase().padStart(64, "0") +
      runtime.slice(start + 64)) as Hex;
  }
  transactions.push({
    label,
    predictedAddress: addresses[i],
    unsigned: {
      from: admin,
      chainId: toHex(8453),
      nonce: toHex(nonce + i),
      value: "0x0",
      data
    },
    bytecodeKeccak256: keccak256(data),
    runtimeCodeKeccak256: keccak256(runtime)
  });
};
add("PackRegistry implementation", registry.bytecode.object);
add(
  "PackRegistry initialized proxy",
  encodeDeployData({
    abi: proxy.abi,
    bytecode: proxy.bytecode.object,
    args: [
      addresses[0],
      encodeFunctionData({
        abi: registry.abi,
        functionName: "initialize",
        args: [admin]
      })
    ]
  })
);
add("YunipalMonsters implementation", monsters.bytecode.object);
add(
  "YunipalMonsters initialized proxy",
  encodeDeployData({
    abi: proxy.abi,
    bytecode: proxy.bytecode.object,
    args: [
      addresses[2],
      encodeFunctionData({
        abi: monsters.abi,
        functionName: "initialize",
        args: [admin, addresses[1]]
      })
    ]
  })
);
add("BoosterPacks implementation", engine.bytecode.object);
add(
  "BoosterPacks initialized proxy",
  encodeDeployData({
    abi: proxy.abi,
    bytecode: proxy.bytecode.object,
    args: [
      addresses[4],
      encodeFunctionData({
        abi: engine.abi,
        functionName: "initialize",
        args: [admin, addresses[1], addresses[3], wrapper]
      })
    ]
  })
);
const report = {
  schemaVersion: 1,
  status: "unsigned-not-broadcast",
  preparedAt: new Date().toISOString(),
  chainId: 8453,
  admin,
  deployer: admin,
  observedBlock: String(block.number),
  observedBlockHash: block.hash,
  expectedStartingNonce: nonce,
  wrapper,
  proto,
  pmon,
  burnAddress,
  balances: {
    ethWei: String(eth),
    eth: formatEther(eth),
    protoRaw: String(protoBalance),
    hasOneProto: protoBalance >= 10n ** 18n
  },
  quote: {
    callbackGas: 700000,
    gasPriceWei: String(gasPrice),
    nativeVrfWei: String(fee),
    nativeVrfEth: formatEther(fee),
    note: "Read-only quote; refresh at purchase. Deployment and request network gas are additional."
  },
  contracts: {
    registry: addresses[1],
    monsters: addresses[3],
    engine: addresses[5]
  },
  instructions: [
    "Re-run before signing. Addresses depend on this wallet's exact nonce; any other transaction invalidates the remaining nonce plan.",
    "Sign and confirm each creation in order. Check receipt.contractAddress and deployed code against predictedAddress before continuing. Never send to these addresses as a recipient.",
    "No type is configured or activated by these transactions. Keep VITE_BOOSTERS_ENABLED=false on the public site.",
    "Publish the durable artwork service and check its manifest/assets before configuring a separate supplyCap=1 smoke type. No localhost metadata on mainnet.",
    "Refresh allowance, native VRF quote and deadline immediately before opening; do not pre-sign an opening with a stale quote.",
    "After live callback, verify burn, original, indexing and artwork. Pause smoke sales. Verify an accrued daily claim after 24 hours."
  ],
  transactions
};
await mkdir(path.dirname(values.output!), { recursive: true });
await writeFile(values.output!, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      file: values.output,
      ...report,
      transactions: report.transactions.map(({ unsigned, ...tx }) => ({
        ...tx,
        nonce: unsigned.nonce,
        dataBytes: (unsigned.data.length - 2) / 2
      }))
    },
    null,
    2
  )
);
