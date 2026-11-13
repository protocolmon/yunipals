import { describe, expect, it, vi } from "vitest";
import {
  preparePortalRandomness,
  preparePortalRandomnessSend
} from "../../yunipals-home-web/src/lib/portalRandomness.js";

const address = "0x1111111111111111111111111111111111111111" as const;
const fees = { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 30_000_000n };
const transaction = {
  account: address,
  to: address,
  data: "0x1234" as const,
  value: 1n
};

describe("portal randomness wallet fees", () => {
  it("covers a wallet priority fee larger than the RPC gas-price quote", async () => {
    const readContract = vi.fn(async () => 23_792_465_066_579n);
    const estimateFeesPerGas = vi.fn(async () => fees);
    const prepared = await preparePortalRandomness(
      { readContract, estimateFeesPerGas } as unknown as Parameters<
        typeof preparePortalRandomness
      >[0],
      address
    );
    expect(readContract.mock.calls[0]).toEqual([
      expect.objectContaining({ args: [50_000_000n] })
    ]);
    expect(prepared.maximum).toBe(29_740_581_333_224n);
    // The previous 3,577,301,333,223 wei budget did not cover this request.
    expect(prepared.maximum).toBeGreaterThan(16_712_379_907_315n);
    const call = vi.fn(async () => ({ data: "0x" }));
    const request = await preparePortalRandomnessSend(
      { call } as unknown as Parameters<typeof preparePortalRandomnessSend>[0],
      { ...transaction, value: prepared.maximum },
      prepared.fees
    );
    expect(call.mock.calls[0]).toEqual([
      expect.objectContaining({
        gasPrice: fees.maxFeePerGas,
        value: prepared.maximum
      })
    ]);
    expect(request).toEqual({
      ...transaction,
      value: prepared.maximum,
      ...fees,
      type: "eip1559"
    });
    expect(request).not.toHaveProperty("gasPrice");
  });

  it("does not prepare a wallet request if a stale budget fails simulation", async () => {
    const call = vi
      .fn()
      .mockRejectedValue(new Error("VRF price exceeds budget"));
    await expect(
      preparePortalRandomnessSend(
        { call } as unknown as Parameters<
          typeof preparePortalRandomnessSend
        >[0],
        transaction,
        fees
      )
    ).rejects.toThrow("VRF price exceeds budget");
  });

  it("propagates fee/quote RPC errors without falling back to an underfunded send", async () => {
    const readContract = vi.fn();
    await expect(
      preparePortalRandomness(
        {
          estimateFeesPerGas: vi
            .fn()
            .mockRejectedValue(new Error("RPC unavailable")),
          readContract
        } as unknown as Parameters<typeof preparePortalRandomness>[0],
        address
      )
    ).rejects.toThrow("RPC unavailable");
    expect(readContract).not.toHaveBeenCalled();
    await expect(
      preparePortalRandomness(
        {
          estimateFeesPerGas: vi.fn().mockResolvedValue(fees),
          readContract: vi
            .fn()
            .mockRejectedValue(new Error("Quote unavailable"))
        } as unknown as Parameters<typeof preparePortalRandomness>[0],
        address
      )
    ).rejects.toThrow("Quote unavailable");
  });

  it("rejects invalid fee bounds before obtaining a quote", async () => {
    for (const invalid of [
      { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n },
      { maxFeePerGas: 1n, maxPriorityFeePerGas: 2n },
      { maxFeePerGas: 1n, maxPriorityFeePerGas: -1n }
    ]) {
      const readContract = vi.fn();
      await expect(
        preparePortalRandomness(
          {
            estimateFeesPerGas: vi.fn().mockResolvedValue(invalid),
            readContract
          } as unknown as Parameters<typeof preparePortalRandomness>[0],
          address
        )
      ).rejects.toThrow("transaction fees");
      expect(readContract).not.toHaveBeenCalled();
    }
  });
});
