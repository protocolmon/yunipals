import assert from "node:assert/strict";
import test from "node:test";

import {
  executeMarketTransaction,
  SubmittedTransactionError,
  type MarketExecutionStage,
  type MarketWallet,
  type WalletContext
} from "./executeTransaction";
import {
  marketFixture,
  receiptFixture,
  testBuyer,
  testFeeRecipient,
  testHash,
  testPolicy
} from "./marketplace.testFixtures";
import { buildBnbFulfillment } from "./transactionIntent";

function setup() {
  const { summary, quote } = marketFixture();
  const intent = buildBnbFulfillment(
    quote,
    summary,
    testBuyer,
    testPolicy,
    100n
  );
  let context: WalletContext = { address: testBuyer, chainId: 56 };
  let sends = 0;
  const stages: MarketExecutionStage[] = [];
  const wallet: MarketWallet = {
    context: () => context,
    switchChain: async (chainId) => {
      context = { ...context, chainId };
    },
    simulate: async () => {},
    send: async () => {
      sends++;
      return testHash;
    },
    wait: async () => receiptFixture()
  };
  const options = {
    now: () => 100n,
    onStage: (stage: MarketExecutionStage) => stages.push(stage),
    onSubmitted: () => {}
  };
  return {
    intent,
    wallet,
    options,
    stages,
    sends: () => sends,
    setContext: (next: WalletContext) => {
      context = next;
    }
  };
}

test("account changes after a chain switch or simulation stop the wallet send", async () => {
  for (const boundary of ["switch", "simulate"] as const) {
    const run = setup();
    if (boundary === "switch") {
      run.setContext({ address: testBuyer, chainId: 1 });
      run.wallet.switchChain = async () =>
        run.setContext({ address: testFeeRecipient, chainId: 56 });
    } else
      run.wallet.simulate = async () =>
        run.setContext({ address: testFeeRecipient, chainId: 56 });
    await assert.rejects(
      executeMarketTransaction(run.intent, run.wallet, run.options),
      /account changed/
    );
    assert.equal(run.sends(), 0);
  }
});

test("expired quotes and failed fresh checks never reach the wallet", async () => {
  const run = setup();
  await assert.rejects(
    executeMarketTransaction(run.intent, run.wallet, {
      ...run.options,
      now: () => 160n
    }),
    /expired/
  );
  await assert.rejects(
    executeMarketTransaction(run.intent, run.wallet, {
      ...run.options,
      revalidate: async () => {
        throw new Error("Ownership changed");
      }
    }),
    /Ownership changed/
  );
  assert.equal(run.sends(), 0);
});

test("receipt tracking continues for the original buyer after a wallet change", async () => {
  const run = setup();
  const send = run.wallet.send;
  run.wallet.send = async (call) => {
    const hash = await send(call);
    run.setContext({ address: testFeeRecipient, chainId: 1 });
    return hash;
  };
  const receipt = await executeMarketTransaction(
    run.intent,
    run.wallet,
    run.options
  );
  assert.equal(receipt.transactionHash, testHash);
  assert.equal(run.sends(), 1);
  assert.deepEqual(run.stages, [
    "simulating",
    "wallet",
    "pending",
    "confirmed"
  ]);
});

test("closing review before submission aborts the send, while submitted transactions remain tracked", async () => {
  const before = setup();
  const beforeController = new AbortController();
  before.wallet.simulate = async () => {
    beforeController.abort();
  };
  await assert.rejects(
    executeMarketTransaction(before.intent, before.wallet, {
      ...before.options,
      signal: beforeController.signal
    })
  );
  assert.equal(before.sends(), 0);
  const after = setup();
  const afterController = new AbortController();
  const send = after.wallet.send;
  after.wallet.send = async (call) => {
    const hash = await send(call);
    afterController.abort();
    return hash;
  };
  await executeMarketTransaction(after.intent, after.wallet, {
    ...after.options,
    signal: afterController.signal
  });
  assert.equal(after.sends(), 1);
  assert.equal(after.stages.at(-1), "confirmed");
});

test("replacement cancellation and confirmation timeout preserve the submitted hash", async () => {
  const replacement = `0x${"b".repeat(64)}` as const;
  for (const mode of ["cancelled", "timeout"] as const) {
    const run = setup();
    run.wallet.wait = async (_, __, onReplaced) => {
      onReplaced(replacement);
      if (mode === "timeout") throw new Error("RPC timeout");
      return { ...receiptFixture(), transactionHash: replacement, logs: [] };
    };
    await assert.rejects(
      executeMarketTransaction(run.intent, run.wallet, run.options),
      (error) =>
        error instanceof SubmittedTransactionError &&
        error.transactionHash === replacement
    );
    assert.equal(run.sends(), 1);
    assert.ok(!run.stages.includes("confirmed"));
  }
});
