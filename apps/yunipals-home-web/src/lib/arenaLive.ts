import type { Address, Hex } from "viem";
import type { ArenaPublicTournament } from "@protopals/yunipals-market-core/arena";
import { environment } from "@/environment";

export type ArenaConfig = {
  chainId: 8453;
  contract: Address;
  paymentToken: Address;
  entryFee: string;
  mediaKind?: "video" | "anime";
  eligibilityRegistry?: Address | null;
  strategyMaxLength: number;
  entriesEnabled: boolean;
  entryMode?: "closed" | "pilot" | "public";
  confirmationPolicy: string;
};
export type ArenaAdmission = {
  entry: {
    player: Address;
    nftChainId: number;
    collection: Address;
    tokenId: string;
  };
  expiry: string;
  signature: Hex;
};
export class ArenaRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ArenaRequestError";
  }
}

export async function arenaRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  return arenaRequestAt<T>(environment.arenaApiUrl, path, body, signal);
}
export async function arenaRequestAt<T>(
  apiUrl: string | null,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  if (!apiUrl) throw new Error("Arena is being prepared for launch.");
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    signal,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json().catch(() => {
    throw new Error(
      response.status === 429
        ? "Too many Arena requests. Please wait a moment and check again."
        : "Arena response unavailable. Please try again."
    );
  });
  if (!response.ok)
    throw new ArenaRequestError(
      value && typeof value.error === "string"
        ? value.error
        : "Arena is temporarily unavailable.",
      response.status
    );
  return value as T;
}
export function fetchArenaTournament(id: string, signal?: AbortSignal) {
  return arenaRequest<ArenaPublicTournament>(
    `/tournaments/${id}`,
    undefined,
    signal
  );
}
