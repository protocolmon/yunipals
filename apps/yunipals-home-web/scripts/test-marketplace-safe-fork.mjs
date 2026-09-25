import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  toHex,
  zeroAddress,
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
import { createBnbPublicationIntent } from "../src/lib/marketplace/orderPublication.ts";
import { assertMarketReceipt } from "../src/lib/marketplace/transactionIntent.ts";
import { verifyBnbOrderMaker } from "../src/lib/marketplace/verifyOrderMaker.ts";

// Pinned official deployment metadata, including bytecode hashes:
// https://github.com/safe-global/safe-deployments/tree/1c3aad8cf686157272d7e5de05dae8cf5594e0bc/src/assets/v1.4.1
// All four tested chains have the canonical deployment for these contracts.
const deploymentCommit = "1c3aad8cf686157272d7e5de05dae8cf5594e0bc";
const deployments = {
  safe: {
    address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    codeHash:
      "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4"
  },
  safe_l2: {
    address: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    codeHash:
      "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff"
  },
  safe_proxy_factory: {
    address: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    codeHash:
      "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317"
  },
  compatibility_fallback_handler: {
    address: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    codeHash:
      "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9"
  }
};
const { values } = parseArgs({
  options: {
    chain: { type: "string", default: "bnb" },
    rpc: { type: "string", default: "http://127.0.0.1:18547" },
    "token-id": { type: "string" },
    output: { type: "string" }
  }
});
const config = marketplaceChains[values.chain];
if (!config) throw new Error("Unsupported collection chain.");
if (values.chain === "base" && !values["token-id"])
  throw new Error(
    "Base requires an existing --token-id; its NFT is not enumerable."
  );
const url = new URL(values.rpc);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.username ||
  url.password
)
  throw new Error(
    "Safe tests only accept an unauthenticated loopback HTTP URL."
  );
const transport = http(values.rpc, { timeout: 30_000, retryCount: 0 });
const client = createPublicClient({
  transport,
  cacheTime: 0,
  pollingInterval: 50
});
const rpc = (method, params = []) => client.request({ method, params });

// Identity, upstream chain and official code checks precede ALL mutations.
assert.match(await rpc("web3_clientVersion"), /anvil/i);
const metadata = await rpc("anvil_metadata");
assert.ok(metadata.forkedNetwork, "Anvil must have upstream fork metadata.");
assert.equal(await client.getChainId(), config.chainId);
assert.equal(Number(metadata.forkedNetwork.chainId), config.chainId);
for (const [name, deployment] of Object.entries(deployments)) {
  const code = await client.getCode({ address: deployment.address });
  assert.ok(code && code !== "0x", `${name} is not deployed.`);
  assert.equal(
    keccak256(code),
    deployment.codeHash,
    `${name} bytecode differs.`
  );
}
const collection = config.contractAddress;
const protocol = seaportDeployment.address;
const singletonName = values.chain === "ethereum" ? "safe" : "safe_l2";
const singleton = deployments[singletonName].address;
const domain = {
  ...seaportDeployment,
  chainId: config.chainId,
  verifyingContract: protocol
};
delete domain.address;
const [version] = await client.readContract({
  address: protocol,
  abi: seaportReadAbi,
  functionName: "information"
});
assert.equal(version, seaportDeployment.version);
const safeAbi = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function VERSION() view returns (string)",
  "function swapOwner(address prevOwner, address oldOwner, address newOwner)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)",
  "function getMessageHash(bytes message) view returns (bytes32)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)"
]);
const factoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)"
]);
const nftAbi = [
  ...erc721Abi,
  ...parseAbi(["function tokenByIndex(uint256 index) view returns (uint256)"])
];
const wrappedAbi = [...erc20Abi, ...parseAbi(["function deposit() payable"])];
const safeTxTypes = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" }
  ]
};
const safeMessageTypes = { SafeMessage: [{ name: "message", type: "bytes" }] };
// Public keys used only after proving this is a local fork. No Safe code or
// storage is replaced; real proxies are initialized through the real factory.
const accounts = [1, 2, 3, 4, 5].map((key) =>
  privateKeyToAccount(`0x${key.toString(16).padStart(64, "0")}`)
);
const [ownerA, ownerB, ownerC, relayer, feeAccount] = accounts;
const feeRecipient = feeAccount.address;
const tokenId = values["token-id"]
  ? BigInt(values["token-id"])
  : await client.readContract({
      address: collection,
      abi: nftAbi,
      functionName: "tokenByIndex",
      args: [0n]
    });
