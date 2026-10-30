import {
  decodeEventLog,
  type Address,
  type GetCallsStatusReturnType
} from "viem";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import {
  arenaTransactionScope,
  type ArenaEntryTarget
} from "./arenaTransactions";

export type PendingArenaCalls = {
  id: string;
  wallet: Address;
  contract: Address;
  mediaKind?: "video" | "anime";
  fighter: ArenaEntryTarget;
};

const key = (wallet: Address, contract: Address, kind?: "video" | "anime") =>
  `yunipals/arena/calls/v1/8453/${arenaTransactionScope(wallet, contract, kind)}`;

export function readArenaCalls(
  wallet: Address,
  contract: Address,
  kind?: "video" | "anime"
): PendingArenaCalls | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(key(wallet, contract, kind)) ?? "null"
    ) as PendingArenaCalls | null;
    if (
      !value ||
      value.wallet.toLowerCase() !== wallet.toLowerCase() ||
      value.contract.toLowerCase() !== contract.toLowerCase() ||
      value.mediaKind !== kind ||
      typeof value.id !== "string" ||
      !value.id.length ||
      value.id.length > 4096 ||
      !/^[1-9][0-9]*$/.test(value.fighter.tournamentId) ||
      !Number.isSafeInteger(value.fighter.nftChainId) ||
      !/^0x[0-9a-f]{40}$/i.test(value.fighter.collection) ||
      !/^[0-9]+$/.test(value.fighter.tokenId)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function saveArenaCalls(value: PendingArenaCalls) {
  // Persist the caller-supplied ID BEFORE sending. An ambiguous wallet response
  // or page reload must recover the same batch, never submit a second payment.
  localStorage.setItem(
    key(value.wallet, value.contract, value.mediaKind),
    JSON.stringify(value)
  );
}

export function clearArenaCalls(value: PendingArenaCalls) {
  localStorage.removeItem(key(value.wallet, value.contract, value.mediaKind));
}

export function arenaCallsEntryHash(
  value: PendingArenaCalls,
  status: GetCallsStatusReturnType
) {
  if (status.chainId !== 8453 || !status.atomic || status.status !== "success")
    return null;
  for (const receipt of status.receipts ?? []) {
    if (receipt.status !== "success") continue;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== value.contract.toLowerCase()) continue;
      const [signature, ...topics] = log.topics;
      if (!signature) continue;
      try {
        // Both deployed arena versions use this Entered event. The server still
        // verifies the full canonical receipt before accepting the entry.
        const { args } = decodeEventLog({
          abi: arenaV2Abi,
          eventName: "Entered",
          data: log.data,
          topics: [signature, ...topics]
        });
        const fighter = value.fighter;
        if (
          args.id === BigInt(fighter.tournamentId) &&
          args.player.toLowerCase() === value.wallet.toLowerCase() &&
          args.nftChainId === BigInt(fighter.nftChainId) &&
          args.collection.toLowerCase() === fighter.collection.toLowerCase() &&
          args.tokenId === BigInt(fighter.tokenId)
        )
          return receipt.transactionHash;
      } catch {
        /* Ignore logs belonging to other calls in the bundle. */
      }
    }
  }
  return null;
}

export function arenaCallsRejected(error: unknown): boolean {
  const seen = new Set<unknown>();
  let cause = error;
  while (cause && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause);
    const current = cause as { code?: number; cause?: unknown };
    // These responses explicitly mean the wallet did not submit the batch.
    if ([4001, 5750, 5760, -32601, 4200].includes(current.code ?? 0))
      return true;
    cause = current.cause;
  }
  return false;
}
