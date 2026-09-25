import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  erc721Abi,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroHash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment
} from "../src/lib/marketplace/registry.ts";
import {
  createItemOffer,
  createNativeListing,
  seaportBasicOfferParameters,
  seaportFulfillmentOrder,
  seaportOrderHash,
  seaportReadAbi,
  seaportSigningData,
  seaportWriteAbi
} from "../src/lib/marketplace/seaport.ts";
import { encodeSeaportOrder } from "../src/lib/marketplace/seaportWire.ts";
import { observeMarketSale } from "../src/lib/marketplace/settledSale.ts";
import {
  assertMarketReceipt,
  buildBnbFulfillment,
  buildBnbNftApproval
} from "../src/lib/marketplace/transactionIntent.ts";
import {
  pendingTransaction,
  decodePendingTransactions
} from "../src/lib/marketplace/pendingTransactions.ts";

const { values } = parseArgs({
  options: {
    chain: { type: "string", default: "bnb" },
    rpc: { type: "string", default: "http://127.0.0.1:18547" },
    "token-id": { type: "string" },
    minter: { type: "string" },
    operator: { type: "string" },
    output: { type: "string" }
  }
});
const config = marketplaceChains[values.chain];
if (!config) throw new Error("Unsupported collection chain.");
if (values.chain === "base" && (!values["token-id"] || !values.minter)) {
  throw new Error(
    "Base requires --token-id and --minter because its NFT and roles are not enumerable."
  );
}
const url = new URL(values.rpc);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.username ||
  url.password
) {
  throw new Error(
    "Fork tests only accept an unauthenticated loopback HTTP URL."
  );
}
const transport = http(values.rpc, { timeout: 30_000, retryCount: 0 });
const client = createPublicClient({
  transport,
  cacheTime: 0,
  pollingInterval: 50
});
const rpc = (method, params = []) => client.request({ method, params });

// Verify the local node's identity and fork metadata BEFORE any mutation.
assert.match(await rpc("web3_clientVersion"), /anvil/i);
const metadata = await rpc("anvil_metadata");
assert.ok(metadata.forkedNetwork, "Anvil must have a pinned upstream fork.");
assert.equal(await client.getChainId(), config.chainId);
const forkBlock = metadata.forkedNetwork.forkBlockNumber;
const collection = config.contractAddress;
const protocol = seaportDeployment.address;
const nftAbi = [
  ...erc721Abi,
  ...parseAbi([
    "function tokenByIndex(uint256 index) view returns (uint256)",
    "function burn(uint256 tokenId)",
    "function mint(address to, uint256 tokenId)",
    "function MINTER_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function getRoleMember(bytes32 role, uint256 index) view returns (address)"
  ])
];
const wrappedAbi = [
  ...erc20Abi,
  ...parseAbi([
    "function deposit() payable",
    "function withdraw(uint256 amount)"
  ])
];
// Verified Base implementation ABI: Sourcify chain 8453, implementation
// 0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca. Base uses batch mint + onchain traits.
const baseNftAbi = parseAbi([
  "struct Yunipal { uint16 monsterType; uint16 color; uint16 horn; uint8 background; uint8 glitter; uint40 rarityScore; }",
  "function yunipal(uint256 tokenId) view returns (Yunipal)",
  "function safeMintBatch(address to, uint256[] tokenIds, Yunipal[] yunipalsArray)",
  "function updateYunipals(uint256[] tokenIds, Yunipal[] yunipalsArray)",
  "function setTransfersEnabled(bool enabled)"
]);

// Public fixture keys. Every transaction is restricted to the verified fork.
const seller = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const buyer = privateKeyToAccount(`0x${"2".padStart(64, "0")}`);
const feeRecipient = privateKeyToAccount(`0x${"3".padStart(64, "0")}`).address;
const tokenId = values["token-id"]
  ? BigInt(values["token-id"])
  : await client.readContract({
      address: collection,
      abi: nftAbi,
      functionName: "tokenByIndex",
      args: [0n]
    });
const originalOwner = await client.readContract({
  address: collection,
  abi: nftAbi,
  functionName: "ownerOf",
  args: [tokenId]
});
const baseTraits =
  values.chain === "base"
    ? await client.readContract({
        address: collection,
        abi: baseNftAbi,
        functionName: "yunipal",
        args: [tokenId]
      })
    : undefined;
