import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeEventTopics,
  encodeAbiParameters,
  erc721Abi,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import {
  prepareIslandUnstake,
  assertIslandWithdrawal,
  islandStakingAddress
} from "@/lib/islandUnstake";
import { islandsContractAddress } from "@/lib/islandsIndexer";
const account = "0x0000000000000000000000000000000000000001";
function client(overrides: Record<string, unknown> = {}) {
  return {
    getChainId: async () => 1,
    getBlock: async () => ({ number: 123n }),
    readContract: async ({
      functionName,
      blockNumber
    }: {
      functionName: string;
      blockNumber: bigint;
    }) => {
      assert.equal(blockNumber, 123n);
      return functionName === "islandContract"
        ? islandsContractAddress
        : functionName === "ownerOf"
          ? islandStakingAddress
          : [1n];
    },
    simulateContract: async () => undefined,
    estimateContractGas: async () => 100n,
    getGasPrice: async () => 2n,
    ...overrides
  } as unknown as PublicClient;
}
test("withdrawal preflight checks custody and membership at one block and estimates fee", async () => {
  const prepared = await prepareIslandUnstake(client(), account, "1");
  assert.equal(prepared.estimatedFee, 200n);
  assert.deepEqual(prepared.call.args, [[1n]]);
  assert.equal(prepared.call.account, account);
  assert.equal(prepared.call.address, islandStakingAddress);
});
test("preflight rejects unsupported islands, wrong RPC chains, mismatched contracts, stale stakes and reverted calls", async () => {
  for (const id of ["0", "-1", "1e2", "1001", "01"])
    await assert.rejects(prepareIslandUnstake(client(), account, id));
  await assert.rejects(
    prepareIslandUnstake(client({ getChainId: async () => 56 }), account, "1"),
    /Ethereum/
  );
  await assert.rejects(
    prepareIslandUnstake(
      client({ readContract: async () => account }),
      account,
      "1"
    ),
    /collection has changed/
  );
  await assert.rejects(
    prepareIslandUnstake(
      client({
        readContract: async ({ functionName }: { functionName: string }) =>
          functionName === "islandContract"
            ? islandsContractAddress
            : functionName === "ownerOf"
              ? islandStakingAddress
              : []
      }),
      account,
      "1"
    ),
    /no longer staked/
  );
  await assert.rejects(
    prepareIslandUnstake(
      client({
        simulateContract: async () => {
          throw new Error("paused");
        }
      }),
      account,
      "1"
    ),
    /paused/
  );
});
const receipt = (
  from = islandStakingAddress,
  to = account,
  id = 1n,
  address = islandsContractAddress
) =>
  ({
    status: "success",
    logs: [
      {
        address,
        topics: encodeEventTopics({
          abi: erc721Abi,
          eventName: "Transfer",
          args: {
            from: from as `0x${string}`,
            to: to as `0x${string}`,
            tokenId: id
          }
        }),
        data: encodeAbiParameters([], [])
      }
    ]
  }) as unknown as TransactionReceipt;
test("confirmation requires a successful NFT return to this staker, including after transaction replacement", () => {
  assert.doesNotThrow(() => assertIslandWithdrawal(receipt(), account, "1"));
  for (const wrong of [
    receipt(account),
    receipt(islandStakingAddress, islandStakingAddress),
    receipt(islandStakingAddress, account, 2n),
    receipt(islandStakingAddress, account, 1n, islandStakingAddress),
    { ...receipt(), status: "reverted" as const },
    { ...receipt(), logs: [] }
  ]) {
    assert.throws(() => assertIslandWithdrawal(wrong, account, "1"));
  }
});
