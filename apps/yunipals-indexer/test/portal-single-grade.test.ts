import { describe, expect, it, vi } from "vitest";
import { zeroHash, type PublicClient } from "viem";
import { PortalChain } from "../lib/portals/chain.js";

const owner = "0x1111111111111111111111111111111111111111";
function fixture(version: bigint, pending = 0n) {
  const client = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "matches" ? true : pending
    )
  } as unknown as PublicClient;
  const chain = new PortalChain(client, {
    chainId: 8453,
    grading: owner,
    registry: owner,
    collection: owner,
    cards: owner,
    usdc: owner
  });
  vi.spyOn(chain, "active").mockResolvedValue({
    open: true,
    portal: {},
    round: { portalId: 99n },
    asOfBlock: 123n
  } as never);
  vi.spyOn(chain, "owner").mockResolvedValue(owner);
  vi.spyOn(chain, "nonce").mockResolvedValue(0n);
  vi.spyOn(chain, "input").mockResolvedValue([
    { uri: "https://example.com/card.png", hash: zeroHash },
    version
  ]);
  return chain;
}

describe("one completed grade per card", () => {
  it("quotes a first-time card for a selected portal", async () => {
    const chain = fixture(0n);
    expect((await chain.quote(1n, owner, 99n)).artVersion).toBe(0n);
    expect(chain.active).toHaveBeenCalledWith(99n);
    expect(chain.input).toHaveBeenCalledWith(1n, 123n);
  });
  it.each([1n, 3n])(
    "rejects already graded cards at version %s for any portal",
    async (version) => {
      await expect(fixture(version).quote(1n, owner, 99n)).rejects.toThrow(
        "only once"
      );
    }
  );
  it("keeps pending work distinct from a completed grade", async () => {
    await expect(fixture(0n, 42n).quote(1n, owner)).rejects.toThrow(
      "being processed"
    );
  });
});
