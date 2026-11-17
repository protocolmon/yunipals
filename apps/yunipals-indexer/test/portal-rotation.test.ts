import { describe, expect, it, vi } from "vitest";
import {
  ContractFunctionZeroDataError,
  zeroAddress,
  zeroHash,
  type PublicClient
} from "viem";
import { PortalChain } from "../lib/portals/chain.js";

function fixture(scheduled: unknown = [2n, 1660n, 2320n, 7n], pending = 0n) {
  const deployment = {
    chainId: 8453,
    registry: zeroAddress,
    collection: zeroAddress,
    grading: zeroAddress,
    cards: zeroAddress,
    usdc: zeroAddress
  };
  const readContract = vi.fn(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === "scheduledRound") {
        if (scheduled instanceof Error) throw scheduled;
        return scheduled;
      }
      const values: Record<string, unknown> = {
        activePortal: [
          { id: 1n, startsAt: 1000n, endsAt: 1660n, portalId: 0n },
          true
        ],
        activeRubric: zeroHash,
        admissionsPaused: false,
        pendingRotation: pending,
        portalEconomicsVersion: 2n,
        claimController: zeroAddress,
        livePortalCount: 3n,
        portalCount: 3n,
        totalPortalLiability: 0n,
        balanceOf: 0n,
        competition: zeroAddress,
        randomRequests: [123n, true, true]
      };
      if (!(functionName in values))
        throw new Error(`Unexpected call ${functionName}`);
      return values[functionName];
    }
  );
  const client = {
    readContract,
    getBlock: vi.fn(async () => ({
      number: 10n,
      timestamp: 1500n,
      hash: zeroHash
    }))
  };
  return {
    chain: new PortalChain(client as unknown as PublicClient, deployment),
    client
  };
}

describe("automatic portal rotation status", () => {
  it("blocks a second request while the next portal is scheduled", async () => {
    const { chain, client } = fixture();
    const status = await chain.active();
    expect(status.rotation).toMatchObject({
      automatic: true,
      canRequest: false,
      canActivate: false,
      scheduled: { id: 2n, portalId: 7n, startsAt: 1660n }
    });
    expect(
      client.readContract.mock.calls.every(
        ([call]) => (call as { blockNumber?: bigint }).blockNumber === 10n
      )
    ).toBe(true);
  });
  it("allows preparing the following window once the scheduled one starts", async () => {
    const { chain, client } = fixture();
    client.getBlock.mockResolvedValue({
      number: 10n,
      timestamp: 1660n,
      hash: zeroHash
    });
    expect((await chain.active()).rotation).toMatchObject({
      canRequest: true,
      scheduled: null
    });
  });
  it("allows recovery of a deferred callback before the old window ends", async () => {
    const { chain } = fixture([0n, 0n, 0n, 0n], 9n);
    expect((await chain.active()).rotation).toMatchObject({
      automatic: true,
      canRequest: false,
      canActivate: true
    });
  });
  it("supports the legacy implementation without masking RPC failures", async () => {
    const { chain } = fixture(
      new ContractFunctionZeroDataError({ functionName: "scheduledRound" }),
      9n
    );
    expect((await chain.active()).rotation).toMatchObject({
      automatic: false,
      canActivate: false,
      scheduled: null
    });
    await expect(
      fixture(new Error("RPC unavailable")).chain.active()
    ).rejects.toThrow("RPC unavailable");
  });
});
