import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { collectionSlugs, collections, type CollectionSlug } from "../constants.js";

export type ResolvedOwner = {
  input: string;
  normalizedName: string | null;
  addresses: Partial<Record<CollectionSlug, Address>>;
};

export class InvalidOwnerError extends Error {}
export class EnsUnavailableError extends Error {}
export class OwnerNameUnresolvedError extends Error {}

export type EnsClient = {
  getEnsAddress(parameters: { name: string; coinType?: bigint }): Promise<Address | null>;
  getEnsName(parameters: { address: Address; coinType?: bigint }): Promise<string | null>;
};

const successTtlMs = Number(process.env.ENS_FORWARD_CACHE_MS ?? 15 * 60_000);
const negativeTtlMs = Number(process.env.ENS_NEGATIVE_CACHE_MS ?? 2 * 60_000);
const forwardCache = new Map<string, { address: Address | null; expiresAt: number }>();
let defaultClient: EnsClient | undefined;

function clientOf(): EnsClient {
  if (defaultClient) return defaultClient;
  const rpc = process.env.PONDER_RPC_URL_1;
  if (!rpc) throw new EnsUnavailableError("PONDER_RPC_URL_1 is required for ENS resolution");
  defaultClient = createPublicClient({ chain: mainnet, transport: http(rpc, { timeout: Number(process.env.ENS_RPC_TIMEOUT_MS ?? 4_000) }) });
  return defaultClient;
}

export function normalizeOwnerName(input: string) {
  const candidate = input.trim();
  if (!candidate.includes(".") || candidate.length > 255) throw new InvalidOwnerError("Invalid owner address or ENS name");
  try { return normalize(candidate); }
  catch { throw new InvalidOwnerError("Invalid owner address or ENS name"); }
}

export async function resolveEnsAddress(name: string, chain: CollectionSlug, client: EnsClient = clientOf()) {
  const key = `${name}:${collections[chain].chainId}`;
  const cached = forwardCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.address;
  try {
    const address = await client.getEnsAddress({ name, coinType: BigInt(collections[chain].ensCoinType) });
    const normalized = address ? getAddress(address) : null;
    forwardCache.set(key, { address: normalized, expiresAt: Date.now() + (normalized ? successTtlMs : negativeTtlMs) });
    return normalized;
  } catch (error) {
    throw new EnsUnavailableError(error instanceof Error ? error.message : String(error));
  }
}

export async function resolveOwner(input: string, chains: readonly CollectionSlug[], client?: EnsClient): Promise<ResolvedOwner> {
  const candidate = input.trim();
  if (isAddress(candidate)) {
    const address = getAddress(candidate);
    return { input, normalizedName: null, addresses: Object.fromEntries(chains.map((chain) => [chain, address])) };
  }
  const name = normalizeOwnerName(candidate);
  const values = await Promise.all(chains.map(async (chain) => [chain, await resolveEnsAddress(name, chain, client)] as const));
  return { input, normalizedName: name, addresses: Object.fromEntries(values.filter((entry): entry is readonly [CollectionSlug, Address] => entry[1] !== null)) };
}

export async function verifiedPrimaryName(address: Address, chain: CollectionSlug, client: EnsClient = clientOf()) {
  const coinType = BigInt(collections[chain].ensCoinType);
  const name = await client.getEnsName({ address, coinType });
  if (!name) return null;
  let normalized: string;
  try { normalized = normalize(name); } catch { return null; }
  const forward = await client.getEnsAddress({ name: normalized, coinType });
  return forward && forward.toLowerCase() === address.toLowerCase() ? normalized : null;
}

export const allOwnerChains = collectionSlugs;
export function clearEnsForwardCache() { forwardCache.clear(); }
