import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import {
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  getAddress,
  maxUint256,
  parseAbi,
  parseEventLogs,
  zeroHash,
  type Address,
  type Hex,
  type TransactionReceipt
} from "viem";

import {
  bnbOfferCurrency,
  marketplaceAssetKey,
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "@/lib/marketplace/registry";
import {
  assertOrderActiveAt,
  validateOwnSeaportOrder,
  type OwnOrderPolicy
} from "@/lib/marketplace/orderPolicy";
import { decodeSeaportOrder } from "@/lib/marketplace/seaportWire";
import {
  seaportBasicOfferParameters,
  seaportFulfillmentOrder,
  seaportOrderHash,
  seaportWriteAbi,
  type SeaportOrderComponents
} from "@/lib/marketplace/seaport";
import type {
  BnbFulfillmentQuote,
  MarketAssetId,
  MarketOrder
} from "@/lib/marketplace/marketApi";

export { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";

export const wrappedNativeAbi = parseAbi([
  "function deposit() payable",
  "event Deposit(address indexed dst, uint256 wad)"
]);

export type TransactionCall = {
  chainId: number;
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
};
export type MarketTransactionIntent = TransactionCall &
  (
    | {
        kind: "buy" | "accept-offer";
        orderHash: Hex;
        order: SeaportOrderComponents;
        asset: MarketAssetId;
        quoteExpiresAt: bigint;
      }
    | { kind: "cancel"; orderHash: Hex; maker: Address }
    | {
        kind: "validate";
        orderHash: Hex;
        order: SeaportOrderComponents;
        asset: MarketAssetId;
      }
    | { kind: "approve-nft"; asset: MarketAssetId; spender?: Address }
    | {
        kind: "approve-currency" | "wrap";
        amount: bigint;
        token?: Address;
        spender?: Address;
      }
  );

export type MarketReceiptExpectation = Pick<
  TransactionCall,
  "chainId" | "account"
> &
  (
    | {
        kind: "buy" | "accept-offer";
        orderHash: Hex;
        order: Pick<SeaportOrderComponents, "offerer">;
        asset: MarketAssetId;
      }
    | { kind: "cancel"; orderHash: Hex; maker: Address }
    | {
        kind: "validate";
        orderHash: Hex;
        order: Pick<SeaportOrderComponents, "offerer">;
        asset: MarketAssetId;
      }
    | { kind: "approve-nft"; asset: MarketAssetId; spender?: Address }
    | {
        kind: "approve-currency" | "wrap";
        amount: bigint;
        token?: Address;
        spender?: Address;
      }
  );

function sameAddress(a: Address, b: Address) {
  return getAddress(a) === getAddress(b);
}
function positive(amount: bigint) {
  if (typeof amount !== "bigint" || amount <= 0n || amount > maxUint256)
    throw new Error("The amount must be a positive uint256 integer.");
  return amount;
}

/** Bind a fresh quote to the exact listing/offer and lifecycle the user reviewed. */
export function buildBnbFulfillment(
  quote: BnbFulfillmentQuote,
  reviewed: MarketOrder,
  actor: Address,
  policy: OwnOrderPolicy,
  nowSeconds: bigint
): MarketTransactionIntent {
  if (
    reviewed.asset.chain !== "bnb" ||
    reviewed.source !== "yunipals" ||
    quote.asset.chain !== "bnb" ||
    reviewed.asset.chainId !== 56 ||
    quote.asset.chainId !== 56 ||
    !sameAddress(
      reviewed.asset.contractAddress,
      marketplaceChains.bnb.contractAddress
    ) ||
    !sameAddress(policy.collection, marketplaceChains.bnb.contractAddress) ||
    !sameAddress(policy.offerCurrency, bnbOfferCurrency.address) ||
    !sameAddress(reviewed.protocolAddress, seaportDeployment.address)
  )
    throw new Error("Unsupported BNB settlement configuration.");
  if (
    marketplaceAssetKey(quote.asset) !== marketplaceAssetKey(reviewed.asset) ||
    quote.lifecycle !== reviewed.lifecycle ||
    quote.orderHash.toLowerCase() !== reviewed.orderHash.toLowerCase() ||
    !sameAddress(quote.actor, actor)
  )
    throw new Error("The quote no longer matches the reviewed action.");
  const expiresAt = BigInt(quote.expiresAt);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + 120n)
    throw new Error(
      "This quote expired or has an invalid lifetime. Refresh it before continuing."
    );
  const order = decodeSeaportOrder(quote.order);
  const summary = validateOwnSeaportOrder(order, policy);
  assertOrderActiveAt(order, nowSeconds);
  if (
    seaportOrderHash(order).toLowerCase() !==
      reviewed.orderHash.toLowerCase() ||
    !sameAddress(summary.maker, reviewed.maker) ||
    summary.side !== reviewed.side ||
    summary.tokenId.toString() !== reviewed.asset.tokenId ||
    !sameAddress(summary.currency, reviewed.currency.address) ||
    reviewed.currency.decimals !== 18 ||
    reviewed.currency.symbol !==
      (summary.side === "listing" ? "BNB" : "WBNB") ||
    summary.grossAmount.toString() !== reviewed.grossAmount ||
    summary.sellerProceeds.toString() !== reviewed.sellerProceeds ||
    order.startTime.toString() !== reviewed.startTime ||
    order.endTime.toString() !== reviewed.endTime ||
    summary.fees.length !== reviewed.fees.length ||
    summary.fees.some(
      (fee, index) =>
        !sameAddress(fee.recipient, reviewed.fees[index].recipient) ||
        fee.amount.toString() !== reviewed.fees[index].amount
    )
  ) {
    throw new Error(
      "The order's NFT, price, recipients, fees or expiry changed. Review it again."
    );
  }
  if (sameAddress(actor, order.offerer))
    throw new Error("You cannot fill your own order through this action.");
  const kind = summary.side === "listing" ? "buy" : "accept-offer";
  const data =
    kind === "buy"
      ? encodeFunctionData({
          abi: seaportWriteAbi,
          functionName: "fulfillOrder",
          args: [seaportFulfillmentOrder(order, quote.signature), zeroHash]
        })
      : encodeFunctionData({
          abi: seaportWriteAbi,
          functionName: "fulfillBasicOrder",
          args: [seaportBasicOfferParameters(order, quote.signature)]
        });
  return {
    kind,
    chainId: 56,
    account: getAddress(actor),
    to: seaportDeployment.address,
    data,
    value: kind === "buy" ? summary.grossAmount : 0n,
    orderHash: reviewed.orderHash,
    order,
    asset: reviewed.asset,
    quoteExpiresAt: expiresAt
  };
}

/** Cancellation intentionally does not apply current fee/lifecycle/time policy. */
export function buildSeaportCancellation(
  chain: MarketplaceChain,
  order: SeaportOrderComponents,
  expectedHash: Hex,
  actor: Address
): MarketTransactionIntent {
  if (
    !sameAddress(order.offerer, actor) ||
    seaportOrderHash(order).toLowerCase() !== expectedHash.toLowerCase()
  )
    throw new Error("Cancellation must match your reviewed order.");
  return {
    kind: "cancel",
    chainId: marketplaceChains[chain].chainId,
    account: getAddress(actor),
    to: seaportDeployment.address,
    value: 0n,
    orderHash: expectedHash,
    maker: order.offerer,
    data: encodeFunctionData({
      abi: seaportWriteAbi,
      functionName: "cancel",
      args: [[order]]
    })
  };
}

/** The maker publishes order terms as an on-chain Seaport validation event. */
export function buildBnbValidation(
  order: SeaportOrderComponents,
  asset: MarketAssetId,
  expectedHash: Hex,
  actor: Address
): MarketTransactionIntent {
  if (
    asset.chain !== "bnb" ||
    asset.chainId !== 56 ||
    !sameAddress(asset.contractAddress, marketplaceChains.bnb.contractAddress) ||
    !sameAddress(order.offerer, actor) ||
    seaportOrderHash(order).toLowerCase() !== expectedHash.toLowerCase()
  )
    throw new Error("The BNB validation no longer matches the reviewed order.");
  return {
    kind: "validate",
    chainId: 56,
    account: getAddress(actor),
    to: seaportDeployment.address,
    value: 0n,
    data: encodeFunctionData({
      abi: seaportWriteAbi,
      functionName: "validate",
      args: [[seaportFulfillmentOrder(order, "0x")]]
    }),
    orderHash: expectedHash,
    order,
    asset
  };
}

export function buildBnbNftApproval(
  asset: MarketAssetId,
  actor: Address
): MarketTransactionIntent {
  if (
    asset.chain !== "bnb" ||
    asset.chainId !== 56 ||
    !sameAddress(asset.contractAddress, marketplaceChains.bnb.contractAddress)
  )
    throw new Error("Unsupported NFT approval.");
  marketplaceAssetKey(asset);
  return {
    kind: "approve-nft",
    chainId: 56,
    account: getAddress(actor),
    to: asset.contractAddress,
    value: 0n,
    asset,
    data: encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [seaportDeployment.address, BigInt(asset.tokenId)]
    })
  };
}

