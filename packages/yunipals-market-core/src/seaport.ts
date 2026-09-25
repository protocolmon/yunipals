import {
  getAddress,
  hashStruct,
  hashTypedData,
  maxUint256,
  parseAbi,
  zeroAddress,
  zeroHash,
  type Address
} from "viem";

// OrderComponents includes the maker counter. Fulfillment's OrderParameters
// instead includes totalOriginalConsiderationItems; never sign that structure.
export const seaportOrderTypes = {
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "counter", type: "uint256" }
  ],
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" }
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" }
  ]
} as const;

const seaportStructs = [
  "struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }",
  "struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address recipient; }",
  "struct OrderComponents { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 counter; }",
  "struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }",
  "struct Order { OrderParameters parameters; bytes signature; }",
  "struct AdvancedOrder { OrderParameters parameters; uint120 numerator; uint120 denominator; bytes signature; bytes extraData; }",
  "struct CriteriaResolver { uint256 orderIndex; uint8 side; uint256 index; uint256 identifier; bytes32[] criteriaProof; }",
  "struct AdditionalRecipient { uint256 amount; address recipient; }",
  "struct BasicOrderParameters { address considerationToken; uint256 considerationIdentifier; uint256 considerationAmount; address offerer; address zone; address offerToken; uint256 offerIdentifier; uint256 offerAmount; uint8 basicOrderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 offererConduitKey; bytes32 fulfillerConduitKey; uint256 totalOriginalAdditionalRecipients; AdditionalRecipient[] additionalRecipients; bytes signature; }"
] as const;

export const seaportReadAbi = parseAbi([
  ...seaportStructs,
  "function name() view returns (string)",
  "function information() view returns (string version, bytes32 domainSeparator, address conduitController)",
  "function getCounter(address offerer) view returns (uint256 counter)",
  "function getOrderHash(OrderComponents order) view returns (bytes32 orderHash)",
  "function getOrderStatus(bytes32 orderHash) view returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize)"
]);

export const seaportWriteAbi = parseAbi([
  ...seaportStructs,
  "function validate(Order[] orders) returns (bool validated)",
  "function fulfillOrder(Order order, bytes32 fulfillerConduitKey) payable returns (bool fulfilled)",
  "function fulfillBasicOrder(BasicOrderParameters parameters) payable returns (bool fulfilled)",
  "function fulfillBasicOrder_efficient_6GL6yc(BasicOrderParameters parameters) payable returns (bool fulfilled)",
  "function fulfillAdvancedOrder(AdvancedOrder advancedOrder, CriteriaResolver[] criteriaResolvers, bytes32 fulfillerConduitKey, address recipient) payable returns (bool fulfilled)",
  "function cancel(OrderComponents[] orders) returns (bool cancelled)",
  "function incrementCounter() returns (uint256 newCounter)"
]);

export type SeaportOfferItem = {
  itemType: number;
  token: Address;
  identifierOrCriteria: bigint;
  startAmount: bigint;
  endAmount: bigint;
};

export type SeaportConsiderationItem = SeaportOfferItem & {
  recipient: Address;
};

export type SeaportOrderComponents = {
  offerer: Address;
  zone: Address;
  offer: readonly SeaportOfferItem[];
  consideration: readonly SeaportConsiderationItem[];
  orderType: number;
  startTime: bigint;
  endTime: bigint;
  zoneHash: `0x${string}`;
  salt: bigint;
  conduitKey: `0x${string}`;
  counter: bigint;
};

export type SeaportDomain = {
  name: "Seaport";
  version: string;
  chainId: number;
  verifyingContract: Address;
};

export type NativeListingInput = {
  seller: Address;
  collection: Address;
  tokenId: bigint;
  totalPrice: bigint;
  startTime: bigint;
  endTime: bigint;
  counter: bigint;
  salt: bigint;
  fees?: readonly { recipient: Address; amount: bigint }[];
};

export type ItemOfferInput = Omit<NativeListingInput, "seller"> & {
  buyer: Address;
  paymentToken: Address;
};

