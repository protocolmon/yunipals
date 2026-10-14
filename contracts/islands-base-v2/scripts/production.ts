import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import dotenv from "dotenv";
import {
  Contract,
  ContractFactory,
  Interface,
  JsonRpcProvider,
  Transaction,
  Wallet,
  ZeroAddress,
  getCreateAddress,
  keccak256,
  parseEther,
  type Log,
  type TransactionReceipt
} from "ethers";
import { loadDistribution, metadataBaseUri, sha256 } from "./plan";

dotenv.config({
  path:
    process.env.AIRDROP_CREDENTIAL_ENV_FILE ??
    "/root/islands-airdrop/.env.local",
  quiet: true
});
const plan = loadDistribution();
const artifactPath =
  "artifacts/contracts/GrasslandArchipelagoBaseV2.sol/GrasslandArchipelagoBaseV2.json";
const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
  abi: ConstructorParameters<typeof Interface>[0];
  bytecode: string;
  deployedBytecode: string;
};
const iface = new Interface(artifact.abi);
const readProvider = new JsonRpcProvider(
  process.env.BASE_REPLACEMENT_READ_RPC_URL ?? "http://127.0.0.1:19212",
  8453,
  { staticNetwork: true, batchMaxCount: 1, cacheTimeout: 0 }
);
// The budget gateway deliberately forbids transaction broadcasts. This public
// endpoint handles gas estimation and signed broadcasts; bulk reads use the gateway.
const broadcastProvider = new JsonRpcProvider("https://base.drpc.org", 8453, {
  staticNetwork: true,
  batchMaxCount: 1,
  cacheTimeout: 0
});
let signer: Wallet;
try {
  assert(
    process.env.PRIVATE_KEY &&
      /^0x[0-9a-fA-F]{64}$/.test(process.env.PRIVATE_KEY)
  );
  signer = new Wallet(process.env.PRIVATE_KEY);
} catch {
  throw new Error(
    "Deployment signer configuration is invalid; secret value suppressed"
  );
}
const args = [
  signer.address,
  plan.root,
  plan.source.blockNumber,
  plan.source.blockHash,
  `0x${plan.snapshotSha256}`
];
const factory = new ContractFactory(artifact.abi, artifact.bytecode);
const root = "deployments/replacement-v2";
mkdirSync(root, { recursive: true });
const json = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;
const save = (path: string, value: unknown, exclusive = false) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: exclusive ? "wx" : "w"
  });
interface Preflight {
  chainId: number;
  signer: string;
  nonce: number;
  contract: string;
  constructorArguments: unknown[];
  bytecodeSha256: string;
  snapshotSha256: string;
  distributionRoot: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedTotalGas: string;
  upperGasCostWei: string;
  l1FeeReserveWei: string;
  totalFeeLimitWei: string;
}
const readPreflight = () => {
  const value = json<Preflight>(`${root}/preflight.json`);
  assert.equal(value.chainId, 8453);
  assert.equal(value.signer, signer.address.toLowerCase());
  assert.equal(
    value.contract,
    getCreateAddress({ from: signer.address, nonce: value.nonce }).toLowerCase()
  );
  assert.deepEqual(value.constructorArguments, args);
  assert.equal(value.bytecodeSha256, sha256(artifact.bytecode));
  assert.equal(value.snapshotSha256, plan.snapshotSha256);
  assert.equal(value.distributionRoot, plan.root);
  return value;
};
async function checkChain() {
  for (const provider of [readProvider, broadcastProvider])
    assert.equal(await provider.send("eth_chainId", []), "0x2105");
}
async function preflight() {
  await checkChain();
  const rehearsal = json<{
    totalGas: string;
    tokensVerified: number;
    uniqueMetadataUris: number;
    snapshotSha256: string;
    distributionRoot: string;
  }>("artifacts/rehearsal.json");
  assert.equal(rehearsal.tokensVerified, 898);
  assert.equal(rehearsal.uniqueMetadataUris, 898);
  assert.equal(rehearsal.snapshotSha256, plan.snapshotSha256);
  assert.equal(rehearsal.distributionRoot, plan.root);
  if (existsSync(`${root}/preflight.json`)) {
    console.log(JSON.stringify(readPreflight(), null, 2));
    return;
  }
  const nonce = await readProvider.getTransactionCount(
    signer.address,
    "pending"
  );
  assert.equal(
    nonce,
    await readProvider.getTransactionCount(signer.address, "latest"),
    "Signer has pending transactions"
  );
  const fees = await broadcastProvider.getFeeData();
  assert(fees.maxFeePerGas !== null && fees.maxPriorityFeePerGas !== null);
  // ethers already budgets two times the current base fee plus the priority fee.
  const maxFee =
    fees.maxFeePerGas > 5_000_000n ? fees.maxFeePerGas : 5_000_000n;
  const gas = (BigInt(rehearsal.totalGas) * 125n) / 100n;
  const reserve = parseEther("0.0001");
  const feeLimit = parseEther("0.002");
  const upperCost = gas * maxFee;
  assert(
    upperCost + reserve < feeLimit,
    "Estimated fee exceeds the release's 0.002 ETH ceiling"
  );
  const balance = await readProvider.getBalance(signer.address);
  const value: Preflight = {
    chainId: 8453,
    signer: signer.address.toLowerCase(),
    nonce,
    contract: getCreateAddress({ from: signer.address, nonce }).toLowerCase(),
    constructorArguments: args,
    bytecodeSha256: sha256(artifact.bytecode),
    snapshotSha256: plan.snapshotSha256,
    distributionRoot: plan.root,
    maxFeePerGas: String(maxFee),
    maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
    estimatedTotalGas: String(gas),
    upperGasCostWei: String(upperCost),
    l1FeeReserveWei: String(reserve),
    totalFeeLimitWei: String(feeLimit)
  };
  save(`${root}/preflight.json`, value, true);
  console.log(
    JSON.stringify(
      {
        ...value,
        availableBalanceWei: String(balance),
        fundingShortfallWei: String(
          upperCost + reserve > balance ? upperCost + reserve - balance : 0n
        ),
        transactionsSent: 0
      },
      null,
      2
    )
  );
}

