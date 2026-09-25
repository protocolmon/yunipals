import { getAddress, type Hex } from "viem";

import {
  assertWalletContext,
  type WalletContext
} from "@/lib/marketplace/executeTransaction";
import type { PreparedOrder, MarketOrder } from "@/lib/marketplace/marketApi";
import {
  assertOrderPreparation,
  assertOrderPublication,
  orderSigningData,
  publicationRequest,
  type PublicationIntent
} from "@/lib/marketplace/orderPublication";
import type { OrderPublicationState } from "@/lib/marketplace/orderRecovery";
import { seaportOrderHash } from "@/lib/marketplace/seaport";
import {
  marketplaceChains,
  marketplaceAssetKey,
  seaportDeployment
} from "@/lib/marketplace/registry";

export type SignedOrder = {
  intent: PublicationIntent;
  preparationId: string;
  signature: Hex;
};
export type PublicationStage =
  | "preparing"
  | "switching"
  | "signing"
  | "submitting"
  | "published";
export type PublicationDependencies = {
  wallet: {
    context: () => WalletContext;
    switchChain: (chainId: number) => Promise<void>;
    sign: (data: ReturnType<typeof orderSigningData>) => Promise<Hex>;
    verify: (
      data: ReturnType<typeof orderSigningData>,
      signature: Hex
    ) => Promise<boolean>;
  };
  api: {
    lookup: (
      intent: PublicationIntent,
      signal?: AbortSignal
    ) => Promise<MarketOrder | null>;
    prepare: (
      input: ReturnType<typeof publicationRequest>,
      signal?: AbortSignal
    ) => Promise<PreparedOrder>;
    submit: (signed: SignedOrder, signal?: AbortSignal) => Promise<MarketOrder>;
  };
  // Includes current ownership/lifecycle/visibility, policy/counter/order status,
  // NFT or payment-token approval/funds and source health. Repeat before sign.
  revalidate: (intent: PublicationIntent) => Promise<void>;
  save: (intent: PublicationIntent, state: OrderPublicationState) => void;
  onStage: (stage: PublicationStage) => void;
  now: () => bigint;
  signal?: AbortSignal;
};

export class SignedOrderPublicationError extends Error {
  readonly signed: SignedOrder;
  constructor(signed: SignedOrder, cause: unknown) {
    super(
      "Your wallet returned a signature, but publication could not be confirmed. Retry this same order or cancel it onchain before signing a replacement.",
      { cause }
    );
    this.name = "SignedOrderPublicationError";
    this.signed = signed;
  }
}

function current(intent: PublicationIntent, deps: PublicationDependencies) {
  deps.signal?.throwIfAborted();
  if (
    intent.asset.chainId !== marketplaceChains[intent.asset.chain].chainId ||
    intent.summary.source !== marketplaceChains[intent.asset.chain].source ||
    marketplaceAssetKey(intent.asset) !==
      marketplaceAssetKey(intent.summary.asset) ||
    getAddress(intent.summary.protocolAddress) !==
      getAddress(seaportDeployment.address) ||
    (intent.asset.chain !== "bnb" && !intent.policyVersion) ||
    seaportOrderHash(intent.order).toLowerCase() !==
      intent.orderHash.toLowerCase() ||
    getAddress(intent.summary.maker) !== getAddress(intent.order.offerer)
  )
    throw new Error("Invalid marketplace signing intent.");
  assertWalletContext(deps.wallet.context(), {
    chainId: intent.asset.chainId,
    account: intent.order.offerer
  });
  if (deps.now() < intent.order.startTime || deps.now() >= intent.order.endTime)
    throw new Error("This order is no longer within its signing period.");
}

async function submitPublication(
  signed: SignedOrder,
  deps: PublicationDependencies
) {
  const { intent } = signed;
  try {
    current(intent, deps);
    await deps.revalidate(intent);
    current(intent, deps);
    if (!(await deps.wallet.verify(orderSigningData(intent), signed.signature)))
      throw new Error(
        "The maker signature could not be verified on this chain."
      );
    current(intent, deps);
    deps.save(intent, "signed");
    deps.onStage("submitting");
    const published = await deps.api.submit(signed, deps.signal);
    // A late successful acknowledgement remains authoritative even after a
    // wallet change or dialog close; it does not request another wallet action.
    assertOrderPublication(intent, published);
    try {
      deps.save(intent, "accepted");
    } catch {
      /* The earlier parameters still permit cancellation; server acknowledgement remains valid. */
    }
    deps.onStage("published");
    return published;
  } catch (error) {
    try {
      deps.save(intent, "publication-unknown");
    } catch {
      /* Earlier recovery evidence remains. */
    }
    throw new SignedOrderPublicationError(signed, error);
  }
}

/** Resolve a durable acceptance before rechecking admission: the NFT may have
 * already sold or the order may have expired while its response was lost. */
export async function retryPublication(
  signed: SignedOrder,
  deps: PublicationDependencies
) {
  try {
    deps.signal?.throwIfAborted();
    const existing = await deps.api.lookup(signed.intent, deps.signal);
    if (existing) {
      assertOrderPublication(signed.intent, existing);
      try {
        deps.save(signed.intent, "accepted");
      } catch {
        /* Retain earlier cancellation evidence. */
      }
      deps.onStage("published");
      return existing;
    }
    // If absent, retry the identical signed order through fresh admission.
    return await submitPublication(signed, deps);
  } catch (error) {
    if (error instanceof SignedOrderPublicationError) throw error;
    try {
      deps.save(signed.intent, "publication-unknown");
    } catch {
      /* Earlier evidence remains. */
    }
    throw new SignedOrderPublicationError(signed, error);
  }
}

export async function publishOrder(
  intent: PublicationIntent,
  deps: PublicationDependencies
) {
  deps.signal?.throwIfAborted();
  const account = deps.wallet.context().address;
  if (!account || getAddress(account) !== getAddress(intent.order.offerer))
    throw new Error("Connect the wallet that owns this signing action.");
  if (deps.wallet.context().chainId !== intent.asset.chainId) {
    deps.onStage("switching");
    await deps.wallet.switchChain(intent.asset.chainId);
  }
  current(intent, deps);
  deps.onStage("preparing");
  const prepared = await deps.api.prepare(
    publicationRequest(intent),
    deps.signal
  );
  current(intent, deps);
  assertOrderPreparation(intent, prepared, deps.now());
  await deps.revalidate(intent);
  current(intent, deps);
  assertOrderPreparation(intent, prepared, deps.now());
  deps.save(intent, "signature-requested");
  current(intent, deps);
  deps.onStage("signing");
  const signature = await deps.wallet.sign(orderSigningData(intent));
  // Do not put the signature in browser storage or error text. The in-memory
  // payload enables an idempotent retry; saved parameters enable cancellation.
  const signed = { intent, preparationId: prepared.id, signature };
  return submitPublication(signed, deps);
}
