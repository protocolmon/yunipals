import type { Address, Hex } from "viem";
import type {
  ArenaTransactionAction,
  ArenaTransactionStatus
} from "@protopals/yunipals-market-core/arena";

export type ArenaEntryTarget = {
  tournamentId: string;
  nftChainId: number;
  collection: Address;
  tokenId: string;
};

export function arenaFighterKey(fighter: ArenaEntryTarget) {
  return `${fighter.tournamentId}/${fighter.nftChainId}/${fighter.collection.toLowerCase()}/${fighter.tokenId}`;
}

export type PendingArenaTransaction = ArenaTransactionStatus & {
  wallet: Address;
  contract: Address;
  fighter?: ArenaEntryTarget;
  mediaKind?: "video" | "anime";
  // Receipt + live allowance checked on Base; this is not an indexer result.
  approvalConfirmed?: boolean;
};

export function arenaTransactionScope(
  wallet: Address,
  contract: Address,
  kind?: "video" | "anime"
) {
  return `${contract.toLowerCase()}/${wallet.toLowerCase()}${kind ? `/${kind}` : ""}`;
}

const storageKey = (
  wallet: Address,
  contract: Address,
  kind?: "video" | "anime"
) =>
  `yunipals/arena/transaction/v1/8453/${arenaTransactionScope(wallet, contract, kind)}`;

export function readArenaTransaction(
  wallet: Address,
  contract: Address,
  kind?: "video" | "anime"
): PendingArenaTransaction | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey(wallet, contract, kind)) ?? "null"
    ) as PendingArenaTransaction | null;
    if (
      !value ||
      value.wallet.toLowerCase() !== wallet.toLowerCase() ||
      value.contract.toLowerCase() !== contract.toLowerCase() ||
      value.mediaKind !== kind ||
      !/^0x[0-9a-f]{64}$/i.test(value.hash) ||
      !["entry", "approval", "claim"].includes(value.action.kind) ||
      ![
        "submitted",
        "confirming",
        "indexing",
        "indexed",
        "failed",
        "delayed"
      ].includes(value.state)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function saveArenaTransaction(value: PendingArenaTransaction) {
  try {
    localStorage.setItem(
      storageKey(value.wallet, value.contract, value.mediaKind),
      JSON.stringify(value)
    );
  } catch {
    /* An unavailable browser store does not invalidate a real transaction. */
  }
}

export function newArenaTransaction(
  wallet: Address,
  contract: Address,
  hash: Hex,
  action: ArenaTransactionAction,
  mediaKind?: "video" | "anime"
): PendingArenaTransaction {
  return {
    wallet,
    contract,
    ...(mediaKind ? { mediaKind } : {}),
    hash,
    action,
    state: "submitted",
    indexedThroughBlock: null,
    result: null
  };
}

export function transactionFighter(value: PendingArenaTransaction | null) {
  if (value?.action.kind === "entry") return value.action;
  const fighter = value?.fighter;
  if (
    value?.action.kind !== "approval" ||
    !fighter ||
    fighter.tournamentId !== value.action.tournamentId ||
    !Number.isSafeInteger(fighter.nftChainId) ||
    !/^0x[0-9a-f]{40}$/i.test(fighter.collection) ||
    !/^[0-9]+$/.test(fighter.tokenId)
  )
    return null;
  return fighter;
}

export function transactionPending(value: PendingArenaTransaction | null) {
  return (
    !!value &&
    !(value.action.kind === "approval" && value.approvalConfirmed) &&
    !["indexed", "failed"].includes(value.state)
  );
}

export function transactionLabel(value: PendingArenaTransaction) {
  if (value.action.kind === "approval" && value.approvalConfirmed)
    return "USDC approval confirmed. Complete your fighter’s entry next.";
  const action =
    value.action.kind === "approval"
      ? "USDC approval"
      : value.action.kind === "entry"
        ? "Entry"
        : value.action.asset === "randomness-refund"
          ? "ETH refund"
          : "USDC claim";
  if (value.state === "failed")
    return "The transaction did not complete this action.";
  if (value.state === "delayed")
    return "Your transaction is retained. Its data update is taking longer than expected.";
  if (value.state === "confirming")
    return `${action} included on Base. Checking confirmations and indexed result…`;
  if (value.state === "indexing")
    return `${action} confirmed. Updating indexed data…`;
  if (value.state === "indexed")
    return value.action.kind === "entry"
      ? "Entry confirmed and added to the tournament."
      : value.action.kind === "approval"
        ? "USDC approval is ready. Complete your fighter’s entry next."
        : value.action.asset === "randomness-refund"
          ? "Unused draw-fee ETH claimed."
          : "USDC claimed. Your balance and withdrawal history are updated.";
  return `${action} submitted. Checking its result…`;
}
