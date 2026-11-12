import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  PortalRehearsal,
  type RehearsalState
} from "../lib/portals/rehearsal.js";

// Public Anvil fixture, used only with mocked transports.
const signer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const initial = (): RehearsalState => ({
  chainId: 84532,
  wallets: { deployer: signer.address },
  artifactHashes: {},
  transactions: {},
  observations: {}
});
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function fixture(state = initial()) {
  const path = await mkdtemp(join(tmpdir(), "portal-rehearsal-guard-"));
  directories.push(path);
  return new PortalRehearsal("http://127.0.0.1:1", path, state);
}
describe("public rehearsal transaction guards", () => {
  it("rejects mainnet before signing or broadcasting", async () => {
    const run = await fixture();
    vi.spyOn(run.client, "getChainId").mockResolvedValue(8453);
    const broadcast = vi.spyOn(run.client, "sendRawTransaction");
    await expect(run.transaction("deployment", signer, "0x")).rejects.toThrow(
      "Base Sepolia only"
    );
    expect(broadcast).not.toHaveBeenCalled();
    expect(run.state.transactions).toEqual({});
  });
  it("refuses a changed action under a previously signed step", async () => {
    const state = initial();
    state.transactions.step = {
      hash: `0x${"1".repeat(64)}`,
      raw: "0x01",
      from: signer.address,
      data: "0x1234",
      value: "0"
    };
    const run = await fixture(state);
    vi.spyOn(run.client, "getChainId").mockResolvedValue(84532);
    const broadcast = vi.spyOn(run.client, "sendRawTransaction");
    await expect(run.transaction("step", signer, "0x5678")).rejects.toThrow();
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("rejects a different release artifact on resume", async () => {
    const run = await fixture();
    await run.verifyArtifact("release", new Uint8Array([1, 2, 3]));
    await run.verifyArtifact("release", new Uint8Array([1, 2, 3]));
    await expect(
      run.verifyArtifact("release", new Uint8Array([1, 2, 4]))
    ).rejects.toThrow("artifact changed");
  });
});
