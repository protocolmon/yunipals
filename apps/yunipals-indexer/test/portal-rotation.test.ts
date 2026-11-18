import { describe, expect, it, vi } from "vitest";
import {
  ContractFunctionZeroDataError,
  zeroAddress,
  zeroHash,
  type PublicClient
} from "viem";
import { PortalChain } from "../lib/portals/chain.js";

function fixture(
  scheduled: unknown = [2n, 1660n, 2320n, 7n],
  pending = 0n,
  queue: unknown = new ContractFunctionZeroDataError({
    functionName: "upcomingRounds"
  }),
  refill = 0,
  revisedArtwork = false
) {
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
      if (functionName === "upcomingRounds") {
        if (queue instanceof Error) throw queue;
        return queue;
      }
      if (functionName === "refillCount") return refill;
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
        randomRequests: [123n, true, true],
        supportsInterface: revisedArtwork,
        kindArtwork: {
          imageURI: "/portal-revised.webp",
          artworkHash: zeroHash,
          revision: 1n
        },
        portalRecord: [
          1n,
          {
            sequenceStart: 0,
            sequenceLength: 100,
            colorGate: 0,
            typeGate: 0,
            originalOnly: false,
            glitterGate: false,
            diamondGate: false
          },
          zeroAddress
        ],
        getKind: {
          definition: { name: "Rainbow Portal", imageURI: "/portal.webp" }
        }
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

describe("eleven-window queue", () => {
  const rounds = Array.from({ length: 11 }, (_, i) => ({
    id: BigInt(i + 2),
    portalId: 7n,
    startsAt: BigInt(1660 + 660 * i),
    endsAt: BigInt(2320 + 660 * i)
  }));
  it.each([false, true])(
    "returns all rounds with revised artwork %s, preserves retired slots, and deduplicates metadata at the pinned block",
    async (revisedArtwork) => {
      const { chain, client } = fixture(
        undefined,
        0n,
        rounds,
        0,
        revisedArtwork
      );
      const state = await chain.active();
      expect(state.rotation.queueCapacity).toBe(11);
      expect(state.rotation.canRequest).toBe(false);
      expect(state.rotation.upcoming).toHaveLength(11);
      expect(state.rotation.upcoming[0].portal.retired).toBe(true);
      for (const round of state.rotation.upcoming) {
        expect(round.portal.imageURI).toBe(
          revisedArtwork ? "/portal-revised.webp" : "/portal.webp"
        );
      }
      expect(
        client.readContract.mock.calls.filter(
          ([call]) => call.functionName === "kindArtwork"
        )
      ).toHaveLength(revisedArtwork ? 1 : 0);
      expect(
        client.readContract.mock.calls.filter(
          ([call]) => call.functionName === "portalRecord"
        )
      ).toHaveLength(1);
      expect(
        client.readContract.mock.calls.filter(
          ([call]) => call.functionName === "getKind"
        )
      ).toHaveLength(1);
      expect(
        client.readContract.mock.calls.every(
          ([call]) => (call as { blockNumber?: bigint }).blockNumber === 10n
        )
      ).toBe(true);
    }
  );
  it("permits top-ups while future windows still exist, but blocks concurrent requests", async () => {
    const { chain } = fixture(undefined, 0n, rounds.slice(0, 10), 1);
    expect((await chain.active()).rotation.canRequest).toBe(true);
    const pending = fixture(undefined, 9n, rounds.slice(0, 10), 1).chain;
    expect((await pending.active()).rotation).toMatchObject({
      canRequest: false,
      canActivate: true,
      refillCount: 1
    });
  });
  it("reports an empty queue ready to bootstrap, without masking network failures", async () => {
    expect(
      (await fixture(undefined, 0n, [], 12).chain.active()).rotation
    ).toMatchObject({ upcoming: [], refillCount: 12, canRequest: true });
    await expect(
      fixture(undefined, 0n, new Error("RPC unavailable")).chain.active()
    ).rejects.toThrow("RPC unavailable");
  });
});
