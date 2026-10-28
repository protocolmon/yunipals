// Synthetic local Anvil fixture, never a public deployment command.
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
const rpc = process.argv[2] || "http://127.0.0.1:8598";
assert(["127.0.0.1", "localhost"].includes(new URL(rpc).hostname));
const pub = createPublicClient({ transport: http(rpc) }),
  wallet = createWalletClient({ transport: http(rpc) });
const b = JSON.parse(
  await readFile(
    new URL("../../src/lib/fixtures/eth-payment-package.json", import.meta.url),
    "utf8"
  )
);
const info = await pub.request({ method: "anvil_nodeInfo" });
assert(info.forkConfig, "Disposable Anvil fork required");
const [account] = await wallet.getAddresses();
assert.equal(
  account.toLowerCase(),
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
);
await pub.request({ method: "anvil_setCode", params: [account, "0x"] });
async function send(tx) {
  const hash = await wallet.sendTransaction({
    ...tx,
    account: tx.account || account,
    chain: null,
    gas: 9000000n
  });
  await pub.request({ method: "evm_mine" });
  const r = await pub.getTransactionReceipt({ hash });
  assert.equal(r.status, "success");
  return r;
}
const implementation = (await send({ data: b.engineCreation })).contractAddress;
const adapter = (await send({ data: b.adapterCreation })).contractAddress;
await pub.request({ method: "anvil_impersonateAccount", params: [b.owner] });
await pub.request({
  method: "anvil_setBalance",
  params: [b.owner, "0x56bc75e2d63100000"]
});
const a = await import("viem");
const admin = parseAbi([
  "function upgradeToAndCall(address,bytes)",
  "function grantRole(bytes32,address)"
]);
await send({
  account: b.owner,
  to: b.engine,
  data: a.encodeFunctionData({
    abi: admin,
    functionName: "upgradeToAndCall",
    args: [implementation, "0x"]
  })
});
await send({
  account: b.owner,
  to: b.engine,
  data: a.encodeFunctionData({
    abi: admin,
    functionName: "grantRole",
    args: [a.keccak256(a.toBytes("PAYMENT_ADAPTER_ROLE")), adapter]
  })
});
await pub.request({
  method: "anvil_stopImpersonatingAccount",
  params: [b.owner]
});
await writeFile(
  "/tmp/yunipals-eth-ui-fixture.json",
  JSON.stringify({
    rpc,
    account,
    adapter,
    engine: b.engine,
    collection: b.dependencies.monsters,
    registry: b.dependencies.registry,
    ypal: b.ypal
  })
);
console.log({ account, adapter, implementation });
