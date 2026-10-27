import {
  isAddress,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { environment } from "@/environment";
import type {
  BoosterMonster,
  BoosterOriginal,
  BoosterRequest,
  BoosterSnapshot,
  BoosterType
} from "@protopals/yunipals-market-core/boosters";

export type BoosterPage<T> = BoosterSnapshot & {
  items: T[];
  nextCursor?: string | null;
};
export type BoosterItem<T> = BoosterSnapshot & { item: T };
export const boosterQueryKey = [
  "boosters",
  environment.yunipalsIndexerUrl
] as const;

export function visibleBoosterTypes<T extends Pick<BoosterType, "manifestUri">>(
  packs: T[],
  _wallet?: string
): T[] {
  return packs.filter(
    (pack) => !pack.manifestUri.includes("/base-mainnet-smoke-v1/")
  );
}

export async function readBoosterTransactionReceipt<T>(
  loadReceipt: () => Promise<T>
): Promise<T | null> {
  try {
    return await loadReceipt();
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return null;
    throw error;
  }
}

export function boosterAddresses() {
  const values = [
    environment.boosterRegistry,
    environment.boosterEngine,
    environment.boosterMonsters
  ];
  if (
    !environment.boostersEnabled ||
    environment.fixtures ||
    values.some(
      (value) => !isAddress(value) || value.toLowerCase() === zeroAddress
    )
  )
    return null;
  return {
    registry: values[0].toLowerCase() as Address,
    engine: values[1].toLowerCase() as Address,
    monsters: values[2].toLowerCase() as Address
  };
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${environment.yunipalsIndexerUrl}/v1${path}`, {
    signal
  });
  if (!response.ok)
    throw new Error(
      response.status === 503
        ? "The booster index is catching up. Please try again shortly."
        : "Booster data could not be loaded. Please try again."
    );
  return response.json() as Promise<T>;
}

export const fetchBoosterTypes = (signal?: AbortSignal) =>
  read<BoosterPage<BoosterType>>("/boosters/types", signal);
export const fetchBoosterOriginal = (
  collection: string,
  id: string,
  signal?: AbortSignal
) =>
  read<BoosterItem<BoosterOriginal>>(
    `/boosters/originals/${collection}/${id}`,
    signal
  );
export const fetchBoosterMonster = (
  collection: string,
  id: string,
  signal?: AbortSignal
) =>
  read<BoosterItem<BoosterMonster>>(
    `/boosters/monsters/${collection}/${id}`,
    signal
  );
export const fetchBoosterRequest = (
  engine: string,
  id: string,
  signal?: AbortSignal
) =>
  read<BoosterItem<BoosterRequest>>(
    `/boosters/requests/${engine}/${id}`,
    signal
  );
export const fetchBoosterRequestMonsters = (
  engine: string,
  id: string,
  signal?: AbortSignal
) =>
  read<BoosterPage<BoosterMonster>>(
    `/boosters/requests/${engine}/${id}/monsters`,
    signal
  );
export const fetchBoosterOwner = <T extends BoosterMonster | BoosterOriginal>(
  owner: string,
  resource: "monsters" | "originals",
  after: string | null,
  signal?: AbortSignal
) =>
  read<BoosterPage<T>>(
    `/owners/${encodeURIComponent(owner)}/booster-${resource}?limit=24${
      after ? `&after=${after}` : ""
    }`,
    signal
  );

export function boosterAssetUrl(uri: string): string | null {
  try {
    const raw = uri.startsWith("ipfs://")
      ? `${environment.boosterIpfsGateway.replace(/\/?$/, "/")}${uri
          .slice(7)
          .replace(/^ipfs\//, "")}`
      : uri;
    const url = new URL(raw);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export type MonsterArtwork = {
  name: string | null;
  image: string | null;
  attributes: Record<string, string>;
  status: "ready" | "queued" | "blocked" | "missing";
  holo: { foreground: string; background: string; stars: string } | null;
};
export async function fetchMonsterArtwork(
  uri: string,
  signal?: AbortSignal
): Promise<MonsterArtwork> {
  const url = boosterAssetUrl(uri);
  if (!url) throw new Error("Artwork location is unavailable.");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Artwork could not be loaded.");
  const metadata: unknown = await response.json();
  if (typeof metadata !== "object" || metadata === null)
    throw new Error("Invalid monster metadata.");
  const name =
    "name" in metadata && typeof metadata.name === "string"
      ? metadata.name.slice(0, 200)
      : null;
  const image =
    "image" in metadata && typeof metadata.image === "string"
      ? boosterAssetUrl(metadata.image)
      : null;
  const attributes: Record<string, string> = {};
  if ("attributes" in metadata && Array.isArray(metadata.attributes)) {
    for (const attribute of metadata.attributes) {
      if (typeof attribute !== "object" || attribute === null) continue;
      const label: unknown = attribute.trait_type;
      const value: unknown = attribute.value;
      if (
        typeof label === "string" &&
        (typeof value === "string" || typeof value === "number")
      )
        attributes[label.toLowerCase().slice(0, 100)] = String(value).slice(
          0,
          200
        );
    }
  }
  const extension =
    "yunipals" in metadata &&
    typeof metadata.yunipals === "object" &&
    metadata.yunipals !== null
      ? (metadata.yunipals as Record<string, unknown>)
      : null;
  const rawHolo = extension?.holo;
  let holo: MonsterArtwork["holo"] = null;
  if (rawHolo && typeof rawHolo === "object") {
    const value = rawHolo as Record<string, unknown>;
    const foreground =
      typeof value.foreground === "string"
        ? boosterAssetUrl(value.foreground)
        : null;
    const background =
      typeof value.background === "string"
        ? boosterAssetUrl(value.background)
        : null;
    const stars =
      typeof value.stars === "string" ? boosterAssetUrl(value.stars) : null;
    if (foreground && background && stars)
      holo = { foreground, background, stars };
  }
  const status: MonsterArtwork["status"] =
    extension?.status === "blocked"
      ? "blocked"
      : extension?.status === "queued"
        ? "queued"
        : extension?.status === "missing"
          ? "missing"
          : image
            ? "ready"
            : "missing";
  return { name, image, attributes, status, holo };
}

export type StoredBoosterTransaction = {
  hash: Hex;
  kind: "open" | "claim" | "recover" | "burn" | "refund" | "approval";
  cancelled?: boolean;
  expectedRequestCount?: number;
  packTypeId?: string;
  quantity?: number;
  originalId?: string;
};
const storageKey = (wallet: string, engine: string) =>
  `yunipals/boosters/v1/8453/${engine.toLowerCase()}/${wallet.toLowerCase()}`;
export function readBoosterTransactions(
  wallet: string,
  engine: string,
  storage: Pick<Storage, "getItem"> = localStorage
): StoredBoosterTransaction[] {
  try {
    const rows: unknown = JSON.parse(
      storage.getItem(storageKey(wallet, engine)) ?? "[]"
    );
    if (!Array.isArray(rows)) return [];
    return rows
      .flatMap((value): StoredBoosterTransaction[] => {
        if (typeof value !== "object" || value === null) return [];
        const row = value as Record<string, unknown>;
        if (
          typeof row.hash !== "string" ||
          !/^0x[0-9a-f]{64}$/i.test(row.hash) ||
          typeof row.kind !== "string" ||
          !["open", "claim", "recover", "burn", "refund", "approval"].includes(
            row.kind
          ) ||
          (row.cancelled !== undefined && typeof row.cancelled !== "boolean")
        )
          return [];
        const saved: StoredBoosterTransaction = {
          hash: row.hash as Hex,
          kind: row.kind as StoredBoosterTransaction["kind"]
        };
        if (typeof row.cancelled === "boolean") saved.cancelled = row.cancelled;
        if (
          typeof row.expectedRequestCount === "number" &&
          Number.isInteger(row.expectedRequestCount) &&
          row.expectedRequestCount >= 1 &&
          row.expectedRequestCount <= 10
        )
          saved.expectedRequestCount = row.expectedRequestCount;
        if (
          typeof row.quantity === "number" &&
          Number.isInteger(row.quantity) &&
          row.quantity >= 1 &&
          row.quantity <= 32
        )
          saved.quantity = row.quantity;
        for (const field of ["packTypeId", "originalId"] as const)
          if (
            typeof row[field] === "string" &&
            /^(0|[1-9][0-9]{0,77})$/.test(row[field]) &&
            BigInt(row[field]) < 2n ** 256n
          )
            saved[field] = row[field];
        // Optional local hints are never the authority for minted identities.
        // Keep the transaction recoverable even if a hint is malformed.
        return [saved];
      })
      .slice(-30);
  } catch {
    return [];
  }
}
export function saveBoosterTransaction(
  wallet: string,
  engine: string,
  transaction: StoredBoosterTransaction,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  replaceHash?: Hex
) {
  const rows = readBoosterTransactions(wallet, engine, storage).filter(
    (row) => row.hash !== transaction.hash && row.hash !== replaceHash
  );
  try {
    storage.setItem(
      storageKey(wallet, engine),
      JSON.stringify([...rows, transaction].slice(-30))
    );
  } catch {
    /* Receipt recovery also remains available from the chain/indexer. */
  }
}
