import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  parseAbi,
  verifyTypedData,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  parsePreparedOrder,
  parsePublishedOrder,
  type MarketOrder
} from "./marketApi";
import { testBuyer, testPolicy, testSeller } from "./marketplace.testFixtures";
import {
  orderSigningData,
  createBnbPublicationIntent,
  publicationRequest
} from "./orderPublication";
import {
  decodeRecoverableOrders,
  readRecoverableOrders,
  saveRecoverableOrder,
  type OrderRecoveryStorage
} from "./orderRecovery";
import {
  publishOrder,
  retryPublication,
  SignedOrderPublicationError,
  type PublicationDependencies,
  type SignedOrder
} from "./publishOrder";
import { marketplaceChains, seaportDeployment } from "./registry";
import { buildSeaportCancellation } from "./transactionIntent";
import { verifyBnbOrderMaker } from "./verifyOrderMaker";

const signer = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);

function setup(side: "listing" | "offer" = "listing") {
  const intent = createBnbPublicationIntent(
    {
      asset: {
        chain: "bnb",
        chainId: 56,
        contractAddress: marketplaceChains.bnb.contractAddress,
        tokenId: "123"
      },
      lifecycle: 2,
      maker: signer.address,
      side,
      grossAmount: 10n ** 18n,
      endTime: 3700n
    },
    testPolicy,
    { timestamp: 100n, counter: 0n },
    123n
  );
  let wallet = { address: signer.address, chainId: 56 };
  let signs = 0;
  const submissions: SignedOrder[] = [];
  const entries = new Map<string, string>();
  const storage: OrderRecoveryStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    }
  };
  const published: MarketOrder = { ...intent.summary, status: "active" };
  const deps: PublicationDependencies = {
    wallet: {
      context: () => wallet,
      switchChain: async (chainId) => {
        wallet = { ...wallet, chainId };
      },
      sign: async (data) => {
        signs++;
        return signer.signTypedData(data);
      },
      verify: async (data, signature) =>
        verifyTypedData({ ...data, address: intent.order.offerer, signature })
    },
    api: {
      lookup: async () => null,
      prepare: async (input) =>
        parsePreparedOrder({
          schemaVersion: 1,
          source: "yunipals",
          id: "prepared-test",
          ...input,
          expiresAt: "160",
          orderHash: intent.orderHash
        }),
      submit: async (signed) => {
        submissions.push(signed);
        return parsePublishedOrder({
          schemaVersion: 1,
          persisted: true,
          order: published
        });
      }
    },
    save: (value, state) => saveRecoverableOrder(value, state, storage),
    revalidate: async () => {},
    onStage: () => {},
    now: () => 100n
  };
  return {
    intent,
    deps,
    storage,
    entries,
    published,
    submissions,
    signs: () => signs,
    setWallet: (address: typeof signer.address, chainId = 56) => {
      wallet = { address, chainId };
    }
  };
}

test("listing and offer publication keep reviewed totals and sign only the BNB domain", async () => {
  for (const side of ["listing", "offer"] as const) {
    const run = setup(side);
    const result = await publishOrder(run.intent, run.deps);
    assert.equal(result.orderHash, run.intent.orderHash);
    assert.equal(result.sellerProceeds, "975000000000000000");
    assert.equal(run.signs(), 1);
    assert.equal(run.submissions.length, 1);
    assert.equal(readRecoverableOrders(run.storage)[0].state, "accepted");
    const data = orderSigningData(run.intent);
    assert.deepEqual(data.domain, {
      name: "Seaport",
      version: "1.6",
      chainId: 56,
      verifyingContract: seaportDeployment.address
    });
    assert.equal(
      await verifyTypedData({
        ...data,
        domain: { ...data.domain, chainId: 1 },
        address: testSeller,
        signature: run.submissions[0].signature
      }),
      false
    );
  }
});

test("changed backend preparation, expiry, account or recovery storage prevents signing", async () => {
  for (const mode of [
    "price",
    "counter",
    "expiry",
    "account",
    "storage"
  ] as const) {
    const run = setup();
    const prepare = run.deps.api.prepare;
    run.deps.api.prepare = async (input) => {
      const result = await prepare(input);
      if (mode === "price") result.order.consideration[0].startAmount = "1";
      if (mode === "counter") result.order.counter = "1";
      if (mode === "expiry") result.expiresAt = "100";
      if (mode === "account") run.setWallet(testBuyer);
      return result;
    };
    if (mode === "storage")
      run.deps.save = () => {
        throw new Error("Storage quota exceeded");
      };
    await assert.rejects(publishOrder(run.intent, run.deps));
    assert.equal(run.signs(), 0, mode);
    assert.equal(run.submissions.length, 0, mode);
  }
});

