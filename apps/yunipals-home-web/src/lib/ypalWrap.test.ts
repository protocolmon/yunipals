import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  formatUnits,
  hashDomain,
  maxUint256,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient
} from "viem";

import {
  ypalRuntime,
  validateYpalLaunchPackage
} from "./boosterYpalDeployment";
import {
  isConfirmedYpalWrapDeployment,
  parseYpalWrapAmount,
  parseYpalWrapPending,
  readYpalWrapBalances,
  resolveYpalWrapReceipt,
  ypalWrapAbi,
  ypalWrapManifestSha256,
  ypalWrapPmon,
  ypalWrapToken,
  ypalWrapTransaction,
  type YpalWrapDeployment,
  type YpalWrapKind,
  type YpalWrapPending
} from "./ypalWrap";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const zero = "0x0000000000000000000000000000000000000000" as Address;
const hash = `0x${"ab".repeat(32)}` as Hex,
  blockHash = `0x${"cd".repeat(32)}` as Hex;
export const wrapFixtureDeployment: YpalWrapDeployment = {
  confirmed: true,
  manifestSha256: ypalWrapManifestSha256,
  chainId: 8453,
  ypal: ypalWrapToken,
  pmon: ypalWrapPmon
};
const bundle = validateYpalLaunchPackage(
  JSON.parse(
    readFileSync(
      new URL(
        "../../public/boosters/ypal-fresh-launch-v1.json",
        import.meta.url
      ),
      "utf8"
    )
  )
);
const code = ypalRuntime(bundle.artifacts.ypal, ypalWrapToken, ypalWrapPmon);
const types = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
} as const;
function fixture(kind: YpalWrapKind = "wrap") {
  const amount = 1234567890123456789n,
    action = ypalWrapTransaction(wrapFixtureDeployment, kind, amount);
  const options = {
    chain: 8453,
    code,
    pmon: ypalWrapPmon as Address,
    name: "Yunipals",
    symbol: "YPAL",
    decimals: 18,
    domain: hashDomain({
      domain: {
        name: "Yunipals",
        version: "1",
        chainId: 8453n,
        verifyingContract: ypalWrapToken
      },
      types
    }),
    pending: false,
    canonical: true,
    pmonBalance: 10n ** 20n,
    ypalBalance: 0n,
    allowance: 0n
  };
  const calls: {
    address: Address;
    functionName: string;
    args?: readonly unknown[];
    blockNumber: bigint;
  }[] = [];
  const log = (
    address: Address,
    topics: ReturnType<typeof encodeEventTopics>,
    amount: bigint
  ) => ({
    address,
    topics: topics as Hex[],
    data: encodeAbiParameters(parseAbiParameters("uint256"), [amount]),
    blockHash,
    blockNumber: 100n,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false
  });
  const logs =
    kind === "approve"
      ? [
          log(
            ypalWrapPmon,
            encodeEventTopics({
              abi: erc20Abi,
              eventName: "Approval",
              args: { owner, spender: ypalWrapToken }
            }),
            amount
          )
        ]
      : [
          log(
            ypalWrapToken,
            encodeEventTopics({
              abi: ypalWrapAbi,
              eventName: "Wrap",
              args: { user: owner }
            }),
            amount
          ),
          log(
            ypalWrapToken,
            encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: zero, to: owner }
            }),
            amount
          ),
          log(
            ypalWrapPmon,
            encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: owner, to: ypalWrapToken }
            }),
            amount
          )
        ];
  const receipt = {
    transactionHash: hash,
    blockHash,
    blockNumber: 100n,
    status: "success",
    logs
  };
  const transaction = {
    hash,
    blockHash,
    blockNumber: 100n,
    chainId: 8453,
    from: owner,
    to: action.to,
    input: action.data,
    value: 0n
  };
  const client = {
    async getChainId() {
      return options.chain;
    },
    async getBlockNumber() {
      return 200n;
    },
    async getCode() {
      return options.code;
    },
    async getBlock() {
      return { hash: options.canonical ? blockHash : hash };
    },
    async readContract(input: (typeof calls)[number]) {
      calls.push(input);
      assert.equal(input.blockNumber, 200n);
      switch (input.functionName) {
        case "pmon":
          return options.pmon;
        case "name":
          return options.name;
        case "symbol":
          return options.symbol;
        case "decimals":
          return options.decimals;
        case "DOMAIN_SEPARATOR":
          return options.domain;
        case "balanceOf":
          return input.address.toLowerCase() === ypalWrapPmon.toLowerCase()
            ? options.pmonBalance
            : options.ypalBalance;
        case "allowance":
          return options.allowance;
        default:
          throw Error("Unexpected fixture read");
      }
    },
    async getTransactionReceipt() {
      if (options.pending) {
        const e = Error("pending");
        e.name = "TransactionReceiptNotFoundError";
        throw e;
      }
      return receipt;
    },
    async getTransaction() {
      return transaction;
    }
  } as unknown as PublicClient;
  const record: YpalWrapPending = {
    hash,
    kind,
    owner,
    amountRaw: amount.toString(),
    manifestSha256: ypalWrapManifestSha256
  };
  return { client, options, calls, receipt, transaction, record, amount };
}
test("unconfirmed, wrong manifest and foreign token configurations never enable wrapping", () => {
  assert(isConfirmedYpalWrapDeployment(wrapFixtureDeployment));
  assert(!isConfirmedYpalWrapDeployment(null));
  for (const change of [
    { confirmed: false },
    { manifestSha256: "f".repeat(64) },
    { chainId: 1 },
    { ypal: other },
    { pmon: other }
  ])
    assert(
      !isConfirmedYpalWrapDeployment({ ...wrapFixtureDeployment, ...change })
    );
});
test("decimal18 parsing is exact and refuses rounding, exponent, negative, zero and overflow", () => {
  assert.equal(
    parseYpalWrapAmount("1.234567890123456789"),
    1234567890123456789n
  );
  assert.equal(parseYpalWrapAmount("0.000000000000000001"), 1n);
  assert.equal(parseYpalWrapAmount(formatUnits(maxUint256, 18)), maxUint256);
  for (const value of [
    "0",
    "-1",
    "1e3",
    ".5",
    "1.",
    "1.0000000000000000001",
    maxUint256.toString(),
    "NaN"
  ])
    assert.throws(() => parseYpalWrapAmount(value));
});
test("approval is the exact requested amount to YPAL, and wrap sends no native ETH", () => {
  const amount = 1234567890123456789n,
    approve = ypalWrapTransaction(wrapFixtureDeployment, "approve", amount),
    wrap = ypalWrapTransaction(wrapFixtureDeployment, "wrap", amount);
  assert.equal(approve.to.toLowerCase(), ypalWrapPmon.toLowerCase());
  assert.equal(approve.value, 0n);
  const decoded = decodeFunctionData({ abi: erc20Abi, data: approve.data });
  assert.equal(decoded.functionName, "approve");
  assert.equal(
    decoded.args[0]!.toString().toLowerCase(),
    ypalWrapToken.toLowerCase()
  );
  assert.equal(decoded.args[1], amount);
  assert.equal(wrap.to.toLowerCase(), ypalWrapToken.toLowerCase());
  assert.equal(wrap.value, 0n);
  assert.equal(
    decodeFunctionData({ abi: ypalWrapAbi, data: wrap.data }).args[0],
    amount
  );
  assert.equal("nonce" in wrap, false);
  assert.throws(() => ypalWrapTransaction(wrapFixtureDeployment, "wrap", 0n));
});
test("one explicit Base block supplies both actual balances and owner-to-YPAL allowance", async () => {
  const f = fixture(),
    state = await readYpalWrapBalances(f.client, wrapFixtureDeployment, owner);
  assert.equal(state.pmonBalance, 10n ** 20n);
  assert.equal(state.ypalBalance, 0n);
  assert.equal(state.allowance, 0n);
  const allowance = f.calls.find((r) => r.functionName === "allowance")!;
  assert.deepEqual(allowance.args, [owner, ypalWrapToken]);
  assert.equal(allowance.address, ypalWrapPmon);
});
test("wrong code, backing, chain, name, symbol, decimals or permit domain fail closed", async () => {
  for (const change of [
    { chain: 1 },
    { code: "0x6000" as Hex },
    { pmon: other },
    { name: "PROTO" },
    { symbol: "PROTO" },
    { decimals: 6 },
    { domain: hash }
  ]) {
    const f = fixture();
    Object.assign(f.options, change);
    await assert.rejects(
      readYpalWrapBalances(f.client, wrapFixtureDeployment, owner)
    );
  }
});
test("saved pending scope binds wallet, exact base units and confirmed deployment", () => {
  const f = fixture();
  assert(parseYpalWrapPending(f.record, owner));
  assert.equal(parseYpalWrapPending(f.record, other), null);
  for (const change of [
    { hash: "0x1234" },
    { amountRaw: "0" },
    { amountRaw: "1.2" },
    { kind: "claim" },
    { manifestSha256: "f".repeat(64) }
  ])
    assert.equal(parseYpalWrapPending({ ...f.record, ...change }, owner), null);
});
test("pending receipts remain pending and neither imply approval nor minting", async () => {
  const f = fixture();
  f.options.pending = true;
  assert.deepEqual(
    await resolveYpalWrapReceipt(f.client, wrapFixtureDeployment, f.record),
    { status: "pending" }
  );
});
test("approval and one-to-one wrap require their actual contract-scoped events", async () => {
  for (const kind of ["approve", "wrap"] as const) {
    const f = fixture(kind),
      r = await resolveYpalWrapReceipt(
        f.client,
        wrapFixtureDeployment,
        f.record
      );
    assert.equal(r.status, "success");
  }
  const f = fixture();
  f.receipt.logs.pop();
  await assert.rejects(
    resolveYpalWrapReceipt(f.client, wrapFixtureDeployment, f.record),
    /one-to-one/
  );
  const a = fixture("approve");
  a.receipt.logs = [];
  await assert.rejects(
    resolveYpalWrapReceipt(a.client, wrapFixtureDeployment, a.record),
    /exact PMON approval/
  );
});
test("wrong amount, recipient or duplicate wrapping events cannot prove success", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.receipt.logs.push(f.receipt.logs[0]),
    (f: ReturnType<typeof fixture>) => (f.receipt.logs[0].address = other),
    (f: ReturnType<typeof fixture>) =>
      (f.receipt.logs[1].data = encodeAbiParameters(
        parseAbiParameters("uint256"),
        [f.amount + 1n]
      ))
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(
      resolveYpalWrapReceipt(f.client, wrapFixtureDeployment, f.record)
    );
  }
});
test("receipt sender, chain, canonical header, destination and exact calldata are checked", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => (f.transaction.from = other),
    (f: ReturnType<typeof fixture>) => (f.transaction.chainId = 1),
    (f: ReturnType<typeof fixture>) => (f.options.canonical = false),
    (f: ReturnType<typeof fixture>) => (f.transaction.to = other),
    (f: ReturnType<typeof fixture>) => (f.transaction.input = "0x1234" as Hex),
    (f: ReturnType<typeof fixture>) => (f.transaction.blockHash = hash)
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(
      resolveYpalWrapReceipt(f.client, wrapFixtureDeployment, f.record)
    );
  }
});
test("only proven reverts or canonical owner self-cancels clear a failed action", async () => {
  const f = fixture();
  f.receipt.status = "reverted";
  assert.equal(
    (await resolveYpalWrapReceipt(f.client, wrapFixtureDeployment, f.record))
      .status,
    "failed"
  );
  const c = fixture();
  Object.assign(c.transaction, { to: owner, input: "0x", value: 0n });
  assert.deepEqual(
    await resolveYpalWrapReceipt(c.client, wrapFixtureDeployment, c.record),
    { status: "failed", cancelled: true }
  );
});
