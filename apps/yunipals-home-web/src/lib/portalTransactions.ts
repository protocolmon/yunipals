import { z } from "zod";
import { PortalRequestError } from "./portalRetry";
import {
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import {
  portalEvidenceMatches,
  portalReceiptEvents,
  portalIndexSourceId,
  type PortalIndexEvidence,
  type PortalIndexRequest
} from "@protopals/yunipals-market-core/portalIndex";

const hash = z.string().regex(/^0x[\da-f]{64}$/i);
const address = z.string().regex(/^0x[\da-f]{40}$/i);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const states = [
  "submitted",
  "confirming",
  "indexing",
  "indexed",
  "delayed",
  "failed"
] as const;
const savedSchema = z.object({
  version: z.literal(1),
  id: hash,
  hash,
  chainId: z.number().int().positive(),
  wallet: address,
  grading: address,
  to: address,
  data: z
    .string()
    .regex(/^0x([\da-f]{2})*$/i)
    .max(65538),
  value: uint,
  actionKey: z.string().min(1).max(160),
  label: z.string().min(1).max(100),
  createdAt: z.number().int(),
  state: z.enum(states),
  blockNumber: uint.nullable(),
  blockHash: hash.nullable(),
  generation: z.string().uuid().nullable(),
  sourceId: hash.nullable(),
  message: z.string().max(300)
});
export type PortalTransaction = z.infer<typeof savedSchema>;
export type PortalTransactionIntent = Pick<
  PortalTransaction,
  "to" | "data" | "value" | "actionKey" | "label"
>;
export const portalTransactionPending = (value: PortalTransaction) =>
  !["indexed", "failed"].includes(value.state);
const sharedIdentitySchema = z.object({ releaseId: hash, readIdentity: hash });
const selectionSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  shared: sharedIdentitySchema.optional(),
  sourceId: hash,
  generation: z.string().uuid().nullable(),
  deployment: z.object({
    chainId: z.number().int().positive(),
    collection: address,
    grading: address,
    registry: address,
    competition: address
  })
});
const evidenceSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  shared: sharedIdentitySchema
    .extend({ observationRevision: z.string() })
    .optional(),
  expectationHash: hash,
  state: z.enum([
    "indexed",
    "awaiting_indexing",
    "awaiting_receipt",
    "inclusion_changed",
    "action_not_observed",
    "source_unavailable",
    "unsupported"
  ]),
  reason: z.string(),
  transaction: z.object({
    chainId: z.number(),
    hash,
    blockNumber: uint,
    blockHash: hash
  }),
  coverage: z
    .object({
      sourceId: hash,
      policy: z.literal("latest"),
      completeThroughBlock: uint,
      availableThroughBlock: uint,
      finalizedThroughBlock: uint.nullable(),
      anchor: z.object({ number: uint, hash }),
      observationRevision: z.string().uuid().nullable()
    })
    .nullable(),
  proof: z
    .object({
      kind: z.enum(["canonical_event", "canonical_event_and_full_receipt"]),
      receiptRequirement: z.enum(["none", "full"]),
      receiptPayloadHash: hash.nullable(),
      events: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            logIndex: z.number().int()
          })
        )
        .max(256)
    })
    .nullable(),
  application: z.object({
    state: z.enum(["applied", "not_evaluated"]),
    component: z.literal("portal")
  })
});
type Dependencies = {
  client: Pick<
    PublicClient,
    "getChainId" | "waitForTransactionReceipt" | "getTransaction" | "getBlock"
  >;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  storage?: Pick<Storage, "getItem" | "setItem">;
  changed?: () => void;
};

/** Mirrors Arena's persisted phases and marketplace's exact indexed-action
 * evidence. A timeout changes the status; it never clears a broadcast intent. */
