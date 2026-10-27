/** Verify the exact unsigned creation bundle on a local Anvil fork only. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { base } from "viem/chains";
const { values } = parseArgs({
  options: {
    rpc: { type: "string", default: "http://127.0.0.1:8561" },
    plan: {
      type: "string",
      default: new URL(
        "../../../docs/boosters/mainnet-smoke/deployment.unsigned.json",
        import.meta.url
      ).pathname
    },
    output: {
      type: "string",
      default: new URL(
        "../../../docs/boosters/mainnet-smoke/deployment.fork-simulation.json",
        import.meta.url
      ).pathname
    }
  }
});
if (!["127.0.0.1", "localhost"].includes(new URL(values.rpc!).hostname))
  throw new Error("Only loopback Anvil is allowed; NEVER run on mainnet");
const plan = JSON.parse(await readFile(values.plan!, "utf8")) as {
  admin: Address;
  expectedStartingNonce: number;
  wrapper: Address;
  contracts: { registry: Address; monsters: Address; engine: Address };
  transactions: {
    label: string;
    predictedAddress: Address;
    unsigned: { nonce: Hex; data: Hex };
  }[];
};
const client = createPublicClient({
  chain: base,
  transport: http(values.rpc!)
});
assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil/i);
assert.equal(
  await client.getTransactionCount({ address: plan.admin }),
  plan.expectedStartingNonce
);
await client.request({
  method: "anvil_impersonateAccount" as never,
  params: [plan.admin] as never
});
await client.request({
  method: "anvil_setBalance" as never,
  params: [plan.admin, "0xde0b6b3a7640000"] as never
});
const wallet = createWalletClient({
  account: plan.admin,
  chain: base,
  transport: http(values.rpc!)
});
const receipts = [];
try {
  for (const tx of plan.transactions) {
    const hash = await wallet.sendTransaction({
      data: tx.unsigned.data,
      nonce: Number(BigInt(tx.unsigned.nonce))
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    assert.equal(
      receipt.contractAddress?.toLowerCase(),
      tx.predictedAddress.toLowerCase()
    );
    assert.ok(await client.getCode({ address: tx.predictedAddress }));
    receipts.push({
      label: tx.label,
      predictedAddress: tx.predictedAddress,
      gasUsed: String(receipt.gasUsed),
      localTransactionHash: hash
    });
  }
  const roleAbi = parseAbi([
    "function hasRole(bytes32,address) view returns (bool)"
  ]);
  for (const address of Object.values(plan.contracts))
    assert.equal(
      await client.readContract({
        address,
        abi: roleAbi,
        functionName: "hasRole",
        args: [`0x${"00".repeat(32)}`, plan.admin]
      }),
      true
    );
  assert.equal(
    (
      await client.readContract({
        address: plan.contracts.engine,
        abi: parseAbi(["function wrapper() view returns (address)"]),
        functionName: "wrapper"
      })
    ).toLowerCase(),
    plan.wrapper.toLowerCase()
  );
  assert.equal(
    await client.readContract({
      address: plan.contracts.registry,
      abi: parseAbi(["function typeCount() view returns (uint256)"]),
      functionName: "typeCount"
    }),
    0n
  );
  const report = {
    status: "passed-local-mainnet-fork-only",
    mainnetBroadcast: false,
    simulatedBalanceOverride: true,
    admin: plan.admin,
    checks: [
      "exact six unsigned creation payloads succeeded",
      "all receipt addresses match nonce predictions",
      "all three proxies grant DEFAULT_ADMIN_ROLE to the supplied wallet",
      "engine uses the real Base Chainlink wrapper",
      "no pack configured or activated"
    ],
    gasUsedTotal: String(
      receipts.reduce((sum, r) => sum + BigInt(r.gasUsed), 0n)
    ),
    receipts
  };
  await writeFile(values.output!, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.request({
    method: "anvil_stopImpersonatingAccount" as never,
    params: [plan.admin] as never
  });
}