const price = 10n ** 17n;
const fee = price / 40n;
const domain = {
  name: seaportDeployment.name,
  version: seaportDeployment.version,
  chainId: config.chainId,
  verifyingContract: protocol
};
const report = {
  checkedAt: new Date().toISOString(),
  chain: values.chain,
  chainId: config.chainId,
  forkBlock,
  collection,
  tokenId: tokenId.toString(),
  scope:
    "Transactions were executed only on a verified loopback Anvil fork, never on the upstream chain.",
  tests: [],
  saleObservations: []
};
const knownSaleOrders = new Map();

async function fund(address) {
  await rpc("anvil_setBalance", [address, toHex(100n * 10n ** 18n)]);
}
async function send(account, address, abi, functionName, args, value) {
  process.stdout.write(`Executing local ${functionName}\n`);
  const wallet = createWalletClient({ account, transport });
  const { request } = await client.simulateContract({
    account,
    address,
    abi,
    functionName,
    args,
    ...(value === undefined ? {} : { value })
  });
  const hash = await wallet.writeContract({ ...request, chain: null });
  // Explicit mining keeps this fork harness independent of wall-clock polling.
  // Production UI receipt/replacement handling is separate.
  await rpc("evm_mine");
  const receipt = await rpc("eth_getTransactionReceipt", [hash]);
  assert.ok(receipt, "Local transaction receipt must exist after mining.");
  assert.equal(receipt.status, "0x1");
  return receipt;
}
async function withImpersonated(address, action) {
  await fund(address);
  await rpc("anvil_impersonateAccount", [address]);
  try {
    return await action();
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [address]);
  }
}
async function createOrder(overrides = {}) {
  const block = await client.getBlock();
  const counter = await client.readContract({
    address: protocol,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [seller.address]
  });
  return createNativeListing({
    seller: seller.address,
    collection,
    tokenId,
    totalPrice: price,
    startTime: block.timestamp,
    endTime: block.timestamp + 3600n,
    counter,
    salt: 123456n,
    fees: [{ recipient: feeRecipient, amount: fee }],
    ...overrides
  });
}
async function sign(order, signingDomain = domain) {
  return seller.signTypedData(seaportSigningData(signingDomain, order));
}
const fulfillmentArgs = (order, signature) => [
  seaportFulfillmentOrder(order, signature),
  zeroHash
];
async function simulateFill(order, signature) {
  return client.simulateContract({
    account: buyer,
    address: protocol,
    abi: seaportWriteAbi,
    functionName: "fulfillOrder",
    args: fulfillmentArgs(order, signature),
    value: price
  });
}
async function rejectFill(order, signature) {
  await rejectsOnchain(simulateFill(order, signature));
}
async function rejectsOnchain(action) {
  await assert.rejects(action, (error) => {
    const reverted = error.walk?.(
      (cause) => cause.name === "ContractFunctionRevertedError"
    );
    // A pruned fork/RPC failure must not count as an expected contract revert.
    return Boolean(reverted?.raw && reverted.raw !== "0x");
  });
}
async function createOffer(overrides = {}) {
  const block = await client.getBlock();
  const counter = await client.readContract({
    address: protocol,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [buyer.address]
  });
  return createItemOffer({
    buyer: buyer.address,
    collection,
    tokenId,
    paymentToken: bnbOfferCurrency.address,
    totalPrice: price,
    startTime: block.timestamp,
    endTime: block.timestamp + 3600n,
    counter,
    salt: 654321n,
    fees: [{ recipient: feeRecipient, amount: fee }],
    ...overrides
  });
}
async function signOffer(order, signingDomain = domain) {
  return buyer.signTypedData(seaportSigningData(signingDomain, order));
}
async function acceptOffer(order, signature) {
  return send(seller, protocol, seaportWriteAbi, "fulfillBasicOrder", [
    seaportBasicOfferParameters(order, signature)
  ]);
}
async function rejectOffer(order, signature) {
  await rejectsOnchain(
    client.simulateContract({
      account: seller,
      address: protocol,
      abi: seaportWriteAbi,
      functionName: "fulfillBasicOrder",
      args: [seaportBasicOfferParameters(order, signature)]
    })
  );
}
async function wrappedBalance(address) {
  return client.readContract({
    address: bnbOfferCurrency.address,
    abi: wrappedAbi,
    functionName: "balanceOf",
    args: [address]
  });
}
async function remintToSeller() {
  const role = await client.readContract({
    address: collection,
    abi: nftAbi,
    functionName: "MINTER_ROLE"
  });
  const minter =
    values.minter ??
    (await client.readContract({
      address: collection,
      abi: nftAbi,
      functionName: "getRoleMember",
      args: [role, 0n]
    }));
  assert.equal(
    await client.readContract({
      address: collection,
      abi: nftAbi,
      functionName: "hasRole",
      args: [role, minter]
    }),
    true,
    "The fixture minter must have the collection's actual MINTER_ROLE."
  );
  await withImpersonated(minter, () =>
    values.chain === "base"
      ? send(minter, collection, baseNftAbi, "safeMintBatch", [
          seller.address,
          [tokenId],
          [baseTraits]
        ])
      : send(minter, collection, nftAbi, "mint", [seller.address, tokenId])
  );
}
async function withBaseRole(role, action) {
  const operator = values.operator ?? values.minter;
  assert.equal(
    await client.readContract({
      address: collection,
      abi: nftAbi,
      functionName: "hasRole",
      args: [role, operator]
    }),
    true,
    "Base lifecycle fixture operator must already have the required role."
  );
  return withImpersonated(operator, () => action(operator));
}
async function fill(order, signature) {
  return send(
    buyer,
    protocol,
    seaportWriteAbi,
    "fulfillOrder",
    fulfillmentArgs(order, signature),
    price
  );
}
async function scenario(name, run) {
  const snapshot = await rpc("evm_snapshot");
  try {
    await run();
    report.tests.push({ name, status: "passed" });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    report.tests.push({
      name,
      status: "failed",
      error: error.shortMessage ?? error.message
    });
    process.stdout.write(
      `FAIL ${name}: ${error.shortMessage ?? error.message}\n`
    );
  } finally {
    assert.equal(await rpc("evm_revert", [snapshot]), true);
  }
}

