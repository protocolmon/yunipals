import { describe, expect, it, vi } from "vitest";
import { type PublicClient } from "viem";
import { readPortalDisplayKind } from "./artwork.js";

const collection = "0x1111111111111111111111111111111111111111";
const original = {
  definition: {
    name: "Rainbow Portal",
    imageURI: "ipfs://original",
    artworkHash: "0x01"
  },
  configurationHash: "0x02",
  frozen: true
};
function reader(supported: boolean, failure?: Error) {
  const readContract = vi.fn(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === "getKind") return original;
      if (functionName === "supportsInterface") return supported;
      if (failure) throw failure;
      return { imageURI: "ipfs://revised", artworkHash: "0x03", revision: 1n };
    }
  );
  return {
    readContract,
    client: { readContract } as unknown as Pick<PublicClient, "readContract">
  };
}
describe("portal presentation artwork", () => {
  it("reads original artwork before the contract upgrade", async () => {
    const { client, readContract } = reader(false);
    expect(await readPortalDisplayKind(client, collection, 1n, 123n)).toBe(
      original
    );
    expect(readContract).toHaveBeenCalledTimes(2);
  });
  it("uses the revision at the same snapshot block for every read", async () => {
    const { client, readContract } = reader(true);
    const result = await readPortalDisplayKind(client, collection, 1n, 123n);
    expect(result.definition.imageURI).toBe("ipfs://revised");
    expect(result.definition.artworkHash).toBe("0x03");
    expect(original.definition.imageURI).toBe("ipfs://original");
    for (const [call] of readContract.mock.calls) {
      expect(call).toMatchObject({ address: collection, blockNumber: 123n });
    }
  });
  it("does not hide an artwork read failure behind stale original artwork", async () => {
    const { client } = reader(true, new Error("RPC unavailable"));
    await expect(
      readPortalDisplayKind(client, collection, 1n, 123n)
    ).rejects.toThrow("RPC unavailable");
  });
});
