import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeEventTopics,
  getAddress,
  keccak256,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createOpenSeaPublicationIntent } from "@protopals/yunipals-market-core/openseaPublication";
import {
  openseaConduit,
  openseaCurrencies,
  openseaSignedZone,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportSigningData } from "@protopals/yunipals-market-core/seaport";
import { encodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import type { OpenSeaOrderPolicy } from "@protopals/yunipals-market-core/openseaOrderPolicy";

import { inspectOpenSeaAdmission } from "@/opensea/chain";
import type { IndexedOpenSeaAsset } from "@/opensea/indexer";
import { parseOpenSeaOrderRequest } from "@/opensea/orders";

export const seller = privateKeyToAccount(`0x${"11".repeat(32)}`);
export const buyer = privateKeyToAccount(`0x${"22".repeat(32)}`);
export const fixtureNow = Date.now();
export const fixtureTimestamp = BigInt(Math.floor(fixtureNow / 1000));
const hash = (byte: string) => `0x${byte.repeat(32)}` as Hex;
export const headHash = hash("ab");
export const mintHash = hash("ac");
export const transferHash = hash("ad");
const blockHash = (number: bigint) =>
  `0x${number.toString(16).padStart(64, "0")}` as Hex;
const transfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

export async function admissionFixture(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing",
  tokenId = BigInt(Date.now()) * 1000000n,
  salt = 7n,
  listingCurrency: Address = zeroAddress
) {
  const config = marketplaceChains[chain];
  const policy: OpenSeaOrderPolicy = {
    chain,
    collection: config.contractAddress,
    version: "local-admission-fixture-only",
    listingCurrencies: [zeroAddress, openseaCurrencies[chain].address],
    offerCurrency: openseaCurrencies[chain].address,
    listingZone: zeroAddress,
    offerZone: openseaSignedZone,
    maxDurationSeconds: 86400n,
    expiresAt: fixtureTimestamp + 60n,
    fees: [
      {
        recipient: "0x3333333333333333333333333333333333333333",
        basisPoints: 250
      }
    ]
  };
  const maker = side === "listing" ? seller : buyer;
  const intent = createOpenSeaPublicationIntent(
    {
      asset: {
        chain,
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        tokenId: String(tokenId)
      },
      lifecycle: 1,
      maker: maker.address,
      side,
      grossAmount: 10n ** 18n,
      endTime: fixtureTimestamp + 3600n,
      currency:
        side === "listing" ? listingCurrency : openseaCurrencies[chain].address
    },
    policy,
    { timestamp: fixtureTimestamp - 1n, counter: 0n },
    salt
  );
  const draft = {
    asset: intent.asset,
    lifecycle: 1,
    order: encodeSeaportOrder(intent.order),
    policyVersion: policy.version
  };
  const signature = await maker.signTypedData(
    seaportSigningData(
      {
        name: "Seaport",
        version: "1.6",
        chainId: config.chainId,
        verifyingContract: seaportDeployment.address
      },
      intent.order
    )
  );
  const request = {
    ...draft,
    preparationId: "11111111-1111-4111-8111-111111111111",
    signature
  };
  const input = parseOpenSeaOrderRequest(request, true);
  const indexed: IndexedOpenSeaAsset = {
    owner: seller.address,
    lifecycle: 1,
    hidden: false,
    burned: false,
    checkpoint: {
      number: 100n,
      timestamp: fixtureTimestamp - 30n,
      heartbeatAt: fixtureNow
    },
    mint: {
      blockNumber: 50n,
      transactionHash: mintHash,
      recipient: buyer.address
    },
    lastTransfer: {
      blockNumber: 80n,
      transactionHash: transferHash,
      transactionIndex: 2,
      logIndex: 3,
      from: buyer.address,
      to: seller.address
    }
  };
  const code = (
    JSON.parse(
      readFileSync(
        new URL(`./seaport-${chain}-bytecode.json`, import.meta.url),
        "utf8"
      )
    ) as { code: Hex }
  ).code;
  const state = {
    chainId: config.chainId as number,
    code,
    codeHash: keccak256(code),
    owner: seller.address as Address,
    counter: 0n,
    validated: false,
    cancelled: false,
    filled: 0n,
    approved: true,
    balance: 10n ** 18n,
    allowance: 10n ** 18n,
    channel: true,
    conduit: openseaConduit.address as Address,
    zoneCode: "0x6000" as Hex,
    headHash,
    headTimestamp: fixtureTimestamp,
    checkpointTimestamp: fixtureTimestamp - 30n,
    receiptCanonical: true,
    receiptStatus: "success",
    mintRecipient: buyer.address as Address,
    transferRecipient: seller.address as Address,
    receiptLogIndex: 3,
    rpcFailure: false,
    erc1271: false,
    signatureValid: true,
    recentTransfers: [] as {
      blockNumber: bigint | null;
      logIndex: number | null;
      removed: boolean;
    }[],
    cancelledHistory: new Set<string>(),
    afterReceipt: undefined as (() => Promise<void>) | undefined
  };
  const client = {
    async getChainId() {
      return state.chainId;
    },
    async getBlock(args: { blockNumber?: bigint }) {
      if (state.rpcFailure) throw new Error("isolated RPC unavailable");
      const number = args.blockNumber ?? 121n;
      return {
        number,
        hash: number === 121n ? state.headHash : blockHash(number),
        timestamp:
          number === 121n
            ? state.headTimestamp
            : number === 100n
              ? state.checkpointTimestamp
              : fixtureTimestamp - 100n
      };
    },
    async getCode(args: { address: Address; blockNumber: bigint }) {
      assert.equal(args.blockNumber, 121n);
      if (getAddress(args.address) === getAddress(seaportDeployment.address))
        return state.code;
      if (getAddress(args.address) === getAddress(openseaSignedZone))
        return state.zoneCode;
      return state.erc1271 ? "0x6000" : "0x";
    },
    async readContract(args: {
      functionName: string;
      blockNumber: bigint;
      args?: readonly unknown[];
    }) {
      assert.equal(args.blockNumber, 121n);
      switch (args.functionName) {
        case "getOrderHash":
          return input.hash;
        case "getCounter":
          return state.counter;
        case "getOrderStatus":
          return [
            state.validated,
            state.cancelled ||
              state.cancelledHistory.has(String(args.args?.[0])),
            state.filled,
            state.filled
          ];
        case "ownerOf":
          return state.owner;
        case "information":
          return ["1.6", hash("00"), openseaConduit.controller];
        case "getConduit":
          return [state.conduit, true];
        case "getChannelStatus":
          return state.channel;
        case "isApprovedForAll":
          return state.approved;
        case "getApproved":
          return zeroAddress;
        case "balanceOf":
          return state.balance;
        case "allowance":
          return state.allowance;
        case "isValidSignature":
          return state.signatureValid ? "0x1626ba7e" : "0xffffffff";
        default:
          throw new Error(`Unexpected read ${args.functionName}`);
      }
    },
    async simulateContract(args: {
      address: string;
      account: string;
      blockNumber: bigint;
      functionName: string;
      args: { signature: Hex; parameters: { offerer: string } }[][];
    }) {
      assert.equal(args.address, seaportDeployment.address);
      assert.equal(args.functionName, "validate");
      assert.equal(args.blockNumber, 121n);
      assert.notEqual(
        args.account.toLowerCase(),
        args.args[0]![0]!.parameters.offerer.toLowerCase()
      );
      // Model Seaport's contract-wallet signature decision for the ERC-1271
      // fixture. Ordinary signed EOA orders normally use local recovery first.
      return { result: state.erc1271 && state.signatureValid };
    },
    async getLogs(args: { fromBlock: bigint; toBlock: bigint }) {
      assert.equal(args.fromBlock, 100n);
      assert.equal(args.toBlock, 121n);
      return state.recentTransfers;
    },
    async getTransactionReceipt(args: { hash: Hex }) {
      const mint = args.hash === mintHash;
      const number = mint ? 50n : 80n;
      await state.afterReceipt?.();
      return {
        transactionHash: args.hash,
        transactionIndex: mint ? 1 : 2,
        blockNumber: number,
        blockHash: state.receiptCanonical ? blockHash(number) : hash("ef"),
        status: state.receiptStatus,
        logs: [
          {
            address: config.contractAddress,
            data: "0x",
            logIndex: mint ? 0 : state.receiptLogIndex,
            topics: encodeEventTopics({
              abi: [transfer],
              eventName: "Transfer",
              args: {
                from: mint ? zeroAddress : buyer.address,
                to: mint ? state.mintRecipient : state.transferRecipient,
                tokenId
              }
            })
          }
        ]
      };
    }
  } as unknown as PublicClient;
  const options = {
    confirmations: 20n,
    indexerMaxAgeMs: 60000,
    now: () => fixtureNow
  };
  return {
    intent,
    draft,
    signature,
    request,
    input,
    policy,
    indexed,
    client,
    state,
    options,
    inspect: () => inspectOpenSeaAdmission(client, input, indexed, options)
  };
}
