import { z } from "zod";
import {
  decodeFunctionData,
  encodeAbiParameters,
  isAddress,
  keccak256,
  zeroAddress,
  type Address
} from "viem";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";
import type { PortalTransaction } from "./portalTransactions";

const address = z
  .string()
  .refine((value) => isAddress(value) && value.toLowerCase() !== zeroAddress);
const hash = z.string().regex(/^0x[\da-f]{64}$/i);
const uint = z.string().regex(/^[1-9][0-9]{0,62}$/);
export const portalAirdropSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(100),
    chainId: z.number().int().positive(),
    collection: address,
    admin: address,
    kindId: uint,
    kindConfigurationHash: hash,
    snapshotAt: z.string().datetime({ offset: true }),
    expectedAllocated: z.number().int().min(0).max(999),
    batches: z
      .array(
        z.object({ recipients: z.array(address).min(1).max(100) }).strict()
      )
      .min(1)
      .max(10)
  })
  .strict()
  .refine(
    (value) =>
      value.expectedAllocated +
        value.batches.reduce((n, b) => n + b.recipients.length, 0) <=
      1000,
    "An airdrop must fit within the portal kind's lifetime range."
  );
export type PortalAirdrop = z.infer<typeof portalAirdropSchema>;
export const airdropFirstSerial = (plan: PortalAirdrop, index: number) =>
  plan.expectedAllocated +
  1 +
  plan.batches.slice(0, index).reduce((n, b) => n + b.recipients.length, 0);
export function airdropBatchKey(plan: PortalAirdrop, index: number) {
  const identity = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "address[]" }],
      [
        BigInt(plan.kindId),
        BigInt(airdropFirstSerial(plan, index)),
        plan.batches[index].recipients as Address[]
      ]
    )
  );
  return `airdrop:${plan.collection.toLowerCase()}:${identity}`;
}
export function matchesAirdropRequest(
  plan: PortalAirdrop,
  index: number,
  request: {
    kindId: bigint;
    firstSerial: number;
    recipients: readonly string[];
  }
) {
  const expected = plan.batches[index].recipients;
  return (
    request.kindId === BigInt(plan.kindId) &&
    request.firstSerial === airdropFirstSerial(plan, index) &&
    request.recipients.length === expected.length &&
    request.recipients.every(
      (a, i) => a.toLowerCase() === expected[i].toLowerCase()
    )
  );
}
export function airdropAllocationIsExpected(
  plan: PortalAirdrop,
  allocated: number
) {
  return (
    allocated === plan.expectedAllocated ||
    plan.batches.some(
      (b, i) =>
        allocated === airdropFirstSerial(plan, i) + b.recipients.length - 1
    )
  );
}
export function airdropPendingTransaction(
  plan: PortalAirdrop,
  index: number,
  transactions: readonly PortalTransaction[]
) {
  return transactions.find((tx) => {
    if (
      tx.state === "failed" ||
      tx.state === "indexed" ||
      tx.to.toLowerCase() !== plan.collection.toLowerCase()
    )
      return false;
    if (tx.actionKey === airdropBatchKey(plan, index)) return true;
    try {
      const decoded = decodeFunctionData({
        abi: portalCollectionAbi,
        data: tx.data as `0x${string}`
      });
      if (decoded.functionName !== "mintBatch") return false;
      const [kind, recipients] = decoded.args;
      return matchesAirdropRequest(plan, index, {
        kindId: kind,
        firstSerial: airdropFirstSerial(plan, index),
        recipients
      });
    } catch {
      return false;
    }
  });
}
export async function parseAirdropFile(text: string, expectedHash?: string) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 100_000) throw new Error("The airdrop file is too large.");
  if (expectedHash) {
    if (!/^[\da-f]{64}$/i.test(expectedHash))
      throw new Error("The airdrop link has an invalid checksum.");
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (v) => v.toString(16).padStart(2, "0")
    ).join("");
    if (digest !== expectedHash.toLowerCase())
      throw new Error(
        "The airdrop file does not match this link. No transaction can be signed."
      );
  }
  return portalAirdropSchema.parse(JSON.parse(text));
}
export const airdropFenceSchema = z
  .object({
    version: z.literal(1),
    hash: hash.nullable(),
    createdAt: z.number().int(),
    nonce: z.number().int().nonnegative(),
    dataHash: hash
  })
  .strict();
export type AirdropFence = z.infer<typeof airdropFenceSchema>;
export function airdropFenceKey(plan: PortalAirdrop, index: number) {
  return `yunipals/portals/airdrop/v1/${plan.chainId}/${airdropBatchKey(plan, index)}`;
}