function uint256(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < 0n || value > maxUint256) {
    throw new Error(`${label} must be a uint256 integer.`);
  }
  return value;
}

function nonzeroAddress(value: Address, label: string) {
  const address = getAddress(value);
  if (address === zeroAddress) throw new Error(`${label} cannot be zero.`);
  return address;
}

/**
 * Creates the constrained native-payment order used by our own orderbook.
 * The caller must enforce the collection allowlist, fee policy, current
 * ownership/counter and lifecycle policy. OpenSea orders keep their own form.
 */
export function createNativeListing(input: NativeListingInput) {
  const seller = nonzeroAddress(input.seller, "Seller");
  const collection = nonzeroAddress(input.collection, "Collection");
  const price = uint256(input.totalPrice, "Price");
  const startTime = uint256(input.startTime, "Start time");
  const endTime = uint256(input.endTime, "End time");
  if (price === 0n) throw new Error("Listing price must be positive.");
  if (endTime <= startTime)
    throw new Error("Expiry must follow the start time.");

  const payment = (amount: bigint, recipient: Address) => ({
    itemType: 0,
    token: zeroAddress,
    identifierOrCriteria: 0n,
    startAmount: amount,
    endAmount: amount,
    recipient
  });
  const fees = (input.fees ?? []).map((fee) => {
    const amount = uint256(fee.amount, "Fee");
    if (amount === 0n) throw new Error("Fee must be positive.");
    return payment(amount, nonzeroAddress(fee.recipient, "Fee recipient"));
  });
  const feeTotal = fees.reduce((sum, fee) => sum + fee.startAmount, 0n);
  if (feeTotal >= price)
    throw new Error("Fees must leave positive seller proceeds.");

  return {
    offerer: seller,
    zone: zeroAddress,
    offer: [
      {
        itemType: 2,
        token: collection,
        identifierOrCriteria: uint256(input.tokenId, "Token ID"),
        startAmount: 1n,
        endAmount: 1n
      }
    ],
    consideration: [payment(price - feeTotal, seller), ...fees],
    orderType: 0,
    startTime,
    endTime,
    zoneHash: zeroHash,
    salt: uint256(input.salt, "Salt"),
    conduitKey: zeroHash,
    counter: uint256(input.counter, "Counter")
  } satisfies SeaportOrderComponents;
}

/** Fixed ERC-20 offer for one exact NFT; fees are included in totalPrice. */
export function createItemOffer(input: ItemOfferInput) {
  const buyer = nonzeroAddress(input.buyer, "Buyer");
  const collection = nonzeroAddress(input.collection, "Collection");
  const token = nonzeroAddress(input.paymentToken, "Payment token");
  const price = uint256(input.totalPrice, "Price");
  const startTime = uint256(input.startTime, "Start time");
  const endTime = uint256(input.endTime, "End time");
  if (price === 0n) throw new Error("Offer price must be positive.");
  if (endTime <= startTime)
    throw new Error("Expiry must follow the start time.");
  const fees = (input.fees ?? []).map((fee) => {
    const amount = uint256(fee.amount, "Fee");
    if (amount === 0n) throw new Error("Fee must be positive.");
    return {
      itemType: 1,
      token,
      identifierOrCriteria: 0n,
      startAmount: amount,
      endAmount: amount,
      recipient: nonzeroAddress(fee.recipient, "Fee recipient")
    };
  });
  if (fees.reduce((sum, fee) => sum + fee.startAmount, 0n) >= price) {
    throw new Error("Fees must leave positive seller proceeds.");
  }
  return {
    offerer: buyer,
    zone: zeroAddress,
    offer: [
      {
        itemType: 1,
        token,
        identifierOrCriteria: 0n,
        startAmount: price,
        endAmount: price
      }
    ],
    consideration: [
      {
        itemType: 2,
        token: collection,
        identifierOrCriteria: uint256(input.tokenId, "Token ID"),
        startAmount: 1n,
        endAmount: 1n,
        recipient: buyer
      },
      ...fees
    ],
    orderType: 0,
    startTime,
    endTime,
    zoneHash: zeroHash,
    salt: uint256(input.salt, "Salt"),
    conduitKey: zeroHash,
    counter: uint256(input.counter, "Counter")
  } satisfies SeaportOrderComponents;
}

