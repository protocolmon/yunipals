import { describe, expect, it, vi } from "vitest";
import {
  keccak256,
  toHex,
  recoverTypedDataAddress,
  zeroAddress,
  zeroHash,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  portalAdmissionHash,
  portalIntakeRole,
  portalIntakeSigningData,
  portalSpellCommitment
} from "@protopals/yunipals-market-core/portals";
import { PortalIntakeSigner } from "../lib/portals/intake.js";
import type { PortalChain } from "../lib/portals/chain.js";
import type { PortalStore } from "../lib/portals/store.js";

const account = privateKeyToAccount(
  keccak256(toHex("synthetic intake unit test key"))
);
const grading = "0x1111111111111111111111111111111111111111";
const submitter = "0x2222222222222222222222222222222222222222";
const pool = "0x3333333333333333333333333333333333333333";
function fixture() {
  const input = {
    chainId: 8453,
    grading,
    submitter,
    tokenId: 1n,
    artVersion: 0n,
    nonce: 0n,
    spell: "A guardian woven from sunlight.",
    salt: zeroHash
  } as const;
  const commitment = portalSpellCommitment(input);
  const admission = {
    tokenId: 1n,
    portalId: 2n,
    roundId: 3n,
    paymentVersion: 4n,
    artVersion: 0n,
    rubricId: zeroHash,
    maximumFee: 990000n,
    inputHash: zeroHash,
    spellCommitment: commitment,
    nonce: 0n
  };
  const stored = {
    ...input,
    tokenId: "1",
    artVersion: "0",
    nonce: "0",
    commitment
  };
  const store = { spell: vi.fn(async () => stored) };
  const quote = {
    round: { id: 3n, portalId: 2n, endsAt: 1400n },
    now: 1000,
    artVersion: 0n,
    nonce: 0n,
    rubricId: zeroHash,
    input: { hash: zeroHash },
    portal: { payment: { version: 4n, aiFee: 245000n, portalFee: 245000n } },
    competition: { address: pool, admissionHash: zeroHash, fee: 500000n }
  };
  const readContract = vi.fn(
    async ({
      functionName,
      args
    }: {
      functionName: string;
      args?: [Hex, string];
    }) =>
      functionName === "intakeVersion" ? 1n : args?.[0] === portalIntakeRole
  );
  const chain = {
    deployment: { chainId: 8453, grading },
    client: { readContract },
    quote: vi.fn(async () => quote)
  };
  const signer = new PortalIntakeSigner(account);
  const request = {
    ...input,
    commitment,
    expiresAt: 1600n,
    admissionHash: portalAdmissionHash(admission)
  };
  const issue = () =>
    signer.issue(
      chain as unknown as PortalChain,
      store as unknown as PortalStore,
      request
    );
  return {
    request,
    chain,
    quote,
    store,
    stored,
    admission,
    issue,
    readContract
  };
}

describe("private spell intake receipts", () => {
  it("signs a stored spell for the exact quote, deployment and owner with at most five minutes validity", async () => {
    const f = fixture();
    const receipt = await f.issue();
    expect(receipt.expiresAt).toBe(1300n);
    const typed = portalIntakeSigningData({
      ...f.request,
      competition: pool,
      competitionQuote: zeroHash,
      expiresAt: receipt.expiresAt
    });
    expect(
      await recoverTypedDataAddress({ ...typed, signature: receipt.signature })
    ).toBe(account.address);
    for (const changed of [
      { ...typed, domain: { ...typed.domain, chainId: 84532 } },
      { ...typed, domain: { ...typed.domain, verifyingContract: zeroAddress } },
      { ...typed, message: { ...typed.message, competition: zeroAddress } },
      {
        ...typed,
        message: {
          ...typed.message,
          competitionQuote: keccak256(toHex("other theme"))
        }
      }
    ])
      expect(
        await recoverTypedDataAddress({
          ...changed,
          signature: receipt.signature
        })
      ).not.toBe(account.address);
  });
  it("never acknowledges missing or corrupted private input", async () => {
    const f = fixture();
    f.store.spell.mockResolvedValueOnce(null as never);
    await expect(f.issue()).rejects.toThrow("storage");
    for (const field of [
      "spell",
      "salt",
      "nonce",
      "artVersion",
      "tokenId",
      "submitter"
    ] as const) {
      f.store.spell.mockResolvedValueOnce({
        ...f.stored,
        [field]: field === "salt" ? keccak256(toHex("changed")) : "changed"
      } as never);
      await expect(f.issue()).rejects.toThrow();
    }
    expect(f.chain.quote).not.toHaveBeenCalled();
    expect(f.readContract).not.toHaveBeenCalled();
  });
  it("rejects a changed quote and caps validity by the signed upload and live window", async () => {
    const f = fixture();
    f.quote.portal.payment.version++;
    await expect(f.issue()).rejects.toThrow("changed");
    f.quote.portal.payment.version--;
    f.quote.round.endsAt = 1100n;
    expect((await f.issue()).expiresAt).toBe(1100n);
    f.request.expiresAt = 1050n;
    expect((await f.issue()).expiresAt).toBe(1050n);
    f.request.expiresAt = 1000n;
    await expect(f.issue()).rejects.toThrow("expired");
  });
  it("requires the intake role and refuses privileged signing wallets", async () => {
    const f = fixture();
    f.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "intakeVersion" ? 1n : false
    );
    await expect(f.issue()).rejects.toThrow("dedicated");
    f.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "intakeVersion" ? 1n : true
    );
    await expect(f.issue()).rejects.toThrow("dedicated");
  });
});
