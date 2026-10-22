import type { Address, Hex } from "viem";
import type { ArenaPublicTournament } from "@protopals/yunipals-market-core/arena";
import { environment } from "@/environment";

export type ArenaConfig = {
  chainId: 8453;
  contract: Address;
  paymentToken: Address;
  entryFee: string;
  strategyMaxLength: number;
  entriesEnabled: boolean;
  confirmationPolicy: string;
};
export type ArenaAdmission = {
  incarnation?: Hex;
  entry: {
    player: Address;
    nftChainId: number;
    collection: Address;
    tokenId: string;
  };
  expiry: string;
  signature: Hex;
};
export async function arenaRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  if (!environment.arenaApiUrl)
    throw new Error("Arena is being prepared for launch.");
  const response = await fetch(`${environment.arenaApiUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    signal,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "Arena is temporarily unavailable."
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
