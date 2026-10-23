import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  hashDomain,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  boosterPermitAbi,
  boosterPermitPurchaseData,
  boosterPermitTypedData,
  boosterTokenPermitAbi,
  engineSupportsBoosterPermit,
  readBoosterPermit,
  validateBoosterPermitFreshness,
  type BoosterPermit
} from "./boosterPermit";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const engine = "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609";
const token = "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3";
const domain = {
  name: "Proto",
  version: "1",
  chainId: 8453,
  verifyingContract: token
} as const;
const types = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
} as const;
const input = {
  owner: signer.address,
  spender: engine,
  token,
  value: 3n * 10n ** 18n,
  deadline: 1000n
} as const;

function fixture(
  options: {
    implementation?: Hex;
    version?: bigint;
    separator?: Hex;
    fail?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const client = createPublicClient({
    chain: base,
    transport: custom(
      {
        async request({ method, params }) {
          if (options.fail) throw new Error("RPC unavailable");
          if (method === "eth_getStorageAt")
            return options.implementation ?? `0x${"ab".repeat(32)}`;
          assert.equal(method, "eth_call");
          for (const abi of [
            boosterPermitAbi,
            boosterTokenPermitAbi,
            erc20Abi
          ]) {
            let decoded;
            try {
              decoded = decodeFunctionData({ abi, data: params[0].data });
            } catch {
              continue;
            }
            calls.push(decoded.functionName);
            const result =
              decoded.functionName === "PERMIT_OPEN_VERSION"
                ? (options.version ?? 1n)
                : decoded.functionName === "name"
                  ? domain.name
                  : decoded.functionName === "DOMAIN_SEPARATOR"
                    ? (options.separator ??
                      hashDomain({
                        domain: { ...domain, chainId: BigInt(domain.chainId) },
                        types
                      }))
                    : decoded.functionName === "nonces"
                      ? 4n
                      : undefined;
            assert.notEqual(result, undefined);
            return encodeFunctionResult({
              abi,
              functionName: decoded.functionName,
              result
            } as never);
          }
          throw new Error("Unexpected synthetic RPC");
        }
      },
      { retryCount: 0 }
    )
  });
  return { client, calls };
}

test("known deployed engines without permit never probe an absent getter", async () => {
  for (const address of [
    "92e2351a83b6c445c94d0b887259d2b940c82a5a",
    "eba9d4deb6914ab67a820ea27c2fc3f43812e471"
  ]) {
    const { client, calls } = fixture({
      implementation: `0x${"0".repeat(24)}${address}`
    });
    assert.equal(await engineSupportsBoosterPermit(client, engine), false);
    assert.deepEqual(calls, []);
  }
});

test("only the explicit version-one getter advertises the permit path", async () => {
  assert.equal(
    await engineSupportsBoosterPermit(fixture().client, engine),
    true
  );
  assert.equal(
    await engineSupportsBoosterPermit(fixture({ version: 2n }).client, engine),
    false
  );
  assert.equal(
    await engineSupportsBoosterPermit(fixture({ version: 0n }).client, engine),
    false
  );
  await assert.rejects(
    engineSupportsBoosterPermit(fixture({ fail: true }).client, engine)
  );
});

test("actual ABI reads produce the exact Base token domain, current nonce and exact-price permission", async () => {
  const { client } = fixture();
  const permit = await readBoosterPermit(client, input);
  assert(permit);
  assert.deepEqual(permit.domain, domain);
  assert.equal(permit.nonce, 4n);
  assert.deepEqual(boosterPermitTypedData(permit).message, {
    owner: signer.address,
    spender: engine,
    value: input.value,
    nonce: 4n,
    deadline: 1000n
  });
});

test("wrong chain, token, name or domain version cannot produce a permit review", async () => {
  for (const change of [
    { chainId: 1 },
    { version: "2" },
    { name: "Other" },
    { verifyingContract: engine }
  ] as const) {
    const changed = { ...domain, ...change };
    const separator = hashDomain({
      domain: { ...changed, chainId: BigInt(changed.chainId) },
      types
    });
    assert.equal(
      await readBoosterPermit(fixture({ separator }).client, input),
      null
    );
  }
  assert.equal(
    await readBoosterPermit(fixture({ fail: true }).client, input),
    null
  );
});

test("a real typed-data signature creates the approved method with unchanged deadline and quantity", async () => {
  const permit = (await readBoosterPermit(fixture().client, input))!;
  const signature = await signer.signTypedData(boosterPermitTypedData(permit));
  for (const count of [1, 3, 10]) {
    const decoded = decodeFunctionData({
      abi: boosterPermitAbi,
      data: await boosterPermitPurchaseData(permit, signature, 2n, count, 3301n)
    });
    assert.equal(decoded.functionName, "openPacksWithPermit");
    assert.deepEqual(decoded.args.slice(0, 4), [
      2n,
      count,
      3301n,
      input.deadline
    ]);
    assert([27, 28].includes(decoded.args[4]));
  }
  await assert.rejects(
    boosterPermitPurchaseData(permit, signature, 2n, 11, 3301n)
  );
});

test("wrong-wallet, wrong-domain and malformed signatures never create sendable calldata", async () => {
  const permit = (await readBoosterPermit(fixture().client, input))!;
  for (const signature of [
    await other.signTypedData(boosterPermitTypedData(permit)),
    await signer.signTypedData({
      ...boosterPermitTypedData(permit),
      domain: { ...permit.domain, chainId: 1 }
    }),
    `0x${"0".repeat(128)}` as Hex
  ])
    await assert.rejects(
      boosterPermitPurchaseData(permit, signature, 2n, 3, 3301n)
    );
});

test("expired or replayed permissions refuse, while an already-consumed exact-price allowance remains safe", async () => {
  const permit = (await readBoosterPermit(fixture().client, input))!;
  validateBoosterPermitFreshness(permit, permit, 999n, 0n);
  assert.throws(() =>
    validateBoosterPermitFreshness(permit, permit, 1000n, input.value)
  );
  assert.throws(() =>
    validateBoosterPermitFreshness(
      permit,
      { ...permit, nonce: 5n },
      999n,
      input.value - 1n
    )
  );
  validateBoosterPermitFreshness(
    permit,
    { ...permit, nonce: 5n },
    999n,
    input.value
  );
  const invalid: (BoosterPermit | null)[] = [
    null,
    { ...permit, value: 1n },
    { ...permit, deadline: 2000n },
    { ...permit, spender: token },
    { ...permit, token: engine }
  ];
  for (const fresh of invalid)
    assert.throws(() =>
      validateBoosterPermitFreshness(permit, fresh, 999n, input.value)
    );
});
