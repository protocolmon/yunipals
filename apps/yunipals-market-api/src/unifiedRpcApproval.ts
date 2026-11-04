import {
  validateUnifiedRpcProfile,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";

export type UnifiedRpcApprovalLifecycle = "temporary" | "service";
export type UnifiedRpcReplayApproval = {
  permitId: string;
  chainId: number;
  fromBlock: string;
  throughBlock: string;
  maximumCu: number;
  expiresAt: string;
};
export type UnifiedRpcApproval = {
  profile: UnifiedRpcProfile;
  lifecycle: UnifiedRpcApprovalLifecycle;
  expiresAt: string | null;
  permits: UnifiedRpcReplayApproval[];
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid RPC approval input.");
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join() !== keys.sort().join())
    throw new Error("Invalid RPC approval fields.");
}

function expiry(value: unknown, now: number, maximum: number): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value ||
    Date.parse(value) <= now ||
    Date.parse(value) > now + maximum
  )
    throw new Error("Invalid RPC approval expiry.");
  return value;
}

/** Service approval changes the profile lifetime only. Paid requests still
 * require an independently bounded, expiring replay permit and compute budget. */
export function validateUnifiedRpcApproval(
  value: unknown,
  now = Date.now()
): UnifiedRpcApproval {
  const input = object(value);
  exact(input, [
    "profile",
    "expiresAt",
    "permits",
    ...(input.lifecycle !== undefined ? ["lifecycle"] : [])
  ]);
  const profile = validateUnifiedRpcProfile(input.profile);
  const lifecycle = input.lifecycle ?? "temporary";
  if (lifecycle !== "temporary" && lifecycle !== "service")
    throw new Error("Invalid RPC approval lifecycle.");
  let expiresAt: string | null;
  if (lifecycle === "service") {
    // Require a fresh reviewed profile identity; an expired candidate cannot be
    // silently promoted or renewed under its previous identity.
    if (input.expiresAt !== null || !profile.reviewId)
      throw new Error(
        "Service approval requires a review identity and null expiry."
      );
    expiresAt = null;
  } else expiresAt = expiry(input.expiresAt, now, 30 * 86400000);

  if (!Array.isArray(input.permits) || input.permits.length > 4)
    throw new Error("Invalid replay permit count.");
  const chains = new Set<number>();
  const permits = input.permits.map((value): UnifiedRpcReplayApproval => {
    const permit = object(value);
    exact(permit, [
      "permitId",
      "chainId",
      "fromBlock",
      "throughBlock",
      "maximumCu",
      "expiresAt"
    ]);
    if (
      typeof permit.permitId !== "string" ||
      !/^0x[0-9a-f]{64}$/.test(permit.permitId) ||
      typeof permit.chainId !== "number" ||
      chains.has(permit.chainId) ||
      typeof permit.fromBlock !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(permit.fromBlock) ||
      typeof permit.throughBlock !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(permit.throughBlock) ||
      BigInt(permit.throughBlock) < BigInt(permit.fromBlock) ||
      BigInt(permit.throughBlock) > 9223372036854775807n ||
      typeof permit.maximumCu !== "number" ||
      !Number.isSafeInteger(permit.maximumCu) ||
      permit.maximumCu < 1 ||
      permit.maximumCu > 1000000000 ||
      !profile.manifest.sources.some(
        (source) => source.enabled && source.chainId === permit.chainId
      )
    )
      throw new Error("Invalid bounded RPC permit.");
    const permitExpiry = expiry(permit.expiresAt, now, 86400000);
    if (expiresAt && Date.parse(permitExpiry) > Date.parse(expiresAt))
      throw new Error("Permit outlives profile.");
    chains.add(permit.chainId);
    return {
      permitId: permit.permitId,
      chainId: permit.chainId,
      fromBlock: permit.fromBlock,
      throughBlock: permit.throughBlock,
      maximumCu: permit.maximumCu,
      expiresAt: permitExpiry
    };
  });
  return { profile, lifecycle, expiresAt, permits };
}
