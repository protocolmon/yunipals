import {
  assertOpenSeaPolicyCurrent,
  type OpenSeaOrderPolicy
} from "@protopals/yunipals-market-core/openseaOrderPolicy";

export const openSeaBrowsePolicyValidForSeconds = 300;
export type OpenSeaPolicyPurpose = "transaction" | "catalog";

// Catalog observations retain the browse resolver's original expiry. Executable
// transaction checks keep the stricter core guard unless explicitly opted out.
export function assertOpenSeaPolicyFresh(
  policy: OpenSeaOrderPolicy,
  now: bigint,
  purpose: OpenSeaPolicyPurpose = "transaction"
) {
  if (purpose !== "catalog") return assertOpenSeaPolicyCurrent(policy, now);
  if (
    policy.expiresAt <= now ||
    policy.expiresAt > now + BigInt(openSeaBrowsePolicyValidForSeconds)
  )
    throw new Error("The OpenSea browse policy expired. Refresh the catalog.");
}
