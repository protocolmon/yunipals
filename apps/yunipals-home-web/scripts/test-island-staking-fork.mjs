import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  erc721Abi,
  http,
  parseAbi
} from "viem";
import {
  assertIslandWithdrawal,
  islandStakingAddress,
  islandStakingAbi,
  prepareIslandUnstake
} from "../src/lib/islandUnstake.ts";
import { islandsContractAddress } from "../src/lib/islandsIndexer.ts";

const url = new URL(process.env.ISLAND_FORK_URL ?? "http://127.0.0.1:18547");
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
  "Only a local fork is allowed"
);
const client = createPublicClient({ transport: http(url.href) });
const wallet = createWalletClient({ transport: http(url.href) });
assert.match(
  await client.request({ method: "web3_clientVersion" }),
  /^anvil\//i
);
const extraAbi = parseAbi([
  "function pmlToken() view returns (address)",
  "function PAUSER_ROLE() view returns (bytes32)",
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
  "function pause()",
  "function getIslandInfo(uint256 id) view returns ((uint256 currentStakedTime,uint256 claimableAmount,uint256 alreadyClaimed,uint256 totalClaimableAmount,bool staked,bool exhausted))"
]);
const impersonate = async (account) => {
  await client.request({
    method: "anvil_impersonateAccount",
    params: [account]
  });
  await client.request({
    method: "anvil_setBalance",
    params: [account, "0x56bc75e2d63100000"]
  });
};
const read = (functionName, args = []) =>
  client.readContract({
    address: islandStakingAddress,
    abi: extraAbi,
    functionName,
    args
  });
const report = { block: String(await client.getBlockNumber()), tests: [] };
for (const [id, account] of [
  ["1", "0x4d294954a76747b34e1087cfe8e9d5fe24f8c0f6"],
  ["8", "0xd073689109503876c28f210a14a6993d2c16866d"],
  ["9", "0x13c5d201925b15a6c7c47e0c40700bbc26adb45d"]
]) {
  const snapshot = await client.request({ method: "evm_snapshot" });
  try {
    await impersonate(account);
    const prepared = await prepareIslandUnstake(client, account, id);
    assert.ok(prepared.estimatedFee > 0n);
    await assert.rejects(
      prepareIslandUnstake(
        client,
        "0x0000000000000000000000000000000000000001",
        id
      ),
      /no longer staked/
    );
    const reward = await read("pmlToken");
    const balance = () =>
      client.readContract({
        address: reward,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account]
      });
    const before = await balance();
    const info = await read("getIslandInfo", [BigInt(id)]);
    const hash = await wallet.writeContract({
      ...prepared.call,
      chain: null,
      gas: 1_000_000n
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assertIslandWithdrawal(receipt, account, id);
    assert.equal(
      (
        await client.readContract({
          address: islandsContractAddress,
          abi: erc721Abi,
          functionName: "ownerOf",
          args: [BigInt(id)]
        })
      ).toLowerCase(),
      account
    );
    const remaining = await client.readContract({
      address: islandStakingAddress,
      abi: islandStakingAbi,
      functionName: "stakedIslandsOf",
      args: [account]
    });
    assert.ok(!remaining.includes(BigInt(id)));
    const delta = (await balance()) - before;
    assert.equal(delta, info.claimableAmount);
    await assert.rejects(
      prepareIslandUnstake(client, account, id),
      /no longer staked/
    );
    report.tests.push({
      id,
      exhausted: info.exhausted,
      returnedToStaker: true,
      removedFromStakes: true,
      automaticallyClaimed: String(delta),
      gas: String(receipt.gasUsed)
    });
  } finally {
    await client.request({ method: "evm_revert", params: [snapshot] });
  }
}
const snapshot = await client.request({ method: "evm_snapshot" });
try {
  const pauser = await read("getRoleMember", [await read("PAUSER_ROLE"), 0n]);
  await impersonate(pauser);
  const hash = await wallet.writeContract({
    address: islandStakingAddress,
    abi: extraAbi,
    functionName: "pause",
    account: pauser,
    chain: null,
    gas: 200_000n
  });
  assert.equal(
    (await client.waitForTransactionReceipt({ hash })).status,
    "success"
  );
  try {
    await prepareIslandUnstake(
      client,
      "0x4d294954a76747b34e1087cfe8e9d5fe24f8c0f6",
      "1"
    );
    report.pausedWithdrawal = "allowed";
  } catch {
    report.pausedWithdrawal = "blocked";
  }
} finally {
  await client.request({ method: "evm_revert", params: [snapshot] });
}
assert.equal(report.pausedWithdrawal, "blocked");
console.log(JSON.stringify(report, null, 2));
