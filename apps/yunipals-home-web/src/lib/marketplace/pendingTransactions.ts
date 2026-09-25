import { getAddress, maxUint256, type Address, type Hash } from "viem";

import { parseMarketAssetId } from "@/lib/marketplace/marketApi";
import { marketplaceChains } from "@/lib/marketplace/registry";
import {
  isOpenSeaChain,
  openSeaCurrency
} from "@/lib/marketplace/openseaRegistry";
import { isOpenSeaApprovalSpender } from "@/lib/marketplace/openseaActions";
import type {
  MarketReceiptExpectation,
  MarketTransactionIntent
} from "@/lib/marketplace/transactionIntent";

export type PendingMarketTransaction = {
  hash: Hash;
  submittedAt: number;
  expectation: MarketReceiptExpectation;
};
const key = "yunipals-market-transactions-v1";
export const pendingMarketEvent = "yunipals-market-transactions-changed";

function address(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error("Invalid saved wallet.");
  return getAddress(value);
}
function hash(value: unknown): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Invalid saved transaction hash.");
  return value as Hash;
}
function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved transaction.");
  return value as Record<string, unknown>;
}

// Recovery stores only receipt expectations, never signatures or replayable calls.
export function pendingTransaction(
  hash: Hash,
  intent: MarketTransactionIntent
): PendingMarketTransaction {
  const common = { chainId: intent.chainId, account: intent.account };
  let expectation: MarketReceiptExpectation;
  if (intent.kind === "buy" || intent.kind === "accept-offer" || intent.kind === "validate") {
    expectation = {
      ...common,
      kind: intent.kind,
      orderHash: intent.orderHash,
      order: { offerer: intent.order.offerer },
      asset: intent.asset
    };
  } else if (intent.kind === "approve-nft") {
    expectation = {
      ...common,
      kind: intent.kind,
      asset: intent.asset,
      ...(intent.spender ? { spender: intent.spender } : {})
    };
  } else if (intent.kind === "cancel") {
    expectation = {
      ...common,
      kind: intent.kind,
      maker: intent.maker,
      orderHash: intent.orderHash
    };
  } else if (intent.kind === "wrap" || intent.kind === "approve-currency") {
    expectation = {
      ...common,
      kind: intent.kind,
      amount: intent.amount,
      ...(intent.token ? { token: intent.token } : {}),
      ...(intent.spender ? { spender: intent.spender } : {})
    };
  } else {
    throw new Error("Unsupported transaction recovery.");
  }
  return { hash, submittedAt: Date.now(), expectation };
}

export function decodePendingTransactions(
  json: string
): PendingMarketTransaction[] {
  if (json.length > 100_000) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value) || value.length > 20) return [];
    return value.flatMap((entry): PendingMarketTransaction[] => {
      try {
        const data = object(entry);
        const raw = object(data.expectation);
        const chainId = raw.chainId;
        if (
          typeof chainId !== "number" ||
          !Object.values(marketplaceChains).some(
            (chain) => chain.chainId === chainId
          )
        )
          return [];
        if (
          typeof data.submittedAt !== "number" ||
          !Number.isSafeInteger(data.submittedAt) ||
          data.submittedAt <= 0
        )
          return [];
        const common = { chainId, account: address(raw.account) };
        let expectation: MarketReceiptExpectation;
        if (
          raw.kind === "buy" ||
          raw.kind === "accept-offer" ||
          raw.kind === "validate" ||
          raw.kind === "approve-nft"
        ) {
          const asset = parseMarketAssetId(raw.asset);
          if (asset.chainId !== chainId) return [];
          if (raw.kind === "validate" && asset.chain !== "bnb") return [];
          const spender =
            raw.spender === undefined ? undefined : address(raw.spender);
          if (
            raw.kind === "approve-nft" &&
            spender &&
            (asset.chain === "bnb" || !isOpenSeaApprovalSpender(spender))
          )
            return [];
          if (raw.kind === "approve-nft" && asset.chain !== "bnb" && !spender)
            return [];
          expectation =
            raw.kind === "approve-nft"
              ? {
                  ...common,
                  kind: raw.kind,
                  asset,
                  ...(spender ? { spender } : {})
                }
              : {
                  ...common,
                  kind: raw.kind,
                  asset,
                  orderHash: hash(raw.orderHash),
                  order: { offerer: address(object(raw.order).offerer) }
                };
        } else if (raw.kind === "cancel") {
          expectation = {
            ...common,
            kind: raw.kind,
            maker: address(raw.maker),
            orderHash: hash(raw.orderHash)
          };
        } else if (raw.kind === "wrap" || raw.kind === "approve-currency") {
          if (
            typeof raw.amount !== "string" ||
            raw.amount.length > 78 ||
            !/^[1-9][0-9]*$/.test(raw.amount) ||
            BigInt(raw.amount) > maxUint256
          )
            return [];
          let currency: { token: Address; spender?: Address } | undefined;
          if (chainId !== 56) {
            const chain = Object.keys(marketplaceChains).find(
              (chain) =>
                marketplaceChains[chain as keyof typeof marketplaceChains]
                  .chainId === chainId
            ) as keyof typeof marketplaceChains;
            if (!isOpenSeaChain(chain)) return [];
            const token = openSeaCurrency(chain, address(raw.token));
            if (
              token.symbol !== "WETH" ||
              (raw.kind === "wrap" && !token.canWrapNative)
            )
              return [];
            const spender =
              raw.kind === "approve-currency"
                ? address(raw.spender)
                : undefined;
            if (spender && !isOpenSeaApprovalSpender(spender)) return [];
            currency = {
              token: token.address,
              ...(spender ? { spender } : {})
            };
          } else if (raw.token !== undefined || raw.spender !== undefined)
            return [];
          expectation = {
            ...common,
            kind: raw.kind,
            amount: BigInt(raw.amount),
            ...currency
          };
        } else return [];
        return [
          { hash: hash(data.hash), submittedAt: data.submittedAt, expectation }
        ];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function readPendingTransactions(): PendingMarketTransaction[] {
  try {
    return decodePendingTransactions(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
export function savePendingTransaction(
  record: PendingMarketTransaction,
  previousHash?: Hash
) {
  const records = readPendingTransactions().filter(
    (item) => item.hash !== previousHash && item.hash !== record.hash
  );
  try {
    localStorage.setItem(
      key,
      JSON.stringify([...records, record].slice(-20), (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
    window.dispatchEvent(new Event(pendingMarketEvent));
  } catch {
    // Receipt tracking still runs in memory when browser storage is unavailable.
  }
}
export function dismissPendingTransaction(hash: Hash) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        readPendingTransactions().filter((record) => record.hash !== hash),
        (_, value) => (typeof value === "bigint" ? value.toString() : value)
      )
    );
    window.dispatchEvent(new Event(pendingMarketEvent));
  } catch {
    /* The transaction remains observable through its explorer link. */
  }
}
