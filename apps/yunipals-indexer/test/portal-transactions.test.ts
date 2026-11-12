import { describe, expect, it, vi } from "vitest";
import {
  createWalletClient,
  custom,
  keccak256,
  TransactionReceiptNotFoundError,
  type Hex,
  type PublicClient
} from "viem";
import { anvil } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  PortalTransactionSender,
  type PortalTransaction,
  type PortalTransactionJournal,
  type PortalTransactionSession
} from "../lib/portals/transactions.js";

const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const blockHash = `0x${"a".repeat(64)}` as Hex;
const intent = {
  operation: "grade:test:1",
  to: "0x2222222222222222222222222222222222222222" as const,
  data: "0x12345678" as Hex
};

function fixture() {
  const rows: PortalTransaction[] = [];
  let nonce = 0;
  let locked = false;
  let crashAfterInsert = false;
  const session: PortalTransactionSession = {
    latest: async (operation) =>
      rows.filter((row) => row.operation === operation).at(-1) ?? null,
    unresolved: async (next) =>
      rows.filter(
        (row) =>
          ["prepared", "broadcast"].includes(row.state) || row.nonce >= next
      ),
    insert: async (row) => {
      if (rows.some((saved) => saved.nonce === row.nonce))
        throw new Error("duplicate nonce");
      rows.push({ ...row });
      if (crashAfterInsert) {
        crashAfterInsert = false;
        throw new Error("power loss");
      }
    },
    state: async (hash, state) => {
      rows.find((row) => row.hash === hash)!.state = state;
    }
  };
  const journal: PortalTransactionJournal = {
    async withSigner(_chain, _signer, action) {
      if (locked) throw new Error("signer busy");
      locked = true;
      try {
        return await action(session);
      } finally {
        locked = false;
      }
    }
  };
  const sendRaw = vi.fn(async (raw: Hex) => {
    expect(
      rows.some((row) => row.raw === raw && row.hash === keccak256(raw))
    ).toBe(true);
    return keccak256(raw);
  });
  const wallet = createWalletClient({
    account,
    chain: anvil,
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_chainId") return "0x7a69";
        if (method === "eth_sendRawTransaction")
          return sendRaw((params as Hex[])[0]);
        throw new Error(`Unexpected test RPC ${method}`);
      }
    })
  });
  const prepare = vi
    .spyOn(wallet, "prepareTransactionRequest")
    .mockImplementation(
      async (request) =>
        ({
          ...request,
          chainId: 31337,
          type: "eip1559",
          gas: 100_000n,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n
        }) as never
    );
  const receipt = vi.fn(async ({ hash }: { hash: Hex }): Promise<unknown> => {
    throw new TransactionReceiptNotFoundError({ hash });
  });
  const client = {
    getChainId: vi.fn(async () => 31337),
    getTransactionCount: vi.fn(async () => nonce),
    getTransactionReceipt: receipt,
    getBlock: vi.fn(async () => ({ hash: blockHash })),
    getBlockNumber: vi.fn(async () => 100n)
  };
  const make = (ceiling = 1_000_000n) =>
    new PortalTransactionSender(
      journal,
      client as unknown as PublicClient,
      wallet,
      12n,
      ceiling
    );
  return {
    rows,
    sendRaw,
    prepare,
    receipt,
    client,
    wallet,
    make,
    crash: () => {
      crashAfterInsert = true;
    },
    setNonce: (value: number) => {
      nonce = value;
    },
    mined: (hash: Hex, status: "success" | "reverted" = "success") => {
      receipt.mockImplementation(async ({ hash: requested }) => {
        if (requested === hash)
          return { transactionHash: hash, blockHash, blockNumber: 80n, status };
        throw new TransactionReceiptNotFoundError({ hash: requested });
      });
    }
  };
}

describe("durable portal signer", () => {
  it("recovers a crash after persistence without signing another nonce or payload", async () => {
    const f = fixture();
    f.crash();
    await expect(f.make().send(intent)).rejects.toThrow("power loss");
    expect(f.sendRaw).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(1);
    const hash = await f.make().send(intent);
    expect(hash).toBe(f.rows[0].hash);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.sendRaw).toHaveBeenCalledWith(f.rows[0].raw);
  });
  it("retains ambiguous broadcast attempts and rebroadcasts identical bytes", async () => {
    const f = fixture();
    f.sendRaw.mockRejectedValueOnce(
      new Error("connection lost after submission")
    );
    const hash = await f.make().send(intent);
    expect(f.rows[0].state).toBe("prepared");
    expect(await f.make().send(intent)).toBe(hash);
    expect(f.rows).toHaveLength(1);
    expect(f.sendRaw.mock.calls[0]).toEqual(f.sendRaw.mock.calls[1]);
    f.mined(hash);
    f.setNonce(1);
    expect(await f.make().send(intent)).toBe(hash);
    expect(f.rows[0].state).toBe("confirmed");
    expect(f.sendRaw).toHaveBeenCalledTimes(2);
  });
  it("does not treat an access error as absence or allocate a fresh nonce", async () => {
    const f = fixture();
    await f.make().send(intent);
    f.receipt.mockRejectedValue(new Error("403 archive access denied"));
    await expect(f.make().send(intent)).rejects.toThrow(
      "saved transaction is retained"
    );
    expect(f.sendRaw).toHaveBeenCalledTimes(1);
    expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("blocks another operation until the prior nonce has a confirmed outcome", async () => {
    const f = fixture();
    const hash = await f.make().send(intent);
    await expect(
      f.make().send({ ...intent, operation: "theme:test:2" })
    ).rejects.toThrow("still pending");
    expect(f.rows).toHaveLength(1);
    f.mined(hash);
    f.setNonce(1);
    await f.make().send({ ...intent, operation: "theme:test:2" });
    expect(f.rows.map((row) => row.nonce)).toEqual([0, 1]);
  });
  it("will not overwrite a saved intent or guess about a consumed replacement nonce", async () => {
    const f = fixture();
    await f.make().send(intent);
    await expect(f.make().send({ ...intent, data: "0xabcd" })).rejects.toThrow(
      "does not match"
    );
    f.setNonce(1);
    await expect(f.make().send(intent)).rejects.toThrow(
      "Reconcile the replacement"
    );
    expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("retries a finalized revert as a distinct durable attempt", async () => {
    const f = fixture();
    const hash = await f.make().send(intent);
    f.mined(hash, "reverted");
    f.setNonce(1);
    const retry = await f.make().send(intent);
    expect(retry).not.toBe(hash);
    expect(
      f.rows.map((row) => [row.attempt, row.nonce, row.intentHash])
    ).toEqual([
      [0, 0, f.rows[0].intentHash],
      [1, 1, f.rows[0].intentHash]
    ]);
  });
  it("rejects corrupt saved signatures and execution fees over the ceiling", async () => {
    const f = fixture();
    await expect(f.make(1n).send(intent)).rejects.toThrow("ceiling");
    expect(f.rows).toHaveLength(0);
    await f.make().send(intent);
    f.rows[0].nonce = 12;
    await expect(f.make().send(intent)).rejects.toThrow("integrity");
    expect(f.sendRaw).toHaveBeenCalledTimes(1);
  });
});