/**
 * Only our fixed, direct-approval item-offer shape can use this conversion.
 * Basic route 4 / FULL_OPEN (16) draws fees from the buyer's offered ERC-20;
 * the accepting seller needs NFT approval, without an ERC-20 fee approval.
 * Admission still requires chain/collection/currency/fee policy and signature
 * checks; this must not be used to transform provider-specific OpenSea orders.
 */
export function seaportBasicOfferParameters(
  order: SeaportOrderComponents,
  signature: `0x${string}`
) {
  if (order.offer.length !== 1 || order.consideration.length < 1) {
    throw new Error(
      "Expected one payment offer and an exact NFT consideration."
    );
  }
  const payment = order.offer[0];
  const nft = order.consideration[0];
  if (!payment || !nft) throw new Error("Missing item-offer component.");
  const fees = order.consideration.slice(1);
  const expected = createItemOffer({
    buyer: order.offerer,
    collection: nft.token,
    tokenId: nft.identifierOrCriteria,
    paymentToken: payment.token,
    totalPrice: payment.startAmount,
    startTime: order.startTime,
    endTime: order.endTime,
    salt: order.salt,
    counter: order.counter,
    fees: fees.map((fee) => ({
      recipient: fee.recipient,
      amount: fee.startAmount
    }))
  });
  if (seaportOrderHash(order) !== seaportOrderHash(expected)) {
    throw new Error("Unsupported item-offer shape.");
  }
  return {
    considerationToken: nft.token,
    considerationIdentifier: nft.identifierOrCriteria,
    considerationAmount: 1n,
    offerer: order.offerer,
    zone: order.zone,
    offerToken: payment.token,
    offerIdentifier: 0n,
    offerAmount: payment.startAmount,
    basicOrderType: 16,
    startTime: order.startTime,
    endTime: order.endTime,
    zoneHash: order.zoneHash,
    salt: order.salt,
    offererConduitKey: zeroHash,
    fulfillerConduitKey: zeroHash,
    totalOriginalAdditionalRecipients: BigInt(fees.length),
    additionalRecipients: fees.map((fee) => ({
      amount: fee.startAmount,
      recipient: fee.recipient
    })),
    signature
  } as const;
}

export function seaportSigningData(
  domain: SeaportDomain,
  order: SeaportOrderComponents
) {
  if (!Number.isSafeInteger(domain.chainId) || domain.chainId <= 0) {
    throw new Error("Invalid signing chain ID.");
  }
  if (domain.name !== "Seaport" || !domain.version) {
    throw new Error("Invalid Seaport signing domain.");
  }
  nonzeroAddress(domain.verifyingContract, "Seaport contract");
  return {
    domain,
    types: seaportOrderTypes,
    primaryType: "OrderComponents",
    message: order
  } as const;
}

// Seaport's order hash is the struct hash, not the chain-bound signing digest.
// Database identity must also contain chain ID and protocol address.
export function seaportOrderHash(order: SeaportOrderComponents) {
  return hashStruct({
    data: order,
    primaryType: "OrderComponents",
    types: seaportOrderTypes
  });
}

export function seaportFulfillmentOrder(
  order: SeaportOrderComponents,
  signature: `0x${string}`
) {
  const { counter, ...parameters } = order;
  return {
    parameters: {
      ...parameters,
      totalOriginalConsiderationItems: BigInt(order.consideration.length)
    },
    signature
  };
}

export function assertSeaportSigningIntent(
  expected: ReturnType<typeof seaportSigningData>,
  received: ReturnType<typeof seaportSigningData>
) {
  if (hashTypedData(expected) !== hashTypedData(received)) {
    throw new Error(
      "The wallet signing request differs from the reviewed order."
    );
  }
}