async function frontendIntent(order, signature, side) {
  const block = await client.getBlock();
  const asset = {
    chain: "bnb",
    chainId: 56,
    contractAddress: collection,
    tokenId: tokenId.toString()
  };
  const summary = {
    asset,
    lifecycle: 1,
    orderHash: seaportOrderHash(order),
    protocolAddress: protocol,
    source: "yunipals",
    side,
    maker: order.offerer,
    currency: {
      address:
        side === "listing"
          ? "0x0000000000000000000000000000000000000000"
          : bnbOfferCurrency.address,
      symbol: side === "listing" ? "BNB" : "WBNB",
      decimals: 18
    },
    grossAmount: price.toString(),
    sellerProceeds: (price - fee).toString(),
    fees: [{ recipient: feeRecipient, amount: fee.toString() }],
    startTime: order.startTime.toString(),
    endTime: order.endTime.toString(),
    status: "active"
  };
  const actor = side === "listing" ? buyer.address : seller.address;
  knownSaleOrders.set(summary.orderHash, summary);
  return buildBnbFulfillment(
    {
      id: "local-fork-quote",
      asset,
      lifecycle: 1,
      actor,
      orderHash: summary.orderHash,
      expiresAt: (block.timestamp + 60n).toString(),
      order: encodeSeaportOrder(order),
      signature
    },
    summary,
    actor,
    {
      collection,
      offerCurrency: bnbOfferCurrency.address,
      fees: [{ recipient: feeRecipient, basisPoints: 250 }],
      maxDurationSeconds: 3600n
    },
    block.timestamp
  );
}

async function sendFrontendIntent(intent, account) {
  assert.equal(intent.account.toLowerCase(), account.address.toLowerCase());
  const call = { to: intent.to, data: intent.data, value: intent.value };
  await client.call({ ...call, account });
  const wallet = createWalletClient({ account, transport });
  const hash = await wallet.sendTransaction({ ...call, chain: null });
  await rpc("evm_mine");
  const receipt = await client.getTransactionReceipt({ hash });
  assertMarketReceipt(intent, receipt);
  const saved = JSON.stringify(
    [pendingTransaction(hash, intent)],
    (_, value) => (typeof value === "bigint" ? value.toString() : value)
  );
  const recovered = decodePendingTransactions(saved);
  assert.equal(recovered.length, 1);
  assertMarketReceipt(recovered[0].expectation, receipt);
  if (intent.kind === "buy" || intent.kind === "accept-offer") {
    const order = knownSaleOrders.get(intent.orderHash);
    assert.ok(order);
    const block = await client.getBlock({ blockHash: receipt.blockHash });
    const sale = observeMarketSale(order, receipt, block);
    assert.equal(sale.seller, seller.address);
    assert.equal(sale.nftRecipient, buyer.address);
    report.saleObservations.push(sale);
  }
  return receipt;
}