export function buildBnbCurrencyAction(
  kind: "approve-currency" | "wrap",
  actor: Address,
  amount: bigint
): MarketTransactionIntent {
  positive(amount);
  return {
    kind,
    chainId: 56,
    account: getAddress(actor),
    to: bnbOfferCurrency.address,
    amount,
    value: kind === "wrap" ? amount : 0n,
    data:
      kind === "wrap"
        ? encodeFunctionData({ abi: wrappedNativeAbi, functionName: "deposit" })
        : encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [seaportDeployment.address, amount]
          })
  };
}

export function transactionCall(intent: TransactionCall): TransactionCall {
  // Only these fields are sent to the wallet; never spread an API response.
  return {
    chainId: intent.chainId,
    account: intent.account,
    to: intent.to,
    data: intent.data,
    value: intent.value
  };
}

/** Works with outer smart-wallet receipts too; require events from the real contracts. */
export function assertMarketReceipt(
  intent: MarketReceiptExpectation,
  receipt: Pick<TransactionReceipt, "status" | "logs">
) {
  if (receipt.status !== "success")
    throw new Error("The transaction reverted. The action was not completed.");
  let matched = false;
  if (intent.kind === "buy" || intent.kind === "accept-offer") {
    matched = parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderFulfilled",
      logs: receipt.logs,
      strict: true
    }).some(
      (log) =>
        sameAddress(log.address, seaportDeployment.address) &&
        log.args.orderHash.toLowerCase() === intent.orderHash.toLowerCase() &&
        sameAddress(log.args.offerer, intent.order.offerer) &&
        sameAddress(log.args.recipient, intent.account)
    );
    const from = intent.kind === "buy" ? intent.order.offerer : intent.account;
    const to = intent.kind === "buy" ? intent.account : intent.order.offerer;
    matched &&= parseEventLogs({
      abi: erc721Abi,
      eventName: "Transfer",
      logs: receipt.logs,
      strict: true
    }).some(
      (log) =>
        sameAddress(log.address, intent.asset.contractAddress) &&
        log.args.tokenId.toString() === intent.asset.tokenId &&
        sameAddress(log.args.from, from) &&
        sameAddress(log.args.to, to)
    );
  } else if (intent.kind === "validate") {
    matched = parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderValidated",
      logs: receipt.logs,
      strict: true
    }).some(
      (log) =>
        sameAddress(log.address, seaportDeployment.address) &&
        log.args.orderHash.toLowerCase() === intent.orderHash.toLowerCase() &&
        sameAddress(log.args.orderParameters.offerer, intent.account)
    );
  } else if (intent.kind === "cancel") {
    matched = parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderCancelled",
      logs: receipt.logs,
      strict: true
    }).some(
      (log) =>
        sameAddress(log.address, seaportDeployment.address) &&
        log.args.orderHash.toLowerCase() === intent.orderHash.toLowerCase() &&
        sameAddress(log.args.offerer, intent.account)
    );
  } else if (intent.kind === "approve-nft") {
    matched = parseEventLogs({
      abi: erc721Abi,
      eventName: "Approval",
      logs: receipt.logs,
      strict: true
    }).some(
      (log) =>
        sameAddress(log.address, intent.asset.contractAddress) &&
        log.args.tokenId.toString() === intent.asset.tokenId &&
        sameAddress(log.args.owner, intent.account) &&
        sameAddress(
          log.args.spender,
          intent.spender ?? seaportDeployment.address
        )
    );
  } else if (intent.kind === "approve-currency") {
    matched = parseEventLogs({
      abi: erc20Abi,
      eventName: "Approval",
      logs: receipt.logs,
      strict: true
    }).some(
      (log) =>
        sameAddress(log.address, intent.token ?? bnbOfferCurrency.address) &&
        sameAddress(log.args.owner, intent.account) &&
        sameAddress(
          log.args.spender,
          intent.spender ?? seaportDeployment.address
        ) &&
        log.args.value === intent.amount
    );
  } else if (intent.kind === "wrap") {
    matched = parseEventLogs({
      abi: wrappedNativeAbi,
      eventName: "Deposit",
      logs: receipt.logs,
      strict: true
    }).some(
      (log) =>
        sameAddress(log.address, intent.token ?? bnbOfferCurrency.address) &&
        sameAddress(log.args.dst, intent.account) &&
        log.args.wad === intent.amount
    );
  }
  if (!matched)
    throw new Error(
      "The receipt does not confirm the reviewed marketplace action. Check the transaction before trying again."
    );
}
