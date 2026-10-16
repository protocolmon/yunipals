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
};
const storageKey = (wallet: Address, contract: Address) =>
  `yunipals/arena/transaction/v1/8453/${contract.toLowerCase()}/${wallet.toLowerCase()}`;

export function readArenaTransaction(
  wallet: Address,
  contract: Address
): PendingArenaTransaction | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey(wallet, contract)) ?? "null"
    ) as PendingArenaTransaction | null;
    if (
      !value ||
      value.wallet.toLowerCase() !== wallet.toLowerCase() ||
      value.contract.toLowerCase() !== contract.toLowerCase() ||
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
      storageKey(value.wallet, value.contract),
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
  action: ArenaTransactionAction
): PendingArenaTransaction {
  return {
    wallet,
    contract,
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
  return !!value && !["indexed", "failed"].includes(value.state);
}

export function transactionLabel(value: PendingArenaTransaction) {
  const action =
    value.action.kind === "approval"
      ? "USDC approval"
      : value.action.kind === "entry"
        ? "Entry"
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
        : "USDC claimed. Your balance and withdrawal history are updated.";
  return `${action} submitted. Checking its result…`;
}