const initial = await rpc("evm_snapshot");
try {
  await rpc("evm_setAutomine", [true]);
  // Public fixture addresses can have live delegation code. These scenarios
  // explicitly test EOAs; clear code/nonce only on the isolated local fixtures.
  for (const address of [seller.address, buyer.address, feeRecipient]) {
    await rpc("anvil_setCode", [address, "0x"]);
    await rpc("anvil_setNonce", [address, "0x0"]);
  }
  await fund(seller.address);
  await fund(buyer.address);
  await withImpersonated(originalOwner, () =>
    send(originalOwner, collection, nftAbi, "transferFrom", [
      originalOwner,
      seller.address,
      tokenId
    ])
  );
  await send(seller, collection, nftAbi, "setApprovalForAll", [protocol, true]);

  await scenario(
    "purchase transfers the NFT and pays the exact seller and fee amounts",
    async () => {
      const order = await createOrder();
      const signature = await sign(order);
      const beforeBlock = await client.getBlockNumber({ cacheTime: 0 });
      const sellerBefore = await client.getBalance({
        address: seller.address,
        blockNumber: beforeBlock
      });
      const feeBefore = await client.getBalance({
        address: feeRecipient,
        blockNumber: beforeBlock
      });
      const receipt = await fill(order, signature);
      const afterBlock = BigInt(receipt.blockNumber);
      const sellerAfter = await client.getBalance({
        address: seller.address,
        blockNumber: afterBlock
      });
      const feeAfter = await client.getBalance({
        address: feeRecipient,
        blockNumber: afterBlock
      });
      assert.equal(
        (
          await client.readContract({
            address: collection,
            abi: nftAbi,
            functionName: "ownerOf",
            args: [tokenId],
            blockNumber: afterBlock
          })
        ).toLowerCase(),
        buyer.address.toLowerCase()
      );
      assert.equal(sellerAfter - sellerBefore, price - fee);
      assert.equal(feeAfter - feeBefore, fee);
      const status = await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [seaportOrderHash(order)]
      });
      assert.equal(status[2], status[3]);
      assert.ok(status[2] > 0n);
      await rejectFill(order, signature);
    }
  );
  await scenario(
    "individual cancellation invalidates the signature",
    async () => {
      const order = await createOrder();
      const signature = await sign(order);
      await send(seller, protocol, seaportWriteAbi, "cancel", [[order]]);
      const status = await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [seaportOrderHash(order)]
      });
      assert.equal(status[1], true);
      await rejectFill(order, signature);
    }
  );
  await scenario(
    "counter increment invalidates the previous signed order",
    async () => {
      const order = await createOrder();
      const signature = await sign(order);
      await send(seller, protocol, seaportWriteAbi, "incrementCounter", []);
      await rejectFill(order, signature);
    }
  );
  await scenario("a signature for another chain cannot fulfill", async () => {
    const order = await createOrder();
    await rejectFill(
      order,
      await sign(order, { ...domain, chainId: config.chainId + 1 })
    );
  });
  await scenario("expired listings cannot fulfill", async () => {
    const order = await createOrder();
    const signature = await sign(order);
    await rpc("evm_setNextBlockTimestamp", [Number(order.endTime + 1n)]);
    await rpc("evm_mine");
    await rejectFill(order, signature);
  });
  await scenario(
    "restoring an approval can revive an uncancelled listing",
    async () => {
      const order = await createOrder();
      const signature = await sign(order);
      await send(seller, collection, nftAbi, "setApprovalForAll", [
        protocol,
        false
      ]);
      await rejectFill(order, signature);
      await send(seller, collection, nftAbi, "setApprovalForAll", [
        protocol,
        true
      ]);
      await fill(order, signature);
    }
  );
  await scenario(
    "returning ownership can revive an uncancelled listing",
    async () => {
      const order = await createOrder();
      const signature = await sign(order);
      await send(seller, collection, nftAbi, "transferFrom", [
        seller.address,
        buyer.address,
        tokenId
      ]);
      await rejectFill(order, signature);
      await send(buyer, collection, nftAbi, "transferFrom", [
        buyer.address,
        seller.address,
        tokenId
      ]);
      await fill(order, signature);
    }
  );
  await scenario(
    values.chain === "base"
      ? "Base batch mint skips a burned ID while its nonzero monster metadata remains"
      : "burning and reminting an ID can revive a previous-lifecycle listing",
    async () => {
      const order = await createOrder();
      const signature = await sign(order);
      await send(seller, collection, nftAbi, "burn", [tokenId]);
      await rejectFill(order, signature);
      await remintToSeller();
      if (values.chain === "base") {
        assert.notEqual(baseTraits.monsterType, 0);
        await rejectsOnchain(
          client.readContract({
            address: collection,
            abi: nftAbi,
            functionName: "ownerOf",
            args: [tokenId]
          })
        );
        await rejectFill(order, signature);
      } else {
        await fill(order, signature);
      }
    }
  );
  if (values.chain === "base") {
    const updaterRole = keccak256(toHex("UPDATER_ROLE"));
    await scenario(
      "clearing Base metadata before burning permits a remint that revives the old listing",
      async () => {
        const order = await createOrder();
        const signature = await sign(order);
        await withBaseRole(updaterRole, (operator) =>
          send(operator, collection, baseNftAbi, "updateYunipals", [
            [tokenId],
            [{ ...baseTraits, monsterType: 0 }]
          ])
        );
        await send(seller, collection, nftAbi, "burn", [tokenId]);
        await rejectFill(order, signature);
        await remintToSeller();
        assert.equal(
          (
            await client.readContract({
              address: collection,
              abi: nftAbi,
              functionName: "ownerOf",
              args: [tokenId]
            })
          ).toLowerCase(),
          seller.address.toLowerCase()
        );
        await fill(order, signature);
      }
    );
    await scenario(
      "Base trait updates do not invalidate an existing fixed token-ID listing",
      async () => {
        const order = await createOrder();
        const signature = await sign(order);
        const background = baseTraits.background === 0 ? 1 : 0;
        await withBaseRole(updaterRole, (operator) =>
          send(operator, collection, baseNftAbi, "updateYunipals", [
            [tokenId],
            [{ ...baseTraits, background }]
          ])
        );
        assert.equal(
          (
            await client.readContract({
              address: collection,
              abi: baseNftAbi,
              functionName: "yunipal",
              args: [tokenId]
            })
          ).background,
          background
        );
        await fill(order, signature);
      }
    );
    await scenario(
      "Base transfer pause blocks settlement and restoring transfers revives the listing",
      async () => {
        const order = await createOrder();
        const signature = await sign(order);
        await withBaseRole(zeroHash, async (operator) => {
          await send(operator, collection, baseNftAbi, "setTransfersEnabled", [
            false
          ]);
          await rejectFill(order, signature);
          await send(operator, collection, baseNftAbi, "setTransfersEnabled", [
            true
          ]);
        });
        await fill(order, signature);
      }
    );
  }

  // Currency/provider verification is still pending on the other chains.
  if (values.chain === "bnb") {
    await scenario(
      "frontend-built native purchase and recovered receipt match actual Seaport and NFT events",
      async () => {
        const order = await createOrder();
        await sendFrontendIntent(
          await frontendIntent(order, await sign(order), "listing"),
          buyer
        );
      }
    );
    assert.equal(
      await client.readContract({
        address: bnbOfferCurrency.address,
        abi: wrappedAbi,
        functionName: "decimals"
      }),
      bnbOfferCurrency.decimals
    );
    assert.equal(
      await client.readContract({
        address: bnbOfferCurrency.address,
        abi: wrappedAbi,
        functionName: "symbol"
      }),
      bnbOfferCurrency.symbol
    );
    report.offerCurrency = bnbOfferCurrency;
    await send(
      buyer,
      bnbOfferCurrency.address,
      wrappedAbi,
      "deposit",
      [],
      price * 3n
    );
    await send(buyer, bnbOfferCurrency.address, wrappedAbi, "approve", [
      protocol,
      price * 3n
    ]);
    // Demonstrate basic acceptance works without a seller ERC-20 approval.
    await send(seller, bnbOfferCurrency.address, wrappedAbi, "approve", [
      protocol,
      0n
    ]);
    await scenario(
      "frontend NFT approval and offer acceptance confirm against actual contract receipts",
      async () => {
        await send(seller, collection, nftAbi, "setApprovalForAll", [
          protocol,
          false
        ]);
        const order = await createOffer();
        const intent = await frontendIntent(
          order,
          await signOffer(order),
          "offer"
        );
        await sendFrontendIntent(
          buildBnbNftApproval(intent.asset, seller.address),
          seller
        );
        await sendFrontendIntent(intent, seller);
      }
    );

    await scenario(
      "WBNB offer acceptance pays exact proceeds and fees without seller ERC-20 allowance",
      async () => {
        const order = await createOffer();
        const signature = await signOffer(order);
        const sellerBefore = await wrappedBalance(seller.address);
        const buyerBefore = await wrappedBalance(buyer.address);
        const feeBefore = await wrappedBalance(feeRecipient);
        await acceptOffer(order, signature);
        assert.equal(
          (await wrappedBalance(seller.address)) - sellerBefore,
          price - fee
        );
        assert.equal(
          buyerBefore - (await wrappedBalance(buyer.address)),
          price
        );
        assert.equal((await wrappedBalance(feeRecipient)) - feeBefore, fee);
        assert.equal(
          (
            await client.readContract({
              address: collection,
              abi: nftAbi,
              functionName: "ownerOf",
              args: [tokenId]
            })
          ).toLowerCase(),
          buyer.address.toLowerCase()
        );
        assert.equal(
          await client.readContract({
            address: bnbOfferCurrency.address,
            abi: wrappedAbi,
            functionName: "allowance",
            args: [seller.address, protocol]
          }),
          0n
        );
        await rejectOffer(order, signature);
      }
    );
    await scenario(
      "buyer cancellation invalidates an individual offer",
      async () => {
        const order = await createOffer();
        const signature = await signOffer(order);
        await send(buyer, protocol, seaportWriteAbi, "cancel", [[order]]);
        assert.equal(
          (
            await client.readContract({
              address: protocol,
              abi: seaportReadAbi,
              functionName: "getOrderStatus",
              args: [seaportOrderHash(order)]
            })
          )[1],
          true
        );
        await rejectOffer(order, signature);
      }
    );
    await scenario("buyer counter increment invalidates an offer", async () => {
      const order = await createOffer();
      const signature = await signOffer(order);
      await send(buyer, protocol, seaportWriteAbi, "incrementCounter", []);
      await rejectOffer(order, signature);
    });
    await scenario(
      "revoked allowance blocks an offer and restoring it revives the offer",
      async () => {
        const order = await createOffer();
        const signature = await signOffer(order);
        await send(buyer, bnbOfferCurrency.address, wrappedAbi, "approve", [
          protocol,
          0n
        ]);
        await rejectOffer(order, signature);
        await send(buyer, bnbOfferCurrency.address, wrappedAbi, "approve", [
          protocol,
          price
        ]);
        await acceptOffer(order, signature);
      }
    );
    await scenario(
      "spent WBNB blocks an offer and replenishing the balance revives it",
      async () => {
        const order = await createOffer();
        const signature = await signOffer(order);
        await send(buyer, bnbOfferCurrency.address, wrappedAbi, "transfer", [
          feeRecipient,
          await wrappedBalance(buyer.address)
        ]);
        await rejectOffer(order, signature);
        await send(
          buyer,
          bnbOfferCurrency.address,
          wrappedAbi,
          "deposit",
          [],
          price
        );
        await acceptOffer(order, signature);
      }
    );
    await scenario(
      "offer acceptance rejects signatures for another chain and expired offers",
      async () => {
        const order = await createOffer();
        await rejectOffer(
          order,
          await signOffer(order, { ...domain, chainId: config.chainId + 1 })
        );
        const signature = await signOffer(order);
        await rpc("evm_setNextBlockTimestamp", [Number(order.endTime + 1n)]);
        await rpc("evm_mine");
        await rejectOffer(order, signature);
      }
    );
    await scenario(
      "competing offers cannot both be accepted by a seller who no longer owns the NFT",
      async () => {
        const first = await createOffer();
        const second = await createOffer({ salt: first.salt + 1n });
        const secondSignature = await signOffer(second);
        await acceptOffer(first, await signOffer(first));
        await rejectOffer(second, secondSignature);
      }
    );
    await scenario(
      "a buyer's pre-burn item offer can accept the reminted token ID",
      async () => {
        const order = await createOffer();
        const signature = await signOffer(order);
        await send(seller, collection, nftAbi, "burn", [tokenId]);
        await rejectOffer(order, signature);
        await remintToSeller();
        await acceptOffer(order, signature);
      }
    );
  }
} finally {
  assert.equal(await rpc("evm_revert", [initial]), true);
}
const output = `${JSON.stringify(report, null, 2)}\n`;
if (values.output) await writeFile(values.output, output, { mode: 0o600 });
process.stdout.write(output);
if (report.tests.some((test) => test.status !== "passed")) process.exitCode = 1;