test("ambiguous publication retains cancellation parameters and retries the same signature", async () => {
  const run = setup();
  const submit = run.deps.api.submit;
  run.deps.api.submit = async (signed) => {
    await submit(signed);
    throw new Error("Response lost after server commit");
  };
  let failure: SignedOrderPublicationError | undefined;
  try {
    await publishOrder(run.intent, run.deps);
  } catch (error) {
    assert.ok(error instanceof SignedOrderPublicationError);
    failure = error;
  }
  assert.ok(failure);
  const saved = readRecoverableOrders(run.storage)[0];
  assert.equal(saved.state, "publication-unknown");
  assert.equal(
    buildSeaportCancellation(
      "bnb",
      saved.order,
      saved.orderHash,
      signer.address
    ).kind,
    "cancel"
  );
  const json = [...run.entries.values()][0];
  assert.ok(!json.includes(failure.signed.signature));
  assert.ok(!json.includes('"signature":'));
  run.deps.api.submit = submit;
  await retryPublication(failure.signed, run.deps);
  assert.equal(run.signs(), 1);
  assert.equal(run.submissions.length, 2);
  assert.equal(run.submissions[0].signature, run.submissions[1].signature);
  assert.equal(
    run.submissions[0].intent.orderHash,
    run.submissions[1].intent.orderHash
  );
});

test("a changed wallet after signing preserves exposure without publishing under a new account", async () => {
  const run = setup();
  const sign = run.deps.wallet.sign;
  run.deps.wallet.sign = async (data) => {
    const signature = await sign(data);
    run.setWallet(testBuyer);
    return signature;
  };
  await assert.rejects(
    publishOrder(run.intent, run.deps),
    SignedOrderPublicationError
  );
  assert.equal(run.signs(), 1);
  assert.equal(run.submissions.length, 0);
  assert.equal(
    readRecoverableOrders(run.storage)[0].state,
    "publication-unknown"
  );
});

test("a lost acceptance can be resolved after a fill or expiry without another admission, signature or submission", async () => {
  const run = setup();
  run.deps.api.submit = async () => {
    throw new Error("Accepted response lost");
  };
  let failure: SignedOrderPublicationError | undefined;
  try {
    await publishOrder(run.intent, run.deps);
  } catch (error) {
    assert.ok(error instanceof SignedOrderPublicationError);
    failure = error;
  }
  assert.ok(failure);
  run.deps.now = () => 10_000n;
  run.deps.revalidate = async () => {
    throw new Error("NFT has already sold");
  };
  run.deps.wallet.verify = async () => {
    throw new Error(
      "No signature verification is needed for a public acceptance lookup"
    );
  };
  run.deps.api.lookup = async () => ({ ...run.published, status: "filled" });
  assert.equal(
    (await retryPublication(failure.signed, run.deps)).status,
    "filled"
  );
  assert.equal(run.signs(), 1);
  assert.equal(readRecoverableOrders(run.storage)[0].state, "accepted");
});

test("a signature rejection keeps recovery evidence and a late accepted response survives wallet changes", async () => {
  const rejected = setup();
  rejected.deps.wallet.sign = async () => {
    throw new Error("User rejected request");
  };
  await assert.rejects(
    publishOrder(rejected.intent, rejected.deps),
    /User rejected/
  );
  assert.equal(
    readRecoverableOrders(rejected.storage)[0].state,
    "signature-requested"
  );
  assert.equal(rejected.submissions.length, 0);
  const late = setup();
  const save = late.deps.save;
  late.deps.save = (intent, state) => {
    if (state === "accepted")
      throw new Error("Storage became unavailable after acceptance");
    save(intent, state);
  };
  const submit = late.deps.api.submit;
  late.deps.api.submit = async (signed) => {
    late.setWallet(testBuyer, 1);
    return submit(signed);
  };
  assert.equal(
    (await publishOrder(late.intent, late.deps)).orderHash,
    late.intent.orderHash
  );
});

