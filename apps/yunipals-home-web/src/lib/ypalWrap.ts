import {
  erc20Abi,
  encodeFunctionData,
  getAddress,
  hashDomain,
  isAddress,
  keccak256,
  maxUint256,
  parseAbi,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient
} from "viem";

import { assertPermitReceiptIdentity } from "./boosterPermitSetup";

export const ypalWrapToken = "0xCd3709E84fc817b46196FA2D5b7202710AB51346";
export const ypalWrapPmon = "0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7";
export const ypalWrapManifestSha256 =
  "3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c";
export const ypalWrapRuntimeKeccak256 =
  "0x5c97ed71236ebd6588fb3fd42229ba6855105027611590f2d30da4c6ca40f858";
export type YpalWrapDeployment = {
  confirmed: boolean;
  manifestSha256: string;
  chainId: number;
  ypal: Address;
  pmon: Address;
};
export type YpalWrapKind = "approve" | "wrap";
export type YpalWrapPending = {
  hash: Hex;
  kind: YpalWrapKind;
  owner: Address;
  amountRaw: string;
  manifestSha256: string;
};
export type YpalWrapBalances = {
  pmonBalance: bigint;
  ypalBalance: bigint;
  allowance: bigint;
  blockNumber: bigint;
};
export const ypalWrapAbi = parseAbi([
  "function pmon() view returns(address)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function DOMAIN_SEPARATOR() view returns(bytes32)",
  "function wrap(uint256 amount) returns(uint256)",
  "event Wrap(address indexed user,uint256 amount)"
]);
const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
} as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function isConfirmedYpalWrapDeployment(
  value: YpalWrapDeployment | null | undefined
): value is YpalWrapDeployment {
  return Boolean(
    value?.confirmed === true &&
      value.manifestSha256 === ypalWrapManifestSha256 &&
      value.chainId === 8453 &&
      isAddress(value.ypal) &&
      isAddress(value.pmon) &&
      same(value.ypal, ypalWrapToken) &&
      same(value.pmon, ypalWrapPmon)
  );
}
export function assertYpalWrapDeployment(value: YpalWrapDeployment) {
  if (!isConfirmedYpalWrapDeployment(value))
    throw Error("The confirmed Base YPAL deployment is not configured.");
  return value;
}
export function parseYpalWrapAmount(value: string) {
  const text = value.trim();
  if (text.length > 100 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(text))
    throw Error("Enter a PMON amount with at most 18 decimal places.");
  const amount = parseUnits(text, 18);
  if (amount <= 0n || amount > maxUint256)
    throw Error("Enter a positive PMON amount within the token limit.");
  return amount;
}
export function ypalWrapTransaction(
  deployment: YpalWrapDeployment,
  kind: YpalWrapKind,
  amount: bigint
) {
  assertYpalWrapDeployment(deployment);
  if (amount <= 0n || amount > maxUint256)
    throw Error("Invalid wrapping amount.");
  if (kind === "approve")
    return {
      to: getAddress(deployment.pmon),
      value: 0n as const,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [getAddress(deployment.ypal), amount]
      })
    };
  if (kind !== "wrap") throw Error("Unsupported wrapping action.");
  return {
    to: getAddress(deployment.ypal),
    value: 0n as const,
    data: encodeFunctionData({
      abi: ypalWrapAbi,
      functionName: "wrap",
      args: [amount]
    })
  };
}
export async function readYpalWrapBalances(
  client: PublicClient,
  deployment: YpalWrapDeployment,
  owner: Address
): Promise<YpalWrapBalances> {
  assertYpalWrapDeployment(deployment);
  if ((await client.getChainId()) !== 8453)
    throw Error("The read connection is not Base mainnet.");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [
    code,
    pmon,
    name,
    symbol,
    decimals,
    domain,
    pmonDecimals,
    pmonBalance,
    ypalBalance,
    allowance
  ] = await Promise.all([
    client.getCode({ address: deployment.ypal, blockNumber }),
    client.readContract({
      address: deployment.ypal,
      abi: ypalWrapAbi,
      functionName: "pmon",
      blockNumber
    }),
    client.readContract({
      address: deployment.ypal,
      abi: ypalWrapAbi,
      functionName: "name",
      blockNumber
    }),
    client.readContract({
      address: deployment.ypal,
      abi: ypalWrapAbi,
      functionName: "symbol",
      blockNumber
    }),
    client.readContract({
      address: deployment.ypal,
      abi: ypalWrapAbi,
      functionName: "decimals",
      blockNumber
    }),
    client.readContract({
      address: deployment.ypal,
      abi: ypalWrapAbi,
      functionName: "DOMAIN_SEPARATOR",
      blockNumber
    }),
    client.readContract({
      address: deployment.pmon,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber
    }),
    client.readContract({
      address: deployment.pmon,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
      blockNumber
    }),
    client.readContract({
      address: deployment.ypal,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
      blockNumber
    }),
    client.readContract({
      address: deployment.pmon,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, deployment.ypal],
      blockNumber
    })
  ]);
  const expectedDomain = hashDomain({
    domain: {
      name: "Yunipals",
      version: "1",
      chainId: 8453n,
      verifyingContract: deployment.ypal
    },
    types: domainTypes
  });
  if (
    !code ||
    keccak256(code) !== ypalWrapRuntimeKeccak256 ||
    !same(pmon, deployment.pmon) ||
    name !== "Yunipals" ||
    symbol !== "YPAL" ||
    decimals !== 18 ||
    pmonDecimals !== 18 ||
    domain !== expectedDomain
  )
    throw Error(
      "The deployed YPAL backing, code or permit domain does not match the confirmed launch."
    );
  return { blockNumber, pmonBalance, ypalBalance, allowance };
}
export function parseYpalWrapPending(
  value: unknown,
  owner: Address
): YpalWrapPending | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.hash !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(record.hash) ||
    (record.kind !== "approve" && record.kind !== "wrap") ||
    typeof record.owner !== "string" ||
    !isAddress(record.owner) ||
    !same(record.owner, owner) ||
    record.manifestSha256 !== ypalWrapManifestSha256 ||
    typeof record.amountRaw !== "string" ||
    !/^[1-9][0-9]{0,77}$/.test(record.amountRaw) ||
    BigInt(record.amountRaw) > maxUint256
  )
    return null;
  return {
    hash: record.hash as Hex,
    kind: record.kind,
    owner: getAddress(record.owner),
    amountRaw: record.amountRaw,
    manifestSha256: record.manifestSha256
  };
}
function resultMissing(error: unknown, name: string): boolean {
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    if ("name" in current && current.name === name) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
export async function resolveYpalWrapReceipt(
  client: PublicClient,
  deployment: YpalWrapDeployment,
  pending: YpalWrapPending
) {
  assertYpalWrapDeployment(deployment);
  if (
    !parseYpalWrapPending(pending, pending.owner) ||
    (await client.getChainId()) !== 8453
  )
    throw Error(
      "The pending wrapping transaction is not bound to this Base deployment."
    );
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: pending.hash });
  } catch (error) {
    if (resultMissing(error, "TransactionReceiptNotFoundError"))
      return { status: "pending" as const };
    throw error;
  }
  let transaction;
  try {
    transaction = await client.getTransaction({ hash: pending.hash });
  } catch (error) {
    if (resultMissing(error, "TransactionNotFoundError"))
      return { status: "pending" as const, reason: "confirming" as const };
    throw error;
  }
  if (
    receipt.transactionHash?.toLowerCase() !== pending.hash.toLowerCase() ||
    transaction.hash?.toLowerCase() !== pending.hash.toLowerCase()
  )
    assertPermitReceiptIdentity(receipt, transaction, pending.hash);
  // A receipt can become available before another RPC read has its mined
  // transaction context. Keep the saved hash until all reads agree.
  if (
    !receipt.blockHash ||
    transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    transaction.blockNumber !== receipt.blockNumber
  )
    return { status: "pending" as const, reason: "confirming" as const };
  assertPermitReceiptIdentity(receipt, transaction, pending.hash);
  if (transaction.chainId !== 8453 || !same(transaction.from, pending.owner))
    throw Error(
      "The wrapping transaction was sent by another wallet or on another network."
    );
  let header;
  try {
    header = await client.getBlock({ blockNumber: receipt.blockNumber });
  } catch (error) {
    if (resultMissing(error, "BlockNotFoundError"))
      return { status: "pending" as const, reason: "confirming" as const };
    throw error;
  }
  if (header.hash?.toLowerCase() !== receipt.blockHash.toLowerCase())
    return { status: "pending" as const, reason: "confirming" as const };
  const action = ypalWrapTransaction(
    deployment,
    pending.kind,
    BigInt(pending.amountRaw)
  );
  const cancelled =
    transaction.to !== null &&
    same(transaction.to, pending.owner) &&
    transaction.value === 0n &&
    transaction.input === "0x";
  const exact =
    transaction.to !== null &&
    same(transaction.to, action.to) &&
    transaction.value === 0n &&
    same(transaction.input, action.data);
  if (!exact && !cancelled)
    throw Error(
      "The confirmed transaction differs from the exact reviewed wrapping action."
    );
  if (cancelled || receipt.status === "reverted")
    return { status: "failed" as const, cancelled };
  if (receipt.status !== "success")
    throw Error("The wrapping transaction is not confirmed successful.");
  const amount = BigInt(pending.amountRaw);
  if (pending.kind === "approve") {
    const approvals = parseEventLogs({
      abi: erc20Abi,
      eventName: "Approval",
      logs: receipt.logs,
      strict: true
    }).filter(
      (row) =>
        same(row.address, deployment.pmon) &&
        same(row.args.owner, pending.owner) &&
        same(row.args.spender, deployment.ypal) &&
        row.args.value === amount
    );
    if (approvals.length !== 1)
      throw Error("The receipt does not prove the exact PMON approval.");
  } else {
    const wrapped = parseEventLogs({
      abi: ypalWrapAbi,
      eventName: "Wrap",
      logs: receipt.logs,
      strict: true
    }).filter(
      (row) =>
        same(row.address, deployment.ypal) &&
        same(row.args.user, pending.owner) &&
        row.args.amount === amount
    );
    const transfers = parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs,
      strict: true
    });
    const minted = transfers.filter(
      (row) =>
        same(row.address, deployment.ypal) &&
        /^0x0{40}$/i.test(row.args.from) &&
        same(row.args.to, pending.owner) &&
        row.args.value === amount
    );
    const backing = transfers.filter(
      (row) =>
        same(row.address, deployment.pmon) &&
        same(row.args.from, pending.owner) &&
        same(row.args.to, deployment.ypal) &&
        row.args.value === amount
    );
    if (wrapped.length !== 1 || minted.length !== 1 || backing.length !== 1)
      throw Error(
        "The receipt does not prove one-to-one PMON backing and YPAL minting."
      );
  }
  return {
    status: "success" as const,
    kind: pending.kind,
    amount,
    transactionHash: receipt.transactionHash
  };
}
