import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  createItemOffer,
  createNativeListing,
  seaportSigningData
} from "@protopals/yunipals-market-core/seaport";
import { encodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";

import { inspectBnbAdmission } from "@/bnb/chain";
import {
  BnbOrderError,
  checkBnbOrder,
  parseBnbOrderRequest,
  type BnbPolicy
} from "@/bnb/orders";

export const seller = privateKeyToAccount(`0x${"01".repeat(32)}`);
export const buyer = privateKeyToAccount(`0x${"02".repeat(32)}`);
export const now = Date.now();
export const timestamp = BigInt(Math.floor(now / 1000));
export const cursorHash = `0x${"aa".repeat(32)}` as Hex;
export const headHash = `0x${"bb".repeat(32)}` as Hex;
export const { code } = JSON.parse(
  readFileSync(new URL("./seaport-bnb-bytecode.json", import.meta.url), "utf8")
) as { code: Hex };
export const policy: BnbPolicy = {
  version: "fixture-only-zero-fees",
  rules: {
    collection: marketplaceChains.bnb.contractAddress,
    offerCurrency: bnbOfferCurrency.address,
    fees: [],
    maxDurationSeconds: 86400n
  }
};

export async function fixture(
  side: "listing" | "offer" = "listing",
  tokenId = 42n,
  salt = 77n
) {
  const fields = {
    collection: marketplaceChains.bnb.contractAddress,
    tokenId,
    totalPrice: 10n ** 18n,
    startTime: timestamp - 1n,
    endTime: timestamp + 3600n,
    counter: 0n,
    salt,
    fees: []
  };
  const order =
    side === "listing"
      ? createNativeListing({ ...fields, seller: seller.address })
      : createItemOffer({
          ...fields,
          buyer: buyer.address,
          paymentToken: bnbOfferCurrency.address
        });
  const account = side === "listing" ? seller : buyer;
  const domain = {
    name: "Seaport",
    version: "1.6",
    chainId: 56,
    verifyingContract: seaportDeployment.address
  } as const;
  const request = {
    asset: {
      chain: "bnb",
      chainId: 56,
      contractAddress: marketplaceChains.bnb.contractAddress,
      tokenId: tokenId.toString()
    },
    lifecycle: 0,
    order: encodeSeaportOrder(order),
    preparationId: "11111111-1111-4111-8111-111111111111",
    signature: await account.signTypedData(seaportSigningData(domain, order))
  };
  const input = parseBnbOrderRequest(request, true);
  const summary = checkBnbOrder(input, policy);
  const indexed = {
    owner: seller.address,
    lifecycle: 0,
    hidden: false,
    burned: false,
    lastTransfer: {
      blockNumber: 100n,
      transactionHash: cursorHash
    },
    checkpoint: {
      number: 100n,
      hash: cursorHash,
      updatedAt: new Date(now - 30000)
    }
  };
  const state = {
    chainId: 56,
    owner: seller.address as Address,
    counter: 0n,
    cancelled: false,
    validated: false,
    filled: 0n,
    approved: seaportDeployment.address as Address,
    balance: 10n ** 18n,
    allowance: 10n ** 18n,
    transfers: false,
    blockHash: headHash,
    blockTimestamp: timestamp,
    canonicalMismatch: false,
    code,
    rpcFailure: false,
    contractHash: input.hash,
    nativeBalance: 10n ** 18n,
    simulationFails: false,
    simulationReorg: false,
    canonicalChecks: 0,
    simulations: [] as {
      functionName: string;
      account: Address;
      value?: bigint;
      blockNumber: bigint;
    }[]
  };
  const client = {
    async getChainId() {
      return state.chainId;
    },
    async getBalance(args: { blockNumber: bigint }) {
      assert.equal(args.blockNumber, 121n);
      return state.nativeBalance;
    },
    async simulateContract(args: {
      functionName: string;
      account: Address;
      value?: bigint;
      blockNumber: bigint;
    }) {
      assert.equal(args.blockNumber, 121n);
      state.simulations.push(args);
      if (state.simulationFails)
        throw new Error("fixture simulation RPC failure");
      if (state.simulationReorg) state.blockHash = cursorHash;
      return { result: true };
    },
    async getBlock(args: { blockNumber?: bigint }) {
      if (state.rpcFailure) throw new Error("fixture RPC failure");
      if (args.blockNumber === 121n) state.canonicalChecks++;
      return args.blockNumber === 100n
        ? { number: 100n, hash: cursorHash, timestamp: timestamp - 30n }
        : {
            number: 121n,
            hash:
              args.blockNumber === 121n && state.canonicalMismatch
                ? cursorHash
                : state.blockHash,
            timestamp: state.blockTimestamp
          };
    },
    async getCode(args: { address: Address; blockNumber: bigint }) {
      assert.equal(args.blockNumber, 121n);
      return args.address === seaportDeployment.address ? state.code : "0x";
    },
    async readContract(args: { functionName: string; blockNumber: bigint }) {
      assert.equal(
        args.blockNumber,
        121n,
        "Related state reads must use the observed block."
      );
      switch (args.functionName) {
        case "ownerOf":
          return state.owner;
        case "getCounter":
          return state.counter;
        case "getOrderStatus":
          return [state.validated, state.cancelled, state.filled, state.filled];
        case "getOrderHash":
          return state.contractHash;
        case "isApprovedForAll":
          return false;
        case "getApproved":
          return state.approved;
        case "balanceOf":
          return state.balance;
        case "allowance":
          return state.allowance;
        default:
          throw new Error(`Unexpected contract read ${args.functionName}`);
      }
    },
    async getLogs(args: {
      fromBlock: bigint;
      toBlock: bigint;
      args: { tokenId: bigint };
    }) {
      assert.equal(args.fromBlock, 101n);
      assert.equal(args.toBlock, 121n);
      assert.equal(args.args.tokenId, tokenId);
      return state.transfers ? [{}] : [];
    }
  } as unknown as PublicClient;
  return {
    input,
    summary,
    indexed,
    state,
    request,
    order,
    client,
    inspect: () =>
      inspectBnbAdmission(client, input, summary, indexed, {
        confirmations: 20n,
        indexerMaxAgeMs: 720000,
        now: () => now
      })
  };
}