test("false persistence or mismatched acknowledgements cannot report publication", async () => {
  assert.throws(
    () =>
      parsePublishedOrder({
        schemaVersion: 1,
        persisted: false,
        order: setup().published
      }),
    /durable/
  );
  const run = setup();
  run.deps.api.submit = async () => ({ ...run.published, grossAmount: "1" });
  await assert.rejects(
    publishOrder(run.intent, run.deps),
    SignedOrderPublicationError
  );
  assert.equal(
    readRecoverableOrders(run.storage)[0].state,
    "publication-unknown"
  );
});

test("closing preparation stops signing and closing an outstanding signing request retains cancellation evidence", async () => {
  for (const boundary of ["prepare", "sign"] as const) {
    const run = setup();
    const controller = new AbortController();
    run.deps.signal = controller.signal;
    if (boundary === "prepare") {
      const prepare = run.deps.api.prepare;
      run.deps.api.prepare = async (input) => {
        const value = await prepare(input);
        controller.abort();
        return value;
      };
    } else {
      const sign = run.deps.wallet.sign;
      run.deps.wallet.sign = async (data) => {
        const value = await sign(data);
        controller.abort();
        return value;
      };
    }
    await assert.rejects(publishOrder(run.intent, run.deps));
    assert.equal(run.signs(), boundary === "sign" ? 1 : 0);
    assert.equal(run.submissions.length, 0);
    if (boundary === "sign")
      assert.equal(
        readRecoverableOrders(run.storage)[0].state,
        "publication-unknown"
      );
  }
});

test("damaged recovery records are never silently replaced and old policy does not block cancellation evidence", () => {
  const run = setup();
  saveRecoverableOrder(run.intent, "signed", run.storage);
  const [key, original] = [...run.entries.entries()][0];
  const damaged = JSON.parse(original);
  damaged[0].asset.tokenId = "999";
  run.entries.set(key, JSON.stringify(damaged));
  assert.throws(
    () => saveRecoverableOrder(run.intent, "accepted", run.storage),
    /NFT/
  );
  assert.equal(run.entries.get(key), JSON.stringify(damaged));
  const record = JSON.parse(original)[0];
  assert.throws(
    () => decodeRecoverableOrders(JSON.stringify(Array(101).fill(record))),
    /Too many/
  );
  assert.equal(decodeRecoverableOrders(original)[0].order.endTime, 3700n);
  assert.equal(publicationRequest(run.intent).order.counter, "0");
});

test("maker verification uses exact BNB ECDSA or deployed ERC-1271 with Seaport as caller", async () => {
  const run = setup();
  const data = orderSigningData(run.intent);
  const signature = await signer.signTypedData(data);
  let code = "0x6000";
  let magic = "0x1626ba7e" as Hex;
  let contractCalls = 0;
  const abi = parseAbi([
    "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"
  ]);
  const client = createPublicClient({
    transport: custom({
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return "0x38";
        if (method === "eth_getCode") return code;
        if (method === "eth_call") {
          contractCalls++;
          const [call, block] = params as [
            { to: string; from: string; data: Hex },
            string
          ];
          assert.equal(
            getAddress(call.from),
            getAddress(seaportDeployment.address)
          );
          assert.equal(getAddress(call.to), signer.address);
          assert.equal(block, "0x64");
          const decoded = decodeFunctionData({ abi, data: call.data });
          assert.equal(decoded.args[0], hashTypedData(data));
          assert.equal(decoded.args[1], "0x1234");
          return encodeAbiParameters([{ type: "bytes4" }], [magic]);
        }
        throw new Error(`Unexpected test RPC method ${method}`);
      }
    })
  });
  assert.equal(
    await verifyBnbOrderMaker(client, run.intent, signature, 100n),
    true
  );
  assert.equal(contractCalls, 0);
  assert.equal(
    await verifyBnbOrderMaker(client, run.intent, "0x1234", 100n),
    true
  );
  magic = "0xffffffff";
  assert.equal(
    await verifyBnbOrderMaker(client, run.intent, "0x1234", 100n),
    false
  );
  code = "0x";
  assert.equal(
    await verifyBnbOrderMaker(client, run.intent, "0x1234", 100n),
    false
  );
  assert.equal(contractCalls, 2);
});
