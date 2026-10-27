import {
  decodeEventLog,
  erc20Abi,
  type Address,
  type TransactionReceipt
} from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import {
  ARENA_ENTRY_FEE,
  type ArenaTransactionAction,
  type ArenaTransactionStatus
} from "@protopals/yunipals-market-core/arena";

const same = (a: unknown, b: unknown) =>
  String(a).toLowerCase() === String(b).toLowerCase();

/** Event semantics work for direct calls and smart-wallet bundles alike. Native
 * tracking additionally requires every selected log's full receipt identity. */
export function arenaClientReceiptEvidence(
  row: { action: ArenaTransactionAction; wallet: Address },
  receipt: TransactionReceipt,
  contract: Address,
  paymentToken: Address,
  strict = false
): ArenaTransactionStatus["result"] {
  for (const log of receipt.logs) {
    if (
      log.removed ||
      (strict &&
        (log.blockNumber !== receipt.blockNumber ||
          !same(log.blockHash, receipt.blockHash) ||
          !same(log.transactionHash, receipt.transactionHash) ||
          log.transactionIndex !== receipt.transactionIndex)) ||
      log.logIndex === null ||
      !Number.isInteger(log.logIndex) ||
      log.logIndex < 0
    )
      continue;
    try {
      if (row.action.kind === "approval") {
        if (!same(log.address, paymentToken)) continue;
        const decoded = decodeEventLog({
          abi: erc20Abi,
          data: log.data,
          topics: log.topics,
          strict: true
        });
        if (
          decoded.eventName === "Approval" &&
          same(decoded.args.owner, row.wallet) &&
          same(decoded.args.spender, contract) &&
          decoded.args.value >= ARENA_ENTRY_FEE
        )
          return {
            event: "Approval",
            amount: decoded.args.value.toString(),
            blockNumber: receipt.blockNumber.toString(),
            logIndex: log.logIndex!
          };
      } else {
        if (!same(log.address, contract)) continue;
        const decoded = decodeEventLog({
          abi: arenaAbi,
          data: log.data,
          topics: log.topics,
          strict: true
        });
        if (
          row.action.kind === "entry" &&
          decoded.eventName === "Entered" &&
          same(decoded.args.player, row.wallet) &&
          decoded.args.id.toString() === row.action.tournamentId &&
          Number(decoded.args.nftChainId) === row.action.nftChainId &&
          same(decoded.args.collection, row.action.collection) &&
          decoded.args.tokenId.toString() === row.action.tokenId
        )
          return {
            event: "Entered",
            seat: decoded.args.seat,
            blockNumber: receipt.blockNumber.toString(),
            logIndex: log.logIndex!
          };
        if (
          row.action.kind === "claim" &&
          decoded.eventName === "Claimed" &&
          same(decoded.args.player, row.wallet) &&
          same(decoded.args.recipient, row.wallet)
        )
          return {
            event: "Claimed",
            amount: decoded.args.amount.toString(),
            blockNumber: receipt.blockNumber.toString(),
            logIndex: log.logIndex!
          };
      }
    } catch {
      /* Other contracts/events never satisfy a tracked action. */
    }
  }
  return null;
}
