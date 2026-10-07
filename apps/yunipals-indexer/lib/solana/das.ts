export type DasAsset = {
  mint: string;
  owner: string | null;
  burnt: boolean;
  delegated: boolean;
  delegate: string | null;
  metadataUri: string | null;
  metadataSlot: number | null;
};

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const digit = new Map([...alphabet].map((character, index) => [character, BigInt(index)]));

/** Solana public keys are exactly 32 bytes. Do not change their case. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  let number = 0n;
  for (const character of value) {
    const next = digit.get(character);
    if (next === undefined) return false;
    number = number * 58n + next;
  }
  let bytes = 0;
  for (let n = number; n > 0n; n >>= 8n) bytes++;
  return value.match(/^1*/)?.[0].length! + bytes === 32;
}

export function parseDasAsset(value: unknown, requestedMint: string): DasAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("das_asset_invalid");
  const asset = value as Record<string, unknown>;
  if (asset.id !== requestedMint || !isSolanaAddress(asset.id)) throw new Error("das_asset_identity_mismatch");
  if (typeof asset.burnt !== "boolean") throw new Error("das_burn_state_missing");
  const ownership = asset.ownership;
  if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) throw new Error("das_ownership_missing");
  const owner = (ownership as Record<string, unknown>).owner;
  if (!asset.burnt && !isSolanaAddress(owner)) throw new Error("das_owner_invalid");
  if (asset.burnt && owner !== null && owner !== undefined && !isSolanaAddress(owner)) throw new Error("das_owner_invalid");
  const delegated = (ownership as Record<string, unknown>).delegated;
  const delegate = (ownership as Record<string, unknown>).delegate;
  if (delegated !== undefined && typeof delegated !== "boolean") throw new Error("das_delegate_invalid");
  if (delegate !== null && delegate !== undefined && !isSolanaAddress(delegate)) throw new Error("das_delegate_invalid");
  const content = asset.content && typeof asset.content === "object" ? asset.content as Record<string, unknown> : {};
  const uri = content.json_uri;
  if (uri !== null && uri !== undefined && typeof uri !== "string") throw new Error("das_metadata_uri_invalid");
  const slot = content.last_indexed_slot;
  if (slot !== null && slot !== undefined && (!Number.isSafeInteger(slot) || Number(slot) < 0)) throw new Error("das_metadata_slot_invalid");
  return { mint: requestedMint, owner: asset.burnt ? null : owner as string, burnt: asset.burnt,
    delegated: delegated === true, delegate: (delegate as string | null) ?? null,
    metadataUri: (uri as string | null) ?? null, metadataSlot: (slot as number | null) ?? null };
}

export class DasError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}

/** The caller reserves credits before every invocation. Error text never contains the URL. */
export async function getAssetBatch(key: string, ids: readonly string[], timeoutMs = 20_000): Promise<unknown[]> {
  if (!key || !ids.length || ids.length > 1000 || ids.some(id => !isSolanaAddress(id))) throw new DasError("das_invalid_request");
  let response: Response;
  try {
    response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "exomon-indexer", method: "getAssetBatch", params: { ids } }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch { throw new DasError("das_transport_error", true); }
  if (response.status === 429) throw new DasError("das_rate_limited", true);
  if (response.status === 401 || response.status === 403) throw new DasError("das_authentication_failed");
  if (!response.ok) throw new DasError(`das_http_${response.status}`, response.status >= 500);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new DasError("das_invalid_json", true); }
  if (!payload || typeof payload !== "object") throw new DasError("das_invalid_response");
  const envelope = payload as { result?: unknown; error?: { code?: number } };
  if (envelope.error) {
    const code = envelope.error.code;
    if (code === -32004) throw new DasError("das_asset_missing");
    if (code === -32029) throw new DasError("das_rate_limited", true);
    if (code === -32001 || code === -32003) throw new DasError("das_authentication_failed");
    throw new DasError(`das_rpc_${Number.isSafeInteger(code) ? code : "unknown"}`, code === -32000);
  }
  if (!Array.isArray(envelope.result)) throw new DasError("das_result_not_array");
  return envelope.result;
}

/** Match IDs explicitly; a re-ordered provider result is still safe. */
export function parseDasBatch(values: unknown[], ids: readonly string[]): (DasAsset | null)[] {
  const requested = new Set(ids), seen = new Map<string, unknown>();
  if (requested.size !== ids.length) throw new Error("das_duplicate_requested_id");
  for (const value of values) {
    if (value === null) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("das_invalid_batch_item");
    const id = (value as { id?: unknown }).id;
    if (typeof id !== "string" || !requested.has(id) || seen.has(id)) throw new Error("das_unexpected_or_duplicate_id");
    seen.set(id, value);
  }
  return ids.map(id => {
    if (!seen.has(id)) return null;
    const value = seen.get(id) as { burnt?: unknown; ownership?: { owner?: unknown } };
    // Helius can return an unburned asset with an empty owner. That is unknown
    // ownership, not an address and not evidence of a burn.
    if (value.burnt === false && value.ownership?.owner === "") return null;
    return parseDasAsset(value,id);
  });
}
