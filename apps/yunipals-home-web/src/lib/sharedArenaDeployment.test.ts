import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { getContractAddress, type PublicClient, type Hex } from "viem";
import {
  readSharedArenaDeployment,
  readSharedArenaDeploymentPackage,
  sharedArenaCreation,
  sharedArenaDeploymentSha256,
  type SharedArenaDeploymentPackage
} from "./sharedArenaDeployment";
import { readArenaJoinPayment } from "./arenaPayment";
import {
  newArenaTransaction,
  readArenaTransaction,
  saveArenaTransaction
} from "./arenaTransactions";
import type { ArenaConfig } from "./arenaLive";

const bytes = await readFile(
  new URL("../../public/arena/shared-arena-deployment-v2.json", import.meta.url)
);
const bundle = JSON.parse(bytes.toString()) as SharedArenaDeploymentPackage;
const hash = `0x${"ab".repeat(32)}` as const;
const blockHash = `0x${"cd".repeat(32)}` as const;
const owner = bundle.admin;
const address = getContractAddress({ from: owner, nonce: 7n });

function fixture() {
  const state = {
    chain: 8453,
    receipt: {
      status: "success",
      contractAddress: address,
      blockNumber: 10n,
      blockHash
    },
    transaction: {
      from: owner,
      to: null,
      value: 0n,
      input: sharedArenaCreation(bundle),
      nonce: 7
    },
    blockHash: blockHash as Hex,
    head: 11n,
    runtime: bundle.arena.runtime,
    paused: true,
    wrongMode: false,
    wrongRole: false
  };
  const reader = {
    getChainId: async () => state.chain,
    getTransactionReceipt: async () => state.receipt,
    getTransaction: async () => state.transaction,
    getBlock: async () => ({ hash: state.blockHash }),
    getBlockNumber: async () => state.head,
    getCode: async () => state.runtime,
    readContract: async ({
      functionName,
      args,
      blockNumber
    }: {
      functionName: string;
      args?: unknown[];
      blockNumber: bigint;
    }) => {
      assert.equal(blockNumber, 10n);
      if (functionName === "owner") return state.wrongRole ? address : owner;
      if (functionName === "lobbyOperator") return bundle.roles.lobbyOperator;
      if (functionName === "admissionSigner")
        return bundle.roles.admissionSigner;
      if (functionName === "referee") return bundle.roles.referee;
      const mode = Number(args?.[0]);
      if (functionName === "entriesPaused") return state.paused;
      if (functionName === "nextTournamentId") return BigInt(mode + 1);
      if (functionName === "modeConfig")
        return {
          eligibility:
            mode === 0
              ? "0x0000000000000000000000000000000000000000"
              : bundle.registry,
          entryFee: state.wrongMode ? 9n : mode === 0 ? 2000000n : 1000000n,
          winnerBps: mode === 0 ? 7500 : 8000,
          islandBps: 500,
          rulesHash: bundle.rulesHashes[mode === 0 ? "video" : "anime"]
        };
      throw new Error("Unexpected chain read");
    }
  };
  return { state, reader, client: reader as unknown as PublicClient };
}

test("the frozen shared deployment package is pinned and verifies its rules", async () => {
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    sharedArenaDeploymentSha256
  );
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(bytes);
    assert.deepEqual(await readSharedArenaDeploymentPackage(), bundle);
    globalThis.fetch = async () => new Response(bytes.toString() + " ");
    await assert.rejects(readSharedArenaDeploymentPackage(), /reviewed build/);
  } finally {
    globalThis.fetch = original;
  }
});

test("confirmed deployment verifies the exact transaction, runtime, roles and both paused modes", async () => {
  const f = fixture();
  const record = await readSharedArenaDeployment(f.client, bundle, hash);
  assert.equal(record.arena.address, address);
  assert.equal(record.registry, bundle.registry);
  const corruptions: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.state.chain = 1;
    },
    (f) => {
      f.state.receipt.status = "reverted";
    },
    (f) => {
      f.state.head = 10n;
    },
    (f) => {
      f.state.blockHash = hash;
    },
    (f) => {
      f.state.transaction.from = address;
    },
    (f) => {
      f.state.transaction.value = 1n;
    },
    (f) => {
      f.state.transaction.input = "0x00";
    },
    (f) => {
      f.state.receipt.contractAddress = owner;
    },
    (f) => {
      f.state.runtime = "0x00";
    },
    (f) => {
      f.state.wrongRole = true;
    },
    (f) => {
      f.state.wrongMode = true;
    },
    (f) => {
      f.state.paused = false;
    }
  ];
  for (const corrupt of corruptions) {
    const broken = fixture();
    corrupt(broken);
    await assert.rejects(
      readSharedArenaDeployment(broken.client, bundle, hash)
    );
  }
});

test("join quote uses the approved gas-price ceiling and rejects wrong-mode or malformed quotes", async () => {
  let first = true,
    value = 123n,
    reads = 0;
  const client = {
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 2n
    }),
    readContract: async ({ args }: { args: bigint[] }) => {
      assert.deepEqual(args, [2n, 100n]);
      reads++;
      return [first, value];
    }
  } as unknown as PublicClient;
  const config = {
    contract: address,
    contractVersion: 2,
    mediaKind: "anime",
    randomnessFunding: "first-entrant"
  } as ArenaConfig;
  const initial = await readArenaJoinPayment(client, config, "2");
  assert.equal(initial.value, 123n);
  assert.equal(initial.fees!.maxFeePerGas, 100n);
  first = false;
  value = 0n;
  assert.equal((await readArenaJoinPayment(client, config, "2")).value, 0n);
  value = 1n;
  await assert.rejects(readArenaJoinPayment(client, config, "2"), /quote/);
  await assert.rejects(readArenaJoinPayment(client, config, "1"), /mode/);
  const before = reads;
  assert.equal(
    (await readArenaJoinPayment(client, { ...config, contractVersion: 1 }, "1"))
      .value,
    0n
  );
  assert.equal(reads, before);
});

test("pending transactions recover independently for both shared modes and the old arena", () => {
  const original = globalThis.localStorage,
    data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v)
    }
  });
  try {
    saveArenaTransaction(
      newArenaTransaction(owner, address, hash, { kind: "claim" }, "video")
    );
    saveArenaTransaction(
      newArenaTransaction(
        owner,
        address,
        blockHash,
        { kind: "claim", asset: "randomness-refund", recipient: owner },
        "anime"
      )
    );
    assert.equal(readArenaTransaction(owner, address, "video")?.hash, hash);
    assert.equal(
      readArenaTransaction(owner, address, "anime")?.hash,
      blockHash
    );
    assert.equal(readArenaTransaction(owner, address), null);
    saveArenaTransaction(
      newArenaTransaction(owner, address, hash, { kind: "claim" })
    );
    assert.equal(readArenaTransaction(owner, address)?.hash, hash);
    assert.equal(data.size, 3);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original
    });
  }
});