const asset = {
  chain: values.chain,
  chainId: config.chainId,
  contractAddress: collection,
  tokenId: tokenId.toString()
};
const originalOwner = await client.readContract({
  address: collection,
  abi: nftAbi,
  functionName: "ownerOf",
  args: [tokenId]
});
const price = 10n ** 17n;
const fee = price / 40n;
const report = {
  checkedAt: new Date().toISOString(),
  chain: values.chain,
  chainId: config.chainId,
  forkBlock: metadata.forkedNetwork.forkBlockNumber,
  collection,
  tokenId: tokenId.toString(),
  scope:
    "Official Safe 1.4.1 factory/singleton/fallback handler on a verified local Anvil fork. Locally signed full-open direct-approval Seaport orders. No live transactions, OpenSea API, Safe connector or counterfactual wallet coverage.",
  deploymentCommit,
  verifiedDeployments: deployments,
  singleton: singletonName,
  tests: []
};

const read = (address, abi, functionName, args = []) =>
  client.readContract({ address, abi, functionName, args });
async function fund(address) {
  await rpc("anvil_setBalance", [address, toHex(100n * 10n ** 18n)]);
}
async function send(
  account,
  address,
  abi,
  functionName,
  args = [],
  value = 0n
) {
  const { request, result } = await client.simulateContract({
    account,
    address,
    abi,
    functionName,
    args,
    value
  });
  const wallet = createWalletClient({ account, transport });
  const hash = await wallet.writeContract({ ...request, chain: null });
  await rpc("evm_mine");
  const receipt = await client.getTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return { result, receipt };
}
async function signatures(typedData, signers) {
  const sorted = [...signers].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  );
  return concatHex(
    await Promise.all(sorted.map((signer) => signer.signTypedData(typedData)))
  );
}
async function createSafe(signers, salt) {
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [
      signers.map((signer) => signer.address),
      BigInt(signers.length),
      zeroAddress,
      "0x",
      deployments.compatibility_fallback_handler.address,
      zeroAddress,
      0n,
      zeroAddress
    ]
  });
  const { result: address, receipt } = await send(
    relayer,
    deployments.safe_proxy_factory.address,
    factoryAbi,
    "createProxyWithNonce",
    [singleton, initializer, salt]
  );
  const [event] = parseEventLogs({
    abi: factoryAbi,
    eventName: "ProxyCreation",
    logs: receipt.logs,
    strict: true
  });
  assert.equal(
    getAddress(event.address),
    getAddress(deployments.safe_proxy_factory.address)
  );
  assert.equal(event.args.proxy, address);
  assert.equal(event.args.singleton, singleton);
  assert.equal(await read(address, safeAbi, "VERSION"), "1.4.1");
  assert.equal(
    await read(address, safeAbi, "getThreshold"),
    BigInt(signers.length)
  );
  assert.deepEqual(
    await read(address, safeAbi, "getOwners"),
    signers.map((signer) => signer.address)
  );
  await fund(address);
  return { address, signers };
}
async function execute(
  safe,
  to,
  abi,
  functionName,
  args = [],
  value = 0n,
  expectSuccess = true,
  signers = safe.signers
) {
  const message = {
    to,
    value,
    data: encodeFunctionData({ abi, functionName, args }),
    operation: 0,
    safeTxGas: expectSuccess ? 0n : 1_000_000n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: await read(safe.address, safeAbi, "nonce")
  };
  const typedData = {
    domain: { chainId: config.chainId, verifyingContract: safe.address },
    primaryType: "SafeTx",
    types: safeTxTypes,
    message
  };
  const txHash = hashTypedData(typedData);
  const params = [
    message.to,
    message.value,
    message.data,
    message.operation,
    message.safeTxGas,
    message.baseGas,
    message.gasPrice,
    message.gasToken,
    message.refundReceiver
  ];
  assert.equal(
    await read(safe.address, safeAbi, "getTransactionHash", [
      ...params,
      message.nonce
    ]),
    txHash
  );
  const { result, receipt } = await send(
    relayer,
    safe.address,
    safeAbi,
    "execTransaction",
    [...params, await signatures(typedData, signers)]
  );
  assert.equal(result, expectSuccess);
  const events = parseEventLogs({
    abi: safeAbi,
    eventName: expectSuccess ? "ExecutionSuccess" : "ExecutionFailure",
    logs: receipt.logs,
    strict: true
  });
  assert.ok(
    events.some(
      (event) =>
        getAddress(event.address) === getAddress(safe.address) &&
        event.args.txHash === txHash
    )
  );
  return receipt;
}
async function orderFor(maker, side = "listing") {
  const timestamp = (await client.getBlock()).timestamp;
  const counter = await read(protocol, seaportReadAbi, "getCounter", [
    maker.address
  ]);
  const common = {
    collection,
    tokenId,
    totalPrice: price,
    startTime: timestamp,
    endTime: timestamp + 3600n,
    counter,
    salt: 123456789n,
    fees: [{ recipient: feeRecipient, amount: fee }]
  };
  const order =
    side === "listing"
      ? createNativeListing({ ...common, seller: maker.address })
      : createItemOffer({
          ...common,
          buyer: maker.address,
          paymentToken: bnbOfferCurrency.address
        });
  assert.equal(
    await read(protocol, seaportReadAbi, "getOrderHash", [order]),
    seaportOrderHash(order)
  );
  return order;
}
function safeMessage(safe, digest, chainId = config.chainId) {
  return {
    domain: { chainId, verifyingContract: safe.address },
    primaryType: "SafeMessage",
    types: safeMessageTypes,
    message: { message: digest }
  };
}
async function signOrder(
  safe,
  order,
  signers = safe.signers,
  signingDomain = domain
) {
  const digest = hashTypedData(seaportSigningData(signingDomain, order));
  const typedData = safeMessage(safe, digest);
  assert.equal(
    await read(safe.address, safeAbi, "getMessageHash", [digest]),
    hashTypedData(typedData)
  );
  return signatures(typedData, signers);
}
async function verify(safe, order, signature) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const digest = hashTypedData(seaportSigningData(domain, order));
  assert.equal(
    await client.readContract({
      address: safe.address,
      account: protocol,
      abi: safeAbi,
      functionName: "isValidSignature",
      args: [digest, signature],
      blockNumber
    }),
    "0x1626ba7e"
  );
  if (values.chain === "bnb") {
    const side = order.offer[0].itemType === 2 ? "listing" : "offer";
    const intent = createBnbPublicationIntent(
      {
        asset,
        lifecycle: 1,
        maker: safe.address,
        side,
        grossAmount: price,
        endTime: order.endTime
      },
      {
        collection,
        offerCurrency: bnbOfferCurrency.address,
        fees: [{ recipient: feeRecipient, basisPoints: 250 }],
        maxDurationSeconds: 3600n
      },
      { timestamp: order.startTime, counter: order.counter },
      order.salt
    );
    assert.equal(intent.orderHash, seaportOrderHash(order));
    assert.equal(
      await verifyBnbOrderMaker(client, intent, signature, blockNumber),
      true
    );
  }
}
function expectation(kind, account, order) {
  return {
    kind,
    account,
    chainId: config.chainId,
    asset,
    order,
    orderHash: seaportOrderHash(order),
    maker: order.offerer
  };
}
function fillArgs(order, signature) {
  return [seaportFulfillmentOrder(order, signature), zeroHash];
}
async function rejectFill(order, signature) {
  // An upstream timeout/pruned-state failure cannot count as a contract rejection.
  await assert.rejects(
    client.simulateContract({
      account: relayer,
      address: protocol,
      abi: seaportWriteAbi,
      functionName: "fulfillOrder",
      args: fillArgs(order, signature),
      value: price
    }),
    (error) => {
      const reverted = error.walk?.(
        (cause) => cause.name === "ContractFunctionRevertedError"
      );
      return Boolean(reverted?.raw && reverted.raw !== "0x");
    }
  );
}
async function scenario(name, action) {
  const snapshot = await rpc("evm_snapshot");
  try {
    await action();
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

const initial = await rpc("evm_snapshot");
try {
  for (const account of accounts) {
    await fund(account.address);
    await rpc("anvil_setCode", [account.address, "0x"]);
    await rpc("anvil_setNonce", [account.address, "0x0"]);
  }
  const seller = await createSafe([ownerA, ownerB], 202609051n);
  const buyer = await createSafe([ownerC], 202609052n);
  report.wallets = {
    seller: { address: seller.address, threshold: 2, owners: 2 },
    buyer: { address: buyer.address, threshold: 1, owners: 1 }
  };
  await fund(originalOwner);
  await rpc("anvil_impersonateAccount", [originalOwner]);
  try {
    await send(originalOwner, collection, nftAbi, "transferFrom", [
      originalOwner,
      seller.address,
      tokenId
    ]);
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [originalOwner]);
  }
  const approval = await execute(seller, collection, nftAbi, "approve", [
    protocol,
    tokenId
  ]);
  assertMarketReceipt(
    {
      kind: "approve-nft",
      chainId: config.chainId,
      account: seller.address,
      asset
    },
    approval
  );

  await scenario(
    "2-of-2 Safe listing settles through a 1-of-1 Safe with exact native payments and an outer receipt",
    async () => {
      const order = await orderFor(seller);
      const signature = await signOrder(seller, order);
      await verify(seller, order, signature);
      const before = await Promise.all(
        [seller.address, buyer.address, feeRecipient].map((address) =>
          client.getBalance({ address })
        )
      );
      const receipt = await execute(
        buyer,
        protocol,
        seaportWriteAbi,
        "fulfillOrder",
        fillArgs(order, signature),
        price
      );
      assertMarketReceipt(expectation("buy", buyer.address, order), receipt);
      assert.equal(
        await read(collection, nftAbi, "ownerOf", [tokenId]),
        buyer.address
      );
      const after = await Promise.all(
        [seller.address, buyer.address, feeRecipient].map((address) =>
          client.getBalance({ address })
        )
      );
      assert.deepEqual(
        after.map((balance, i) => balance - before[i]),
        [price - fee, -price, fee]
      );
      await rejectFill(order, signature);
    }
  );
  await scenario(
    "a single owner cannot authorize a 2-of-2 Safe listing",
    async () => {
      const order = await orderFor(seller);
      await rejectFill(order, await signOrder(seller, order, [ownerA]));
    }
  );
  await scenario(
    "a Safe signature for the wrong Seaport chain is rejected",
    async () => {
      const order = await orderFor(seller);
      await rejectFill(
        order,
        await signOrder(seller, order, seller.signers, {
          ...domain,
          chainId: config.chainId + 1
        })
      );
    }
  );
  await scenario(
    "owner EOA signatures without the SafeMessage wrapper are rejected",
    async () => {
      const order = await orderFor(seller);
      await rejectFill(
        order,
        await signatures(seaportSigningData(domain, order), seller.signers)
      );
    }
  );
  await scenario(
    "SafeMessage signatures cannot be replayed from another Safe address",
    async () => {
      const order = await orderFor(seller);
      const digest = hashTypedData(seaportSigningData(domain, order));
      await rejectFill(
        order,
        await signatures(safeMessage(buyer, digest), seller.signers)
      );
    }
  );
  await scenario(
    "a Safe can cancel its listing and the outer receipt confirms cancellation",
    async () => {
      const order = await orderFor(seller);
      const signature = await signOrder(seller, order);
      const receipt = await execute(
        seller,
        protocol,
        seaportWriteAbi,
        "cancel",
        [[order]]
      );
      assertMarketReceipt(
        expectation("cancel", seller.address, order),
        receipt
      );
      assert.equal(
        (
          await read(protocol, seaportReadAbi, "getOrderStatus", [
            seaportOrderHash(order)
          ])
        )[1],
        true
      );
      await rejectFill(order, signature);
    }
  );
  await scenario(
    "a Safe counter increment invalidates its previous listing",
    async () => {
      const order = await orderFor(seller);
      const signature = await signOrder(seller, order);
      await execute(seller, protocol, seaportWriteAbi, "incrementCounter");
      assert.notEqual(
        await read(protocol, seaportReadAbi, "getCounter", [seller.address]),
        order.counter
      );
      await rejectFill(order, signature);
    }
  );
  await scenario(
    "owner rotation invalidates an ERC-1271 order and restoring that owner revives it",
    async () => {
      const order = await orderFor(seller);
      const signature = await signOrder(seller, order);
      await execute(seller, seller.address, safeAbi, "swapOwner", [
        ownerA.address,
        ownerB.address,
        ownerC.address
      ]);
      await rejectFill(order, signature);
      await execute(
        seller,
        seller.address,
        safeAbi,
        "swapOwner",
        [ownerA.address, ownerC.address, ownerB.address],
        0n,
        true,
        [ownerA, ownerC]
      );
      await verify(seller, order, signature);
      const receipt = await execute(
        buyer,
        protocol,
        seaportWriteAbi,
        "fulfillOrder",
        fillArgs(order, signature),
        price
      );
      assertMarketReceipt(expectation("buy", buyer.address, order), receipt);
    }
  );
  await scenario(
    "successful outer Safe transaction with a failed inner fill is not reported as a purchase",
    async () => {
      const order = await orderFor(seller);
      const signature = await signOrder(seller, order);
      await execute(seller, protocol, seaportWriteAbi, "cancel", [[order]]);
      const receipt = await execute(
        buyer,
        protocol,
        seaportWriteAbi,
        "fulfillOrder",
        fillArgs(order, signature),
        price,
        false
      );
      assert.equal(receipt.status, "success");
      assert.throws(
        () =>
          assertMarketReceipt(
            expectation("buy", buyer.address, order),
            receipt
          ),
        /does not confirm/
      );
      assert.equal(
        await read(collection, nftAbi, "ownerOf", [tokenId]),
        seller.address
      );
    }
  );
  if (values.chain === "bnb") {
    await scenario(
      "1-of-1 Safe wraps and approves WBNB, signs an item offer, and 2-of-2 Safe accepts with exact payments",
      async () => {
        const wrapped = await execute(
          buyer,
          bnbOfferCurrency.address,
          wrappedAbi,
          "deposit",
          [],
          price
        );
        assertMarketReceipt(
          { kind: "wrap", account: buyer.address, chainId: 56, amount: price },
          wrapped
        );
        const approved = await execute(
          buyer,
          bnbOfferCurrency.address,
          wrappedAbi,
          "approve",
          [protocol, price]
        );
        assertMarketReceipt(
          {
            kind: "approve-currency",
            account: buyer.address,
            chainId: 56,
            amount: price
          },
          approved
        );
        const order = await orderFor(buyer, "offer");
        const signature = await signOrder(buyer, order);
        await verify(buyer, order, signature);
        const balances = () =>
          Promise.all(
            [seller.address, buyer.address, feeRecipient].map((address) =>
              read(bnbOfferCurrency.address, wrappedAbi, "balanceOf", [address])
            )
          );
        const before = await balances();
        const receipt = await execute(
          seller,
          protocol,
          seaportWriteAbi,
          "fulfillBasicOrder",
          [seaportBasicOfferParameters(order, signature)]
        );
        assertMarketReceipt(
          expectation("accept-offer", seller.address, order),
          receipt
        );
        assert.equal(
          await read(collection, nftAbi, "ownerOf", [tokenId]),
          buyer.address
        );
        assert.deepEqual(
          (await balances()).map((balance, i) => balance - before[i]),
          [price - fee, -price, fee]
        );
      }
    );
    await scenario(
      "Safe item-offer cancellation produces the expected outer receipt and onchain status",
      async () => {
        const order = await orderFor(buyer, "offer");
        const signature = await signOrder(buyer, order);
        await verify(buyer, order, signature);
        const receipt = await execute(
          buyer,
          protocol,
          seaportWriteAbi,
          "cancel",
          [[order]]
        );
        assertMarketReceipt(
          expectation("cancel", buyer.address, order),
          receipt
        );
        assert.equal(
          (
            await read(protocol, seaportReadAbi, "getOrderStatus", [
              seaportOrderHash(order)
            ])
          )[1],
          true
        );
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
