import type { Address, Hex } from "viem";
import {
  canonicalStrategy,
  strategyCommitment
} from "@protopals/yunipals-market-core/arena";

export type ArenaStrategyDraft = {
  text: string;
  signed?: {
    seat: number;
    text: string;
    salt: Hex;
    signature: Hex;
  };
};
export type ArenaStrategyReceipt = {
  seat: number;
  locked: boolean;
  commitment?: Hex;
  text?: string;
  receivedAt?: string;
};

function key(contract: Address, wallet: Address, id: string, seat: number) {
  return `yunipals/arena/private-strategy/v1/${contract.toLowerCase()}/${wallet.toLowerCase()}/${id}/${seat}`;
}

/** Tab-scoped only: private prompts and signed bodies never enter a URL or query cache. */
export function readArenaStrategy(
  contract: Address,
  wallet: Address,
  id: string,
  seat: number
): ArenaStrategyDraft {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key(contract, wallet, id, seat)) ?? "null"
    ) as ArenaStrategyDraft | null;
    if (!value || typeof value.text !== "string" || value.text.length > 2400)
      return { text: "" };
    if (value.signed) {
      if (
        value.signed.seat !== seat ||
        typeof value.signed.text !== "string" ||
        !/^0x[0-9a-f]{64}$/i.test(value.signed.salt) ||
        !/^0x[0-9a-f]{2,8192}$/i.test(value.signed.signature) ||
        canonicalStrategy(value.signed.text) !== value.signed.text
      )
        return { text: value.text };
      strategyCommitment(
        contract,
        BigInt(id),
        seat,
        value.signed.text,
        value.signed.salt
      );
    }
    return value;
  } catch {
    return { text: "" };
  }
}
export function saveArenaStrategy(
  contract: Address,
  wallet: Address,
  id: string,
  seat: number,
  value: ArenaStrategyDraft
) {
  // A signed strategy must be recoverable before the HTTP submission can begin.
  sessionStorage.setItem(
    key(contract, wallet, id, seat),
    JSON.stringify(value)
  );
}
export function clearArenaStrategy(
  contract: Address,
  wallet: Address,
  id: string,
  seat: number
) {
  sessionStorage.removeItem(key(contract, wallet, id, seat));
}
export function clearArenaStrategyWallet(contract: Address, wallet: Address) {
  const prefix = `yunipals/arena/private-strategy/v1/${contract.toLowerCase()}/${wallet.toLowerCase()}/`;
  try {
    for (const value of Object.keys(sessionStorage))
      if (value.startsWith(prefix)) sessionStorage.removeItem(value);
  } catch {
    /* No private draft was available. */
  }
}