async function receipt(hash: string): Promise<TransactionReceipt | null> {
  let found: TransactionReceipt | null;
  try {
    found = await readProvider.getTransactionReceipt(hash);
  } catch {
    // Free gateway upstreams occasionally reject receipt lookups. Check the
    // same public hash on the broadcast provider; this makes no paid API call.
    found = await broadcastProvider.getTransactionReceipt(hash);
  }
  if (found) assert.equal(found.status, 1, `Transaction reverted: ${hash}`);
  return found;
}
async function send(
  label: string,
  nonce: number,
  to: string | null,
  data: string
): Promise<TransactionReceipt> {
  assert.equal(
    process.env.EXECUTE,
    "true",
    "Set EXECUTE=true only for the authorized release"
  );
  const pre = readPreflight();
  mkdirSync("private-transactions", { recursive: true, mode: 0o700 });
  const path = `private-transactions/${label}.json`;
  let signed: { raw: string; hash: string };
  if (existsSync(path)) {
    signed = json(path);
    const tx = Transaction.from(signed.raw);
    assert.equal(tx.chainId, 8453n);
    assert.equal(tx.nonce, nonce);
    assert.equal(tx.from?.toLowerCase(), pre.signer);
    assert.equal(tx.to?.toLowerCase() ?? null, to);
    assert.equal(tx.data, data);
    assert.equal(tx.value, 0n);
    assert.equal(keccak256(signed.raw), signed.hash);
  } else {
    assert.equal(
      await readProvider.getTransactionCount(signer.address, "pending"),
      nonce,
      "Signer nonce changed; stop before signing"
    );
    const estimate = await broadcastProvider.estimateGas({
      from: signer.address,
      to,
      data
    });
    const gasLimit = (estimate * 120n + 99n) / 100n;
    const raw = await signer.signTransaction({
      type: 2,
      chainId: 8453,
      nonce,
      to,
      data,
      value: 0,
      gasLimit,
      maxFeePerGas: BigInt(pre.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(pre.maxPriorityFeePerGas)
    });
    signed = { raw, hash: keccak256(raw) };
    save(path, signed, true); // Persist exact bytes before any broadcast; retries reuse the same nonce/hash.
  }
  let found = await receipt(signed.hash);
  if (!found) {
    try {
      assert.equal(
        await broadcastProvider.send("eth_sendRawTransaction", [signed.raw]),
        signed.hash
      );
    } catch {
      // A network error may occur after acceptance. Never create another transaction.
      console.log(
        JSON.stringify({
          label,
          hash: signed.hash,
          state: "checking_broadcast_receipt"
        })
      );
    }
    for (let attempt = 0; attempt < 90 && !found; attempt++) {
      await delay(2_000);
      found = await receipt(signed.hash);
    }
    assert(
      found,
      `No receipt yet for ${signed.hash}; rerun to resume exact signed transaction`
    );
  }
  save(`${root}/${label}.json`, {
    label,
    hash: found.hash,
    blockNumber: found.blockNumber,
    blockHash: found.blockHash,
    gasUsed: String(found.gasUsed),
    gasPrice: String(found.gasPrice),
    contractAddress: found.contractAddress,
    nonce
  });
  console.log(
    JSON.stringify({
      label,
      hash: found.hash,
      blockNumber: found.blockNumber,
      state: "confirmed"
    })
  );
  return found;
}

async function assertRelease() {
  const pre = readPreflight();
  const contract = new Contract(pre.contract, artifact.abi, readProvider);
  const values = await Promise.all([
    contract.DISTRIBUTION_ROOT(),
    contract.REPLACEMENT_SNAPSHOT_SHA256(),
    contract.REVEAL_ASSIGNMENTS_SHA256(),
    contract.BASE_METADATA_URI()
  ]);
  assert.deepEqual(values, [
    plan.root,
    `0x${plan.snapshotSha256}`,
    `0x${plan.revealAssignmentsSha256}`,
    metadataBaseUri
  ]);
  return { pre, contract };
}
async function deploy() {
  console.log(JSON.stringify({ stage: "deployment_preflight" }));
  await checkChain();
  const pre = readPreflight();
  assert(
    (await readProvider.getBalance(signer.address)) >=
      BigInt(pre.upperGasCostWei) + BigInt(pre.l1FeeReserveWei),
    "Signer requires the planned gas top-up before deployment"
  );
  const publicCheck = json<{
    contract: string;
    verifiedMetadata: number;
    passed: boolean;
  }>("data/metadata-verification.json");
  assert.equal(publicCheck.contract, pre.contract);
  assert.equal(publicCheck.verifiedMetadata, 898);
  assert.equal(publicCheck.passed, true);
  const tx = await factory.getDeployTransaction(...args);
  console.log(
    JSON.stringify({ stage: "deployment_transaction", contract: pre.contract })
  );
  const result = await send("deploy", pre.nonce, null, tx.data);
  assert.equal(result.contractAddress?.toLowerCase(), pre.contract);
  await assertRelease();
  const code = await readProvider.getCode(pre.contract);
  save(`${root}/deployment.json`, {
    chainId: 8453,
    contract: pre.contract,
    deployer: pre.signer,
    transactionHash: result.hash,
    blockNumber: result.blockNumber,
    blockHash: result.blockHash,
    runtimeSha256: sha256(Buffer.from(code.slice(2), "hex")),
    constructorArguments: args,
    snapshotSha256: plan.snapshotSha256,
    distributionRoot: plan.root,
    metadataBaseUri
  });
}
async function mint() {
  await checkChain();
  const { pre, contract } = await assertRelease();
  const limit = Number(process.env.MAX_TRANSACTIONS ?? 0);
  assert(Number.isSafeInteger(limit) && limit >= 0);
  let sent = 0;
  for (let start = 0; start < plan.tokens.length; start += 40) {
    const index = Math.floor(start / 40);
    const batch = plan.tokens.slice(start, start + 40);
    const label = `mint-${String(index).padStart(2, "0")}`;
    const existed = existsSync(`${root}/${label}.json`);
    if (!existed) assert.equal(await contract.owner(), signer.address);
    const result = await send(
      label,
      pre.nonce + 1 + index,
      pre.contract,
      iface.encodeFunctionData("airdropBatch", [
        batch.map((t) => t.recipient),
        batch.map((t) => t.tokenId),
        batch.map((t) => t.proof)
      ])
    );
    const transfers = result.logs
      .filter((l) => l.address.toLowerCase() === pre.contract)
      .map((l) => {
        try {
          return iface.parseLog(l);
        } catch {
          return null;
        }
      })
      .filter((l) => l?.name === "Transfer");
    assert.equal(transfers.length, batch.length);
    batch.forEach((token, i) => {
      assert.equal(transfers[i]!.args.from, ZeroAddress);
      assert.equal(transfers[i]!.args.to.toLowerCase(), token.recipient);
      assert.equal(String(transfers[i]!.args.tokenId), token.tokenId);
    });
    if (!existed) sent++;
    if (limit && sent >= limit) break;
  }
  console.log(
    JSON.stringify({
      mintedSupply: String(await contract.totalSupply()),
      newTransactions: sent
    })
  );
}
async function reconcile() {
  await checkChain();
  const { pre, contract } = await assertRelease();
  const finalMint = json<{ blockNumber: number }>(`${root}/mint-22.json`);
  const block = await readProvider.getBlock(finalMint.blockNumber);
  assert(block?.hash);
  assert.equal(await contract.totalSupply({ blockTag: block.number }), 898n);
  const multi = new Contract(
    "0xcA11bde05977b3631167028862bE2a173976CA11",
    [
      "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"
    ],
    readProvider
  );
  const changes: {
    tokenId: string;
    from: string;
    to: string;
    transactionHash: string;
    blockNumber: number;
  }[] = [];
  const logProvider = new JsonRpcProvider("http://127.0.0.1:19212", 8453, {
    staticNetwork: true,
    batchMaxCount: 1
  });
  try {
    for (let start = 0; start < plan.tokens.length; start += 40) {
      const batch = plan.tokens.slice(start, start + 40);
      const calls = batch.flatMap((t) =>
        ["ownerOf", "tokenURI"].map((method) => ({
          target: pre.contract,
          allowFailure: false,
          callData: iface.encodeFunctionData(method, [t.tokenId])
        }))
      );
      const values = await multi.aggregate3.staticCall(calls, {
        blockTag: block.number
      });
      for (const [i, t] of batch.entries()) {
        const actual = iface
          .decodeFunctionResult("ownerOf", values[2 * i].returnData)[0]
          .toLowerCase();
        if (actual !== t.recipient) {
          const mintReceipt = json<{ blockNumber: number; hash: string }>(
            `${root}/mint-${String(Math.floor(start / 40)).padStart(2, "0")}.json`
          );
          let owner = ZeroAddress.toLowerCase();
          let minted = false;
          for (
            let from = mintReceipt.blockNumber;
            from <= block.number;
            from += 10
          ) {
            const filter = {
              address: pre.contract,
              fromBlock: from,
              toBlock: Math.min(from + 9, block.number),
              topics: iface.encodeFilterTopics("Transfer", [
                null,
                null,
                t.tokenId
              ])
            };
            let logs: Log[] | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                logs = await logProvider.getLogs(filter);
                break;
              } catch (error) {
                if (attempt === 2) throw error;
                await delay(1000);
              }
            }
            assert(logs);
            for (const log of logs.sort(
              (a, b) => a.blockNumber - b.blockNumber || a.index - b.index
            )) {
              const event = iface.parseLog(log)!;
              assert.equal(event.args.from.toLowerCase(), owner);
              owner = event.args.to.toLowerCase();
              if (!minted) {
                assert.equal(log.transactionHash, mintReceipt.hash);
                assert.equal(owner, t.recipient);
                minted = true;
              } else
                changes.push({
                  tokenId: t.tokenId,
                  from: event.args.from.toLowerCase(),
                  to: owner,
                  transactionHash: log.transactionHash,
                  blockNumber: log.blockNumber
                });
            }
          }
          assert(minted);
          assert.equal(
            actual,
            owner,
            `Unexplained owner change for token ${t.tokenId}`
          );
        }
        assert.equal(
          iface.decodeFunctionResult(
            "tokenURI",
            values[2 * i + 1].returnData
          )[0],
          metadataBaseUri + t.tokenId
        );
      }
    }
  } finally {
    logProvider.destroy();
  }
  assert.equal((await readProvider.getBlock(block.number))?.hash, block.hash);
  const report = {
    verifiedAtUTC: new Date().toISOString(),
    contract: pre.contract,
    blockNumber: block.number,
    blockHash: block.hash,
    ownersVerified: 898,
    distinctMetadataUrisVerified: 898,
    snapshotSha256: plan.snapshotSha256,
    postMintTransfers: changes,
    passed: true
  };
  save(`${root}/reconciliation.json`, report);
  console.log(JSON.stringify(report, null, 2));
}
async function finalize() {
  await checkChain();
  const { pre, contract } = await assertRelease();
  const verification = json<{
    contract: string;
    ownersVerified: number;
    passed: boolean;
  }>(`${root}/reconciliation.json`);
  assert.equal(verification.contract, pre.contract);
  assert.equal(verification.ownersVerified, 898);
  assert.equal(verification.passed, true);
  await send(
    "finalize",
    pre.nonce + 24,
    pre.contract,
    iface.encodeFunctionData("finalizeAirdrop")
  );
  assert.equal(await contract.airdropFinalized(), true);
  assert.equal(await contract.owner(), ZeroAddress);
  console.log(
    JSON.stringify({
      contract: pre.contract,
      finalized: true,
      owner: ZeroAddress
    })
  );
}
async function main() {
  const command = process.argv[2];
  const handlers: Record<string, () => Promise<void>> = {
    preflight,
    deploy,
    mint,
    reconcile,
    finalize
  };
  assert(command && handlers[command], "Unknown release command");
  await handlers[command]();
}
main()
  .catch((error: unknown) => {
    // Avoid dumping request payloads or credential-bearing environment values.
    const detail = error as {
      name?: string;
      code?: string;
      shortMessage?: string;
    };
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : JSON.stringify({
            error: detail.name,
            code: detail.code,
            message:
              detail.shortMessage ??
              "Release operation failed; inspect saved public receipts before retrying."
          })
    );
    process.exitCode = 1;
  })
  .finally(() => {
    readProvider.destroy();
    broadcastProvider.destroy();
  });
