export type SourceFeature =
  | "ownership"
  | "islands"
  | "boosters"
  | "base-metadata"
  | "marketplace"
  | "arena"
  | "anime-registry";

export type ConfirmationPolicy =
  | { kind: "latest" }
  | { kind: "depth"; subsequentBlocks: number }
  | { kind: "finalized" };

export type SourceDefinition = {
  id: string;
  feature: SourceFeature;
  chainId: number;
  contractName: string;
  address: string | null;
  startBlock: string | null;
  endBlock: string | null;
  enabled: boolean;
  abiHash: string;
  events: readonly string[];
  receiptRequirement: "none" | "full";
  // Receipt evidence may have a narrower immutable history than events and
  // ownership. Absent preserves receipt coverage from startBlock.
  receiptStartBlock?: string;
  policies: readonly ConfirmationPolicy[];
};

export type SourceManifest = {
  version: 1;
  ponderVersion: "0.17.5";
  ordering: "multichain";
  coverage: "ponder-live-blocks-v1";
  sources: readonly SourceDefinition[];
};

export function confirmationPolicyKey(policy: ConfirmationPolicy): string {
  switch (policy.kind) {
    case "latest":
    case "finalized":
      return policy.kind;
    case "depth":
      if (
        !Number.isSafeInteger(policy.subsequentBlocks) ||
        policy.subsequentBlocks < 1
      ) {
        throw new Error("Confirmation depth must be a positive safe integer.");
      }
      return `depth:${policy.subsequentBlocks}`;
    default:
      throw new Error("Unsupported confirmation policy.");
  }
}

const features: readonly SourceFeature[] = [
  "ownership",
  "islands",
  "boosters",
  "base-metadata",
  "marketplace",
  "arena",
  "anime-registry"
];
const chains = new Set([1, 56, 137, 8453]);
const decimal = /^(0|[1-9][0-9]*)$/;

export function validateSourceManifest(manifest: SourceManifest): void {
  if (
    manifest.version !== 1 ||
    manifest.ponderVersion !== "0.17.5" ||
    manifest.ordering !== "multichain" ||
    manifest.coverage !== "ponder-live-blocks-v1"
  ) {
    throw new Error("Unsupported source manifest runtime.");
  }
  const ids = new Set<string>();
  const subscriptions = new Set<string>();
  for (const source of manifest.sources) {
    if (!/^[a-z0-9][a-z0-9:_-]*$/.test(source.id) || ids.has(source.id)) {
      throw new Error("Invalid or duplicate source ID.");
    }
    ids.add(source.id);
    if (
      !features.includes(source.feature) ||
      !chains.has(source.chainId) ||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(source.contractName) ||
      typeof source.enabled !== "boolean" ||
      !/^0x[0-9a-f]{64}$/.test(source.abiHash) ||
      !["none", "full"].includes(source.receiptRequirement)
    ) {
      throw new Error(`Invalid source configuration: ${source.id}.`);
    }
    if (
      source.address !== null &&
      (!/^0x[0-9a-f]{40}$/.test(source.address) ||
        /^0x0{40}$/.test(source.address))
    ) {
      throw new Error(`Invalid source address: ${source.id}.`);
    }
    for (const value of [source.startBlock, source.endBlock]) {
      if (
        value !== null &&
        (!decimal.test(value) ||
          BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
      ) {
        throw new Error(`Invalid source block: ${source.id}.`);
      }
    }
    if (
      (source.enabled &&
        (source.address === null || source.startBlock === null)) ||
      (source.endBlock !== null &&
        (source.startBlock === null ||
          BigInt(source.endBlock) < BigInt(source.startBlock)))
    ) {
      throw new Error(`Incomplete source bounds: ${source.id}.`);
    }
    if (
      source.receiptStartBlock !== undefined &&
      (!source.enabled ||
        source.receiptRequirement !== "full" ||
        typeof source.receiptStartBlock !== "string" ||
        !decimal.test(source.receiptStartBlock) ||
        BigInt(source.receiptStartBlock) > BigInt(Number.MAX_SAFE_INTEGER) ||
        source.startBlock === null ||
        BigInt(source.receiptStartBlock) < BigInt(source.startBlock) ||
        (source.endBlock !== null &&
          BigInt(source.receiptStartBlock) > BigInt(source.endBlock)))
    ) {
      throw new Error(`Invalid source receipt history: ${source.id}.`);
    }
    if (
      source.events.length === 0 ||
      new Set(source.events).size !== source.events.length ||
      source.events.some((event) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(event)) ||
      source.policies.length === 0
    ) {
      throw new Error(`Invalid source filters: ${source.id}.`);
    }
    const policies = source.policies.map(confirmationPolicyKey);
    if (new Set(policies).size !== policies.length) {
      throw new Error(`Duplicate confirmation policy: ${source.id}.`);
    }
    if (source.enabled) {
      for (const event of source.events) {
        const subscription = JSON.stringify([
          source.chainId,
          source.address,
          event
        ]);
        if (subscriptions.has(subscription)) {
          throw new Error(`Duplicate source subscription: ${source.id}.`);
        }
        subscriptions.add(subscription);
      }
    }
  }
}
