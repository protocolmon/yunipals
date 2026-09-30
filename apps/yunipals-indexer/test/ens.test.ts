import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { clearEnsForwardCache, InvalidOwnerError, normalizeOwnerName, resolveOwner, verifiedPrimaryName, type EnsClient } from "../lib/ens/resolver.js";
import { ensTargets } from "../lib/ens/targets.js";

const ethereumAddress = "0x0000000000000000000000000000000000000001" as Address;
const baseAddress = "0x0000000000000000000000000000000000000002" as Address;
const polygonAddress = "0x0000000000000000000000000000000000000003" as Address;
const bnbAddress = "0x0000000000000000000000000000000000000004" as Address;

beforeEach(() => clearEnsForwardCache());

describe("ENS owner resolution", () => {
  it("uses literal addresses on every requested chain without RPC", async () => {
    const client: EnsClient = { getEnsAddress: vi.fn(), getEnsName: vi.fn() };
    const result = await resolveOwner(ethereumAddress, ["ethereum", "base", "polygon", "bnb"], client);
    expect(result.addresses).toEqual({ ethereum: ethereumAddress, base: ethereumAddress, polygon: ethereumAddress, bnb: ethereumAddress });
    expect(client.getEnsAddress).not.toHaveBeenCalled();
  });

  it("resolves chain-specific records through the configured coin types", async () => {
    const getEnsAddress = vi.fn(async ({ coinType }: { coinType?: bigint }) =>
      coinType === 60n ? ethereumAddress
        : coinType === 2_147_492_101n ? baseAddress
          : coinType === 2_147_483_785n ? polygonAddress : bnbAddress);
    const client: EnsClient = { getEnsAddress, getEnsName: vi.fn() };
    const result = await resolveOwner("Example.ETH", ["ethereum", "base", "polygon", "bnb"], client);
    expect(result.normalizedName).toBe("example.eth");
    expect(result.addresses).toEqual({ ethereum: ethereumAddress, base: baseAddress, polygon: polygonAddress, bnb: bnbAddress });
    expect(getEnsAddress).toHaveBeenCalledWith({ name: "example.eth", coinType: 60n });
    expect(getEnsAddress).toHaveBeenCalledWith({ name: "example.eth", coinType: 2147492101n });
    expect(getEnsAddress).toHaveBeenCalledWith({ name: "example.eth", coinType: 2147483785n });
    expect(getEnsAddress).toHaveBeenCalledWith({ name: "example.eth", coinType: 2147483704n });
  });

  it("rejects malformed owner identifiers", () => {
    expect(() => normalizeOwnerName("not-an-address")).toThrow(InvalidOwnerError);
  });

  it("accepts a reverse name only after chain-specific forward verification", async () => {
    const valid: EnsClient = { getEnsName: vi.fn(async () => "Example.eth"), getEnsAddress: vi.fn(async () => ethereumAddress) };
    const spoofed: EnsClient = { getEnsName: vi.fn(async () => "spoof.eth"), getEnsAddress: vi.fn(async () => baseAddress) };
    await expect(verifiedPrimaryName(ethereumAddress, "ethereum", valid)).resolves.toBe("example.eth");
    await expect(verifiedPrimaryName(ethereumAddress, "ethereum", spoofed)).resolves.toBeNull();
  });
});

describe("leaderboard ENS targets", () => {
  it("deduplicates wallets and resolves combined-scope candidates on all chains", () => {
    const targets = ensTargets([
      { owner: ethereumAddress, scopes: ["all", "ethereum"] },
      { owner: ethereumAddress, scopes: ["base"] },
      { owner: baseAddress, scopes: ["ethereum"] }
    ]);
    expect(targets).toHaveLength(5);
    expect(targets.map(({ chain, address }) => `${chain}:${address.toLowerCase()}`)).toEqual([
      `ethereum:${ethereumAddress}`, `base:${ethereumAddress}`, `polygon:${ethereumAddress}`, `bnb:${ethereumAddress}`,
      `ethereum:${baseAddress}`
    ]);
  });
});
