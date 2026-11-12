import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { encodeFunctionData } from "viem";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";
import {
  airdropAllocationIsExpected,
  airdropBatchKey,
  airdropFirstSerial,
  airdropPendingTransaction,
  matchesAirdropRequest,
  parseAirdropFile,
  portalAirdropSchema
} from "../../yunipals-home-web/src/lib/portalAirdrop.js";
import type { PortalTransaction } from "../../yunipals-home-web/src/lib/portalTransactions.js";

const owner = "0x1111111111111111111111111111111111111111" as const;
const second = "0x2222222222222222222222222222222222222222" as const;
const plan = portalAirdropSchema.parse({
  version: 1,
  title: "Rainbow allocation",
  chainId: 8453,
  collection: second,
  admin: owner,
  kindId: "1",
  kindConfigurationHash: `0x${"1".repeat(64)}`,
  snapshotAt: "2026-11-12T20:00:00Z",
  expectedAllocated: 0,
  batches: [{ recipients: [owner, owner, second] }, { recipients: [owner] }]
});
describe("guided airdrop allocation", () => {
  it("preserves one card per repeated recipient and binds order and token range", () => {
    expect(plan.batches[0].recipients).toEqual([owner, owner, second]);
    expect(airdropFirstSerial(plan, 1)).toBe(4);
    expect(
      matchesAirdropRequest(plan, 0, {
        kindId: 1n,
        firstSerial: 1,
        recipients: [owner, owner, second]
      })
    ).toBe(true);
    expect(
      matchesAirdropRequest(plan, 0, {
        kindId: 1n,
        firstSerial: 1,
        recipients: [owner, second, owner]
      })
    ).toBe(false);
    expect(
      matchesAirdropRequest(plan, 0, {
        kindId: 1n,
        firstSerial: 2,
        recipients: [owner, owner, second]
      })
    ).toBe(false);
    expect(airdropAllocationIsExpected(plan, 2)).toBe(false);
    expect(airdropAllocationIsExpected(plan, 3)).toBe(true);
    expect(airdropAllocationIsExpected(plan, 4)).toBe(true);
    expect(airdropAllocationIsExpected(plan, 5)).toBe(false);
  });
  it("rejects corrupt files, zero recipients, oversized batches and range overflow", async () => {
    const text = JSON.stringify(plan),
      digest = createHash("sha256").update(text).digest("hex");
    expect(await parseAirdropFile(text, digest)).toEqual(plan);
    await expect(parseAirdropFile(text + " ", digest)).rejects.toThrow(
      "does not match"
    );
    expect(
      portalAirdropSchema.safeParse({
        ...plan,
        batches: [{ recipients: ["0x" + "0".repeat(40)] }]
      }).success
    ).toBe(false);
    expect(
      portalAirdropSchema.safeParse({
        ...plan,
        batches: [{ recipients: Array(101).fill(owner) }]
      }).success
    ).toBe(false);
    expect(
      portalAirdropSchema.safeParse({ ...plan, expectedAllocated: 998 }).success
    ).toBe(false);
  });
  it("locks a saved mint across VRF requotes and distinguishes later ranges", () => {
    const data = encodeFunctionData({
      abi: portalCollectionAbi,
      functionName: "mintBatch",
      args: [1n, [owner, owner, second], 999n]
    });
    const tx = {
      state: "indexing",
      to: second,
      data,
      actionKey: "legacy-key"
    } as PortalTransaction;
    expect(airdropPendingTransaction(plan, 0, [tx])).toBe(tx);
    expect(airdropPendingTransaction(plan, 1, [tx])).toBeUndefined();
    expect(
      airdropPendingTransaction(plan, 0, [{ ...tx, state: "failed" }])
    ).toBeUndefined();
    const next = { ...plan, expectedAllocated: 4 };
    expect(airdropBatchKey(plan, 0)).not.toBe(airdropBatchKey(next, 0));
  });
});