export class PortalTransactionTracker {
  readonly chainId: number;
  readonly wallet: string;
  readonly grading: string;
  readonly key: string;
  private deps: Dependencies;
  private values: PortalTransaction[] = [];
  private listeners = new Set<() => void>();
  private checks = new Map<string, Promise<TransactionReceipt | undefined>>();
  private unavailableUntil = 0;
  private unavailableAttempts = 0;
  private nextBackgroundVerification = new Map<string, number>();
  constructor(
    scope: { chainId: number; wallet: string; grading: string },
    deps: Dependencies
  ) {
    this.chainId = scope.chainId;
    this.wallet = scope.wallet.toLowerCase();
    this.grading = scope.grading.toLowerCase();
    this.deps = deps;
    this.key = `yunipals/portals/transaction/v1/${this.chainId}/${this.grading}/${this.wallet}`;
    this.reload();
  }
  getSnapshot = () => this.values;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  reload() {
    try {
      const parsed = z
        .array(savedSchema)
        .max(200)
        .parse(JSON.parse(this.deps.storage?.getItem(this.key) ?? "[]"));
      this.values = parsed.filter(
        (v) =>
          v.chainId === this.chainId &&
          v.wallet.toLowerCase() === this.wallet &&
          v.grading.toLowerCase() === this.grading
      );
    } catch {
      /* Invalid storage cannot authorize or complete an action. */
    }
    for (const listener of this.listeners) listener();
  }
  private update(id: string, patch: Partial<PortalTransaction>) {
    const prior = this.values.find((v) => v.id === id);
    if (!prior) return;
    this.values = this.values.map((v) =>
      v.id === id ? { ...v, ...patch } : v
    );
    this.persist();
    if (
      (prior.state === "indexed") !== (patch.state === "indexed") &&
      patch.state
    )
      this.deps.changed?.();
  }
  private persist() {
    try {
      this.deps.storage?.setItem(this.key, JSON.stringify(this.values));
    } catch {
      /* Still retain the real transaction in memory. */
    }
    for (const listener of this.listeners) listener();
  }
  assertAvailable(actionKey: string) {
    if (
      this.values.some(
        (v) => v.actionKey === actionKey && portalTransactionPending(v)
      )
    )
      throw new Error(
        "This action already has a submitted transaction. Check its saved status before trying again."
      );
  }
  add(hash: Hex, intent: PortalTransactionIntent) {
    const existing = this.values.find(
      (v) => v.id.toLowerCase() === hash.toLowerCase()
    );
    if (existing) return existing;
    const value = savedSchema.parse({
      version: 1,
      id: hash,
      hash,
      chainId: this.chainId,
      wallet: this.wallet,
      grading: this.grading,
      ...intent,
      createdAt: Date.now(),
      state: "submitted",
      blockNumber: null,
      blockHash: null,
      generation: null,
      sourceId: null,
      message: "Submitted. Waiting for confirmation…"
    });
    // Keep pending records even when the recent completed history is trimmed.
    this.values = [
      ...this.values.filter(portalTransactionPending),
      ...this.values.filter((v) => !portalTransactionPending(v)).slice(-40),
      value
    ];
    this.persist();
    return value;
  }
  check(
    id: string,
    options: { background?: boolean; automatic?: boolean } = {}
  ) {
    const active = this.checks.get(id);
    if (active) return active;
    // Completed actions leave the fast polling loop. Retain a bounded reorg
    // check while explicit status checks and pending waits remain responsive.
    if (
      options.background &&
      this.values.find((value) => value.id === id)?.state === "indexed" &&
      Date.now() < (this.nextBackgroundVerification.get(id) ?? 0)
    )
      return Promise.resolve(undefined);
    if (
      (options.background || options.automatic) &&
      Date.now() < this.unavailableUntil
    )
      return Promise.resolve(undefined);
    const promise = this.checkOnce(id).finally(() => this.checks.delete(id));
    this.checks.set(id, promise);
    return promise;
  }
  private async checkOnce(id: string): Promise<TransactionReceipt | undefined> {
    let saved = this.values.find((v) => v.id === id);
    if (!saved) return;
    const { client, request } = this.deps;
    try {
      if (saved.state === "failed") {
        if (
          !saved.blockNumber ||
          !saved.blockHash ||
          (await client.getBlock({ blockNumber: BigInt(saved.blockNumber) }))
            .hash === saved.blockHash
        )
          return;
        this.update(id, {
          state: "confirming",
          message: "The chain changed. Rechecking this transaction…"
        });
      }
      if ((await client.getChainId()) !== saved.chainId)
        throw new Error("Wrong RPC chain.");
      const receipt = await client.waitForTransactionReceipt({
        hash: saved.hash as Hex,
        timeout: 8000,
        pollingInterval: 1500,
        onReplaced: ({ transaction }) => {
          this.update(id, {
            hash: transaction.hash,
            state: "confirming",
            blockNumber: null,
            blockHash: null,
            generation: null,
            message: "Checking the replacement transaction…"
          });
        }
      });
      saved = this.values.find((v) => v.id === id)!;
      const transaction = await client.getTransaction({
        hash: receipt.transactionHash
      });
      if (
        receipt.status !== "success" ||
        transaction.from.toLowerCase() !== saved.wallet.toLowerCase() ||
        transaction.to?.toLowerCase() !== saved.to.toLowerCase() ||
        transaction.input.toLowerCase() !== saved.data.toLowerCase() ||
        transaction.value.toString() !== saved.value
      ) {
        this.update(id, {
          state: "failed",
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          message:
            "This transaction was reverted, cancelled or replaced with a different action."
        });
        return;
      }
      if (
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
        receipt.blockHash
      ) {
        this.update(id, {
          state: "confirming",
          blockNumber: null,
          blockHash: null,
          message: "The chain changed. Checking the transaction again…"
        });
        return;
      }
      if (saved.state !== "indexed" || saved.blockHash !== receipt.blockHash)
        this.update(id, {
          hash: receipt.transactionHash,
          state: "indexing",
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          message: "Confirmed. Waiting for indexed data…"
        });
      const selection = selectionSchema.parse(
        await request("/action-evidence?version=2")
      );
      if (
        selection.deployment.chainId !== saved.chainId ||
        selection.deployment.grading.toLowerCase() !==
          saved.grading.toLowerCase() ||
        selection.sourceId !== portalIndexSourceId(selection.deployment)
      )
        throw new Error("Portal indexer deployment changed.");
      const events = portalReceiptEvents(selection.deployment, receipt);
      if (!events.length) {
        this.update(id, {
          state: "failed",
          message: "The receipt does not contain the expected portal action."
        });
        return;
      }
      const expected: PortalIndexRequest = {
        version: selection.version,
        ...(selection.shared ? { shared: selection.shared } : {}),
        sourceId: selection.sourceId,
        generation: selection.generation,
        chainId: saved.chainId,
        transactionHash: receipt.transactionHash.toLowerCase(),
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash.toLowerCase(),
        sender: saved.wallet.toLowerCase(),
        events
      };
      const raw = await request("/action-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expected)
      });
      const evidence = evidenceSchema.parse(raw) as PortalIndexEvidence;
      this.unavailableAttempts = 0;
      if (portalEvidenceMatches(expected, evidence)) {
        // Verify again after the API read; a delayed response from an old block
        // must not turn a reorged transaction into success.
        if (
          (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
          receipt.blockHash
        )
          throw new Error("Inclusion changed during indexing.");
        const currentSelection = selectionSchema.parse(
          await request("/action-evidence?version=2")
        );
        if (
          currentSelection.generation !== selection.generation ||
          currentSelection.sourceId !== selection.sourceId ||
          JSON.stringify(currentSelection.shared) !==
            JSON.stringify(selection.shared) ||
          this.values.find((v) => v.id === id)?.hash.toLowerCase() !==
            receipt.transactionHash.toLowerCase()
        )
          throw new Error("The index changed during the response.");
        this.update(id, {
          state: "indexed",
          sourceId: selection.sourceId,
          generation: selection.generation,
          message: "Confirmed and indexed."
        });
        this.nextBackgroundVerification.set(id, Date.now() + 60000);
        return receipt;
      }
      this.update(id, {
        state:
          evidence.state === "inclusion_changed"
            ? "confirming"
            : Date.now() - saved.createdAt > 60000
              ? "delayed"
              : "indexing",
        message:
          evidence.state === "inclusion_changed"
            ? "The chain or index changed. Rechecking saved transaction…"
            : "Confirmed. The data update is still pending; your transaction is saved."
      });
    } catch (error) {
      if (
        error instanceof PortalRequestError &&
        [429, 503].includes(error.status)
      ) {
        const backoff = Math.min(
          30000,
          2500 * 2 ** Math.min(this.unavailableAttempts++, 4)
        );
        this.unavailableUntil =
          Date.now() +
          Math.min(
            60000,
            Math.max(error.retryAfterMs, backoff + Math.random() * 1000)
          );
      }
      this.update(id, {
        state: "delayed",
        message:
          "Checking is taking longer than expected. Your transaction is saved; do not submit it again."
      });
    }
  }
  async wait(id: string, onProgress?: (message: string) => void) {
    const end = Date.now() + 120000;
    let attempt = 0;
    while (Date.now() < end) {
      const receipt = await this.check(id, { automatic: true });
      const saved = this.values.find((v) => v.id === id)!;
      onProgress?.(saved.message);
      if (receipt && saved.state === "indexed") return receipt;
      if (saved.state === "failed") throw new Error(saved.message);
      const delay =
        Math.min(15000, 2500 * 1.5 ** attempt++) + Math.random() * 500;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(end - Date.now(), delay))
      );
    }
    throw new Error(
      "Your transaction is saved. Confirmation or indexing is still pending; use Check status instead of submitting again."
    );
  }
}
