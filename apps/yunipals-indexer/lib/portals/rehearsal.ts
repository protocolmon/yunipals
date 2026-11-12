import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  type Address,
  type Hex,
  type LocalAccount
} from "viem";
import { baseSepolia } from "viem/chains";

export interface RehearsalTransaction {
  hash: Hex;
  raw: Hex;
  from: Address;
  to?: Address;
  data: Hex;
  value: string;
  block?: string;
  blockHash?: Hex;
  contractAddress?: Address;
  gasCost?: string;
}

export interface RehearsalState {
  chainId: 84532;
  wallets: Record<string, Address>;
  artifactHashes: Record<string, string>;
  transactions: Record<string, RehearsalTransaction>;
  observations: Record<string, unknown>;
}

export const rehearsalJson = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2
  );

export async function writeRehearsalJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.pending`;
  await writeFile(temporary, `${rehearsalJson(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** Read only the explicitly supplied operator files. Values are never logged. */
export async function readRehearsalEnv(path: string) {
  const result: Record<string, string> = {};
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(
      line
    );
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"'))
      value = JSON.parse(value) as string;
    else if (value.startsWith("'") && value.endsWith("'"))
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

/** Exact raw transactions are saved before sending, allowing safe rebroadcast on resume. */
export class PortalRehearsal {
  readonly client;
  readonly statePath;

  constructor(
    readonly rpc: string,
    readonly directory: string,
    readonly state: RehearsalState,
    readonly maximumNativeSpend = parseEther("0.05")
  ) {
    this.client = createPublicClient({
      chain: baseSepolia,
      transport: http(rpc, { retryCount: 2, timeout: 20_000 }),
      pollingInterval: 2000
    });
    this.statePath = join(directory, "state.json");
  }

  save() {
    return writeRehearsalJson(this.statePath, this.state);
  }

  async verifyNetwork() {
    assert.equal(await this.client.getChainId(), 84532, "Base Sepolia only");
  }

  async observe(name: string, value: unknown) {
    this.state.observations[name] = value;
    await this.save();
  }

  async verifyArtifact(name: string, bytes: Uint8Array) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const previous = this.state.artifactHashes[name];
    assert(!previous || previous === hash, "Rehearsal artifact changed");
    this.state.artifactHashes[name] = hash;
    await this.save();
  }

  async transaction(
    name: string,
    account: LocalAccount,
    data: Hex,
    to?: Address,
    value = 0n
  ) {
    await this.verifyNetwork();
    let saved = this.state.transactions[name];
    if (saved) {
      assert.equal(saved.from.toLowerCase(), account.address.toLowerCase());
      assert.equal(saved.to?.toLowerCase(), to?.toLowerCase());
      assert.equal(saved.data, data);
      assert.equal(saved.value, value.toString());
    } else {
      const wallet = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(this.rpc)
      });
      const prepared = await wallet.prepareTransactionRequest({
        account,
        data,
        to,
        value
      });
      const previous = Object.values(this.state.transactions).reduce(
        (total, tx) => total + BigInt(tx.value) + BigInt(tx.gasCost ?? "0"),
        0n
      );
      const fee =
        prepared.gas *
        (prepared.type === "eip1559"
          ? prepared.maxFeePerGas
          : prepared.gasPrice);
      assert(
        previous + value + fee <= this.maximumNativeSpend,
        "Rehearsal native spending limit reached"
      );
      const raw = await wallet.signTransaction(prepared);
      saved = {
        hash: keccak256(raw),
        raw,
        from: account.address,
        to,
        data,
        value: value.toString()
      };
      this.state.transactions[name] = saved;
      await this.save();
    }
    if (!saved.block) {
      const existing = await this.client
        .getTransactionReceipt({ hash: saved.hash })
        .catch(() => null);
      if (!existing) {
        try {
          await this.client.sendRawTransaction({
            serializedTransaction: saved.raw
          });
        } catch {
          // The original may already be in the mempool after a lost RPC reply.
          await this.client.getTransaction({ hash: saved.hash });
        }
      }
    }
    const receipt = await this.client.waitForTransactionReceipt({
      hash: saved.hash,
      confirmations: 2,
      timeout: 120_000
    });
    assert.equal(receipt.status, "success", `Reverted rehearsal step: ${name}`);
    if (saved.blockHash) assert.equal(receipt.blockHash, saved.blockHash);
    saved.block = receipt.blockNumber.toString();
    saved.blockHash = receipt.blockHash;
    saved.gasCost = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
    if (receipt.contractAddress)
      saved.contractAddress = receipt.contractAddress;
    await this.save();
    console.log(rehearsalJson({ step: name, hash: receipt.transactionHash }));
    return receipt;
  }
}
