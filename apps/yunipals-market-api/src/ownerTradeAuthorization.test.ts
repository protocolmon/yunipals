import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { getAddress, zeroAddress } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";

import {
  assertOwnerTradeAuthorized,
  ownerTradeActionAuthorized,
  ownerTradeAuthorizationStatements,
  readOwnerTradeAuthorization
} from "@/ownerTradeAuthorization";

const now = Date.parse("2026-09-08T12:00:00Z");
const owner = getAddress("0x0000000000000000000000000000000000001234");
const maker = owner;

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

const order: MarketOrder = {
  asset: {
    chain: "bnb",
    chainId: 56,
    contractAddress: getAddress(marketplaceChains.bnb.contractAddress),
    tokenId: "42"
  },
  lifecycle: 3,
  orderHash: `0x${"ab".repeat(32)}`,
  protocolAddress: seaportDeployment.address,
  source: "yunipals",
  side: "listing",
  maker,
  currency: { address: zeroAddress, symbol: "BNB", decimals: 18 },
  grossAmount: "1000",
  sellerProceeds: "950",
  fees: [
    {
      recipient: getAddress("0x0000000000000000000000000000000000005678"),
      amount: "50"
    }
  ],
  startTime: "1788868790",
  endTime: "1788872400",
  status: "unavailable"
};

function schedule(mode: "canary" | "public" = "canary") {
  return {
    formatVersion: 1,
    kind: "yunipals-marketplace-owner-trade-schedule",
    status: "authorized",
    mode,
    ownerWallet: owner,
    chains: ["bnb"],
    actions: ["createListing"],
    maximumFeesBasisPoints: 500,
    orders:
      mode === "canary"
        ? [
            {
              id: "bnb-listing-canary-1",
              chain: "bnb",
              action: "createListing",
              asset: { ...order.asset, lifecycle: order.lifecycle },
              orderHash: order.orderHash,
              actor: owner,
              maker,
              currency: order.currency.address,
              grossAmount: order.grossAmount,
              sellerProceeds: order.sellerProceeds,
              startTime: order.startTime,
              endTime: order.endTime,
              policyVersion: "bnb-owner-approved-v1"
            }
          ]
        : [],
    validFrom: "2026-09-08T11:59:00Z",
    validUntil: "2026-09-09T12:00:00Z",
    cancellationAndSettlementProcedure:
      "Cancel the order after the canary and reconcile its final chain state.",
    authorizedBy: owner,
    authorizedAt: "2026-09-08T11:58:00Z",
    authorizationStatement: ownerTradeAuthorizationStatements[mode]
  };
}

function encode(value: unknown) {
  const bytes = Buffer.from(canonical(value));
  return {
    encoded: bytes.toString("base64url"),
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  };
}

test("canonical canary authorization permits only its exact order", () => {
  const value = encode(schedule());
  const authorization = readOwnerTradeAuthorization(
    value.encoded,
    value.digest,
    now
  );
  assert.equal(
    ownerTradeActionAuthorized(authorization, "bnb", "createListing"),
    true
  );
  assert.equal(
    ownerTradeActionAuthorized(authorization, "ethereum", "createListing"),
    false
  );
  assert.equal(ownerTradeActionAuthorized(authorization, "bnb", "buy"), false);
  assertOwnerTradeAuthorized(
    authorization,
    {
      action: "createListing",
      order,
      actor: owner,
      policyVersion: "bnb-owner-approved-v1"
    },
    now
  );
  for (const candidate of [
    {
      order: {
        ...order,
        orderHash: `0x${"cd".repeat(32)}` as `0x${string}`
      }
    },
    { order: { ...order, grossAmount: "1001" } },
    { actor: getAddress("0x0000000000000000000000000000000000009999") },
    { policyVersion: "changed" }
  ])
    assert.throws(() =>
      assertOwnerTradeAuthorized(
        authorization,
        {
          action: "createListing",
          order,
          actor: owner,
          policyVersion: "bnb-owner-approved-v1",
          ...candidate
        },
        now
      )
    );
});

test("digest, canonical encoding, expiry and fee ceiling fail closed", () => {
  const value = encode(schedule());
  assert.throws(() =>
    readOwnerTradeAuthorization(value.encoded, `sha256:${"00".repeat(32)}`, now)
  );
  const noncanonical = Buffer.from(JSON.stringify(schedule())).toString(
    "base64url"
  );
  assert.throws(() =>
    readOwnerTradeAuthorization(
      noncanonical,
      `sha256:${createHash("sha256")
        .update(Buffer.from(JSON.stringify(schedule())))
        .digest("hex")}`,
      now
    )
  );
  assert.throws(() =>
    readOwnerTradeAuthorization(
      value.encoded,
      value.digest,
      Date.parse("2026-09-09T12:00:00Z")
    )
  );
  const excessiveFee = {
    ...schedule(),
    orders: [{ ...schedule().orders[0]!, sellerProceeds: "949" }]
  };
  const encodedFee = encode(excessiveFee);
  assert.throws(() =>
    readOwnerTradeAuthorization(encodedFee.encoded, encodedFee.digest, now)
  );
});

