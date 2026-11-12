import {
  keccak256,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type LocalAccount
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { portalGradingAbi } from "@protopals/yunipals-market-core/portalAbi";
import {
  portalAdmissionHash,
  portalIntakeLifetimeSeconds,
  portalIntakeRole,
  portalIntakeSigningData,
  portalSpellCommitment
} from "@protopals/yunipals-market-core/portals";
import type { PortalChain } from "./chain.js";
import type { PortalStore } from "./store.js";
import { PortalUserError } from "./errors.js";

export class PortalIntakeSigner {
  constructor(readonly account: LocalAccount) {}

  async assertAuthority(chain: PortalChain) {
    const version = await chain.client.readContract({
      address: chain.deployment.grading,
      abi: portalGradingAbi,
      functionName: "intakeVersion"
    });
    if (version !== 1n) throw new Error("Unsupported portal intake version.");
    const roles = await Promise.all(
      [
        portalIntakeRole,
        zeroHash,
        ...["UPGRADER_ROLE", "CONFIG_ROLE", "PAUSER_ROLE", "GRADER_ROLE"].map(
          (s) => keccak256(toHex(s))
        )
      ].map((role) =>
        chain.client.readContract({
          address: chain.deployment.grading,
          abi: portalGradingAbi,
          functionName: "hasRole",
          args: [role, this.account.address]
        })
      )
    );
    if (!roles[0] || roles.slice(1).some(Boolean))
      throw new Error(
        "Use a dedicated wallet with only the portal intake role."
      );
  }

  async issue(
    chain: PortalChain,
    store: PortalStore,
    input: {
      submitter: Address;
      tokenId: bigint;
      artVersion: bigint;
      nonce: bigint;
      commitment: Hex;
      expiresAt: bigint;
      admissionHash: Hex;
    }
  ) {
    // Re-read the committed row. Never acknowledge an in-memory or failed upload.
    const spell = await store.spell(input.commitment);
    if (
      !spell ||
      spell.submitter.toLowerCase() !== input.submitter.toLowerCase() ||
      spell.tokenId !== input.tokenId.toString() ||
      spell.artVersion !== input.artVersion.toString() ||
      spell.nonce !== input.nonce.toString() ||
      portalSpellCommitment({
        chainId: chain.deployment.chainId,
        grading: chain.deployment.grading,
        submitter: input.submitter,
        tokenId: input.tokenId,
        artVersion: input.artVersion,
        nonce: input.nonce,
        spell: spell.spell,
        salt: spell.salt as Hex
      }) !== input.commitment
    )
      throw new PortalUserError(
        "The private spell could not be verified in storage. Please upload it again.",
        503
      );
    const quote = await chain.quote(input.tokenId, input.submitter);
    if (!quote.portal)
      throw new PortalUserError("The portal window has closed.");
    const admissionHash = portalAdmissionHash({
      tokenId: input.tokenId,
      portalId: quote.round.portalId,
      roundId: quote.round.id,
      paymentVersion: quote.portal.payment.version,
      artVersion: quote.artVersion,
      rubricId: quote.rubricId,
      maximumFee:
        quote.portal.payment.aiFee +
        quote.portal.payment.portalFee +
        (quote.competition?.fee ?? 0n),
      inputHash: quote.input.hash,
      spellCommitment: input.commitment,
      nonce: quote.nonce
    });
    if (
      admissionHash !== input.admissionHash ||
      quote.artVersion !== input.artVersion ||
      quote.nonce !== input.nonce
    )
      throw new PortalUserError(
        "The portal, price or card changed. Please review your spell again.",
        409
      );
    const expiresAt = [
      BigInt(quote.now + portalIntakeLifetimeSeconds),
      quote.round.endsAt,
      input.expiresAt
    ].reduce((a, b) => (a < b ? a : b));
    if (expiresAt <= BigInt(quote.now))
      throw new PortalUserError(
        "The spell signature expired. Please sign again."
      );
    await this.assertAuthority(chain);
    const signature = await this.account.signTypedData(
      portalIntakeSigningData({
        chainId: chain.deployment.chainId,
        grading: chain.deployment.grading,
        submitter: input.submitter,
        admissionHash,
        competition: quote.competition?.address ?? zeroAddress,
        competitionQuote: quote.competition?.admissionHash ?? zeroHash,
        expiresAt
      })
    );
    return { expiresAt, signature };
  }
}

export function configuredPortalIntake(env: NodeJS.ProcessEnv) {
  const key = env.PORTALS_INTAKE_PRIVATE_KEY;
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error("Invalid portal intake key configuration.");
  const account = privateKeyToAccount(key as Hex);
  if (
    !env.PORTALS_INTAKE_ADDRESS ||
    account.address.toLowerCase() !== env.PORTALS_INTAKE_ADDRESS.toLowerCase()
  )
    throw new Error(
      "Portal intake wallet does not match the configured public address."
    );
  return new PortalIntakeSigner(account);
}
