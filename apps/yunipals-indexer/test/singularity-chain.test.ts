import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  keccak256,
  toHex,
  type PublicClient
} from "viem";
import { evolutionCardsAbi } from "@protopals/yunipals-market-core/evolutionAbi";
import { singularityArtDirection } from "@protopals/yunipals-market-core/serums";
import { EvolutionChain } from "../lib/evolution/chain.js";

const address = "0x1111111111111111111111111111111111111111";
function fixture() {
  const readContract = vi.fn();
  const chain = new EvolutionChain(
    { readContract } as unknown as PublicClient,
    address,
    address,
    address,
    address
  );
  return { chain, readContract };
}
describe("Singularity on-chain capability", () => {
  it("pins the shared artwork direction in the collection implementation", () => {
    const source = readFileSync(
      new URL(
        "../../../contracts/boosters/src/YunipalMonsters.sol",
        import.meta.url
      ),
      "utf8"
    );
    const pinnedPolicy = source.match(
      /SINGULARITY_POLICY = (0x[0-9a-f]{64});/
    )?.[1];
    expect(pinnedPolicy).toBe(keccak256(toHex(singularityArtDirection)));
  });
  it("requires the exact supplemental policy at the requested block", async () => {
    const { chain, readContract } = fixture();
    const policy = keccak256(toHex(singularityArtDirection));
    readContract.mockResolvedValue(policy);
    expect(await chain.supportsSingularity(123n)).toBe(true);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address,
        functionName: "SINGULARITY_POLICY",
        blockNumber: 123n
      })
    );
    readContract.mockResolvedValue(`0x${"0".repeat(64)}`);
    await expect(chain.supportsSingularity(123n)).rejects.toThrow(
      "Unsupported Singularity"
    );
    readContract.mockRejectedValue(new Error("RPC transport failed"));
    await expect(chain.supportsSingularity(123n)).rejects.toThrow(
      "RPC transport failed"
    );
  });
  it.each(["empty", "revert"])(
    "treats an older collection's %s getter response as unavailable",
    async (kind) => {
      const { chain, readContract } = fixture();
      const parameters = {
        abi: evolutionCardsAbi,
        functionName: "SINGULARITY_POLICY"
      } as const;
      const cause =
        kind === "empty"
          ? new ContractFunctionZeroDataError(parameters)
          : new ContractFunctionRevertedError(parameters);
      readContract.mockRejectedValue(
        new ContractFunctionExecutionError(cause, parameters)
      );
      expect(await chain.supportsSingularity(123n)).toBe(false);
    }
  );
  it("uses the real recipe rather than inferring the result from a parent's level", async () => {
    const { chain, readContract } = fixture();
    readContract
      .mockResolvedValueOnce({ level: 3 })
      .mockResolvedValueOnce(keccak256(toHex(singularityArtDirection)));
    expect(await chain.fusionLevel(1n, 2n, 123n)).toBe(3);
    expect(readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "fusionRecipe",
        args: [1n, 2n],
        blockNumber: 123n
      })
    );
  });
});