test("public authorization remains bounded by chain, action, fee and time", () => {
  const value = encode(schedule("public"));
  const authorization = readOwnerTradeAuthorization(
    value.encoded,
    value.digest,
    now
  );
  const changedHash = { ...order, orderHash: `0x${"cd".repeat(32)}` } as const;
  assertOwnerTradeAuthorized(
    authorization,
    {
      action: "createListing",
      order: changedHash,
      actor: owner,
      policyVersion: "current"
    },
    now
  );
  assert.throws(() =>
    assertOwnerTradeAuthorized(
      authorization,
      {
        action: "createOffer",
        order: changedHash,
        actor: owner,
        policyVersion: "current"
      },
      now
    )
  );
  assert.throws(() =>
    assertOwnerTradeAuthorized(
      authorization,
      {
        action: "createListing",
        order: { ...changedHash, sellerProceeds: "949" },
        actor: owner,
        policyVersion: "current"
      },
      now
    )
  );
});

test("public settlement can fill an existing order beyond the authorization window", () => {
  const publicSchedule = {
    ...schedule("public"),
    actions: ["buy", "acceptOffer"]
  };
  const value = encode(publicSchedule);
  const authorization = readOwnerTradeAuthorization(
    value.encoded,
    value.digest,
    now
  );
  const actor = getAddress("0x0000000000000000000000000000000000009999");
  const existingOrder = {
    ...order,
    endTime: "1806054197"
  };
  for (const action of ["buy", "acceptOffer"] as const) {
    const candidate = {
      action,
      order: {
        ...existingOrder,
        side: action === "buy" ? ("listing" as const) : ("offer" as const),
        ...(action === "acceptOffer"
          ? {
              currency: bnbOfferCurrency
            }
          : {})
      },
      actor,
      policyVersion: "current"
    };
    assertOwnerTradeAuthorized(authorization, candidate, now);
    assert.throws(() =>
      assertOwnerTradeAuthorized(
        authorization,
        candidate,
        Date.parse(publicSchedule.validFrom) - 1
      )
    );
    assert.throws(() =>
      assertOwnerTradeAuthorized(
        {
          ...authorization,
          schedule: { ...authorization.schedule, actions: ["createListing"] }
        },
        candidate,
        now
      )
    );
    assert.throws(() =>
      assertOwnerTradeAuthorized(
        {
          ...authorization,
          schedule: { ...authorization.schedule, chains: ["ethereum"] }
        },
        candidate,
        now
      )
    );
    assert.throws(() =>
      assertOwnerTradeAuthorized(
        authorization,
        candidate,
        Date.parse(publicSchedule.validUntil)
      )
    );
    assert.throws(() =>
      assertOwnerTradeAuthorized(
        authorization,
        {
          ...candidate,
          order: {
            ...candidate.order,
            sellerProceeds: "949",
            fees: [{ ...order.fees[0]!, amount: "51" }]
          }
        },
        now
      ),
      /Trade is outside the owner-authorized scope/
    );
  }
});

test("public publication cannot leave a new order executable beyond authorization", () => {
  const publicSchedule = {
    ...schedule("public"),
    actions: ["createListing", "createOffer"]
  };
  const value = encode(publicSchedule);
  const authorization = readOwnerTradeAuthorization(
    value.encoded,
    value.digest,
    now
  );
  for (const action of ["createListing", "createOffer"] as const) {
    assert.throws(() =>
      assertOwnerTradeAuthorized(
        authorization,
        {
          action,
          order: {
            ...order,
            side:
              action === "createListing"
                ? ("listing" as const)
                : ("offer" as const),
            endTime: "1806054197",
            ...(action === "createOffer"
              ? {
                  currency: bnbOfferCurrency
                }
              : {})
          },
          actor: owner,
          policyVersion: "current"
        },
        now
      )
    );
  }
});

test("canary settlement still requires its exact authorized order and expiry", () => {
  const canarySchedule = schedule();
  canarySchedule.actions = ["buy"];
  canarySchedule.orders[0]!.action = "buy";
  const value = encode(canarySchedule);
  const authorization = readOwnerTradeAuthorization(
    value.encoded,
    value.digest,
    now
  );
  const candidate = {
    action: "buy" as const,
    order,
    actor: owner,
    policyVersion: "bnb-owner-approved-v1"
  };
  assertOwnerTradeAuthorized(authorization, candidate, now);
  assert.throws(() =>
    assertOwnerTradeAuthorized(
      authorization,
      { ...candidate, order: { ...order, endTime: "1806054197" } },
      now
    )
  );
});
