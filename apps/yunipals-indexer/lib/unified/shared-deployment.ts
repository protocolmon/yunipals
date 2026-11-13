import { portalContracts } from "./portal-sources.js";
import {
  validateSourceManifest,
  type SourceManifest
} from "../../../../packages/yunipals-indexer-client/src/sources.js";
import {
  unifiedRpcManifestId,
  unifiedRpcProfileId,
  validateUnifiedRpcProfile,
  type UnifiedRpcProfile
} from "../../../../packages/yunipals-indexer-server/src/rpc-policy.js";
import {
  buildSourceManifest,
  manifestDigest,
  sourceManifestHash
} from "./sources.js";

const retainedIds = [
  "ownership:ethereum",
  "ownership:base",
  "ownership:polygon",
  "ownership:bnb",
  "metadata:base",
  "islands:ethereum",
  "islands:base:v2",
  "boosters:boosterengine",
  "boosters:boostermonsters",
  "boosters:boosterregistry",
  "marketplace:bnb:seaport"
] as const;
const identifier = /^[a-zA-Z_][a-zA-Z0-9_]{0,44}$/;

export type SharedIndexerDeployment = {
  format: "yunipals-shared-indexer-v1";
  releaseId: string;
  schema: string;
  buildId: string;
  manifestHash: string;
  manifest: SourceManifest;
  ownershipReadSchema: string;
  ownershipDepthPolicies: Record<string, number[]>;
  rpcProfileId: string;
  rpcProfile: UnifiedRpcProfile;
};

export function assertSharedIndexerManifest(manifest: SourceManifest) {
  validateSourceManifest(manifest);
  const enabled = manifest.sources.filter((source) => source.enabled);
  const arena = enabled.filter((source) => source.feature === "arena");
  const registry = enabled.filter(
    (source) => source.feature === "anime-registry"
  );
  const portals = enabled.filter((source) => source.feature === "portals");
  if (
    portals.length !== 0 &&
    (portals.length !== 4 ||
      Object.entries(portalContracts).some(
        ([kind, name]) =>
          !portals.some(
            (row) =>
              row.id === `portals:8453:${kind}` &&
              row.contractName === name &&
              row.chainId === 8453
          )
      ))
  )
    throw new Error(
      "Shared portal ingestion requires exactly four reviewed sources."
    );
  if (
    enabled.length !== 13 + portals.length ||
    arena.length !== 1 ||
    arena[0]!.contractName !== "YunipalsArenaV2" ||
    arena[0]!.chainId !== 8453 ||
    registry.length !== 1 ||
    registry[0]!.id !== "anime-registry:8453" ||
    registry[0]!.chainId !== 8453 ||
    retainedIds.some((id) => !enabled.some((source) => source.id === id))
  )
    throw new Error(
      "Shared ingestion requires eleven retained sources, the fighter registry and one Arena v2 source."
    );
}

/** Remove retired deployments from ingestion only. Application workers keep
 * their own contract/mode configuration and private credentials. */
export function buildSharedIndexerManifest(
  environment: Record<string, string | undefined>
) {
  const manifest = buildSourceManifest({
    ...environment,
    UNIFIED_ARENA_DEPLOYMENTS: "[]",
    UNIFIED_ANIME_ARENA: undefined,
    ARENA_CONTRACT: undefined,
    ARENA_DEPLOYMENT_BLOCK: undefined
  });
  assertSharedIndexerManifest(manifest);
  return manifest;
}

export function assertRetainedIndexerSources(
  baseline: SourceManifest,
  target: SourceManifest,
  depthPolicies: Record<string, number[]> = {}
) {
  validateSourceManifest(baseline);
  assertSharedIndexerManifest(target);
  const existingArenaSources = baseline.sources
    .filter(
      (source) =>
        source.enabled &&
        (source.feature === "anime-registry" ||
          source.contractName === "YunipalsArenaV2")
    )
    .map((source) => source.id);
  const existingPortalSources = baseline.sources
    .filter((source) => source.enabled && source.feature === "portals")
    .map((source) => source.id);
  for (const id of [
    ...retainedIds,
    ...existingArenaSources,
    ...existingPortalSources
  ]) {
    const oldSource = baseline.sources.find((source) => source.id === id);
    const nextSource = target.sources.find((source) => source.id === id);
    const additional =
      oldSource?.feature === "ownership"
        ? (depthPolicies[id.replace(/^ownership:/, "")] ?? [])
        : [];
    const expected = oldSource && {
      ...oldSource,
      policies: [
        ...oldSource.policies,
        ...additional
          .filter(
            (depth) =>
              !oldSource.policies.some(
                (policy) =>
                  policy.kind === "depth" && policy.subsequentBlocks === depth
              )
          )
          .map((subsequentBlocks) => ({
            kind: "depth" as const,
            subsequentBlocks
          }))
      ]
    };
    if (
      !oldSource?.enabled ||
      !nextSource?.enabled ||
      manifestDigest(expected) !== manifestDigest(nextSource)
    )
      throw new Error(`Retained source definition changed: ${id}.`);
  }
  if (
    baseline.sources.some(
      (source) =>
        source.enabled &&
        source.feature !== "arena" &&
        source.feature !== "anime-registry" &&
        source.feature !== "portals" &&
        !retainedIds.some((id) => source.id === id)
    )
  )
    throw new Error(
      "Baseline contains an additional source requiring migration review."
    );
}

export function createSharedIndexerDeployment(options: {
  schema: string;
  buildId: string;
  ownershipReadSchema: string;
  ownershipDepthPolicies?: Record<string, number[]>;
  manifest: SourceManifest;
  rpcProfile: UnifiedRpcProfile;
}): SharedIndexerDeployment {
  const { schema, buildId, ownershipReadSchema, manifest } = options;
  if (
    !identifier.test(schema) ||
    !identifier.test(ownershipReadSchema) ||
    schema === ownershipReadSchema ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(buildId)
  )
    throw new Error(
      "Explicit source, build and distinct ownership view identities are required."
    );
  assertSharedIndexerManifest(manifest);
  const depthPolicies = options.ownershipDepthPolicies ?? {};
  for (const [chain, depths] of Object.entries(depthPolicies)) {
    const source = manifest.sources.find(
      (source) => source.id === `ownership:${chain}` && source.enabled
    );
    if (
      !source ||
      !Array.isArray(depths) ||
      !depths.length ||
      depths.length > 16 ||
      new Set(depths).size !== depths.length ||
      depths.some(
        (depth, index) =>
          !Number.isSafeInteger(depth) ||
          depth < 1 ||
          depth > 10000 ||
          (index > 0 && depth <= depths[index - 1]!) ||
          !source.policies.some(
            (policy) =>
              policy.kind === "depth" && policy.subsequentBlocks === depth
          )
      )
    )
      throw new Error(
        "Reviewed ownership depth extensions differ from the manifest."
      );
  }
  const rpcProfile = validateUnifiedRpcProfile(options.rpcProfile);
  const manifestHash = sourceManifestHash(manifest);
  if (
    unifiedRpcManifestId(rpcProfile) !== manifestHash ||
    !rpcProfile.endpoints
  )
    throw new Error(
      "Shared deployment requires the exact manifest and four reviewed RPC endpoints."
    );
  return {
    format: "yunipals-shared-indexer-v1",
    schema,
    buildId,
    ownershipReadSchema,
    ownershipDepthPolicies: depthPolicies,
    manifest,
    manifestHash,
    releaseId: manifestDigest({ schema, buildId, manifestHash }),
    rpcProfile,
    rpcProfileId: unifiedRpcProfileId(rpcProfile)
  };
}

export function validateSharedIndexerDeployment(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid shared deployment specification.");
  const input = value as Record<string, unknown>;
  const fields = [
    "format",
    "schema",
    "buildId",
    "ownershipReadSchema",
    "ownershipDepthPolicies",
    "manifest",
    "manifestHash",
    "releaseId",
    "rpcProfile",
    "rpcProfileId"
  ];
  if (
    Object.keys(input).sort().join() !== fields.sort().join() ||
    input.format !== "yunipals-shared-indexer-v1" ||
    typeof input.schema !== "string" ||
    typeof input.buildId !== "string" ||
    typeof input.ownershipReadSchema !== "string" ||
    !input.ownershipDepthPolicies ||
    typeof input.ownershipDepthPolicies !== "object" ||
    Array.isArray(input.ownershipDepthPolicies)
  )
    throw new Error("Invalid shared deployment fields.");
  const manifest = input.manifest as SourceManifest;
  validateSourceManifest(manifest);
  const result = createSharedIndexerDeployment({
    schema: input.schema,
    buildId: input.buildId,
    ownershipReadSchema: input.ownershipReadSchema,
    ownershipDepthPolicies: input.ownershipDepthPolicies as Record<
      string,
      number[]
    >,
    manifest,
    rpcProfile: validateUnifiedRpcProfile(input.rpcProfile)
  });
  if (
    result.releaseId !== input.releaseId ||
    result.manifestHash !== input.manifestHash ||
    result.rpcProfileId !== input.rpcProfileId
  )
    throw new Error("Shared deployment identity differs from its contents.");
  return result;
}

export function sharedIndexerConsumerSettings(
  deployment: SharedIndexerDeployment
): Record<string, string> {
  const checked = validateSharedIndexerDeployment(deployment);
  return {
    UNIFIED_INDEXER_RELEASE_ID: checked.releaseId,
    OWNERSHIP_RELEASE_ID: checked.releaseId,
    OWNERSHIP_READ_SCHEMA: checked.ownershipReadSchema,
    ARENA_INDEXER_MODE: "unified",
    ARENA_INDEXER_SOURCE_KIND: "unified",
    ARENA_INDEXER_RELEASE_ID: checked.releaseId,
    UNIFIED_RPC_PROFILE_ID: checked.rpcProfileId,
    UNIFIED_RPC_POLICY_REQUIRED: "true",
    UNIFIED_RPC_FREE_ONLY: "true",
    ...Object.fromEntries(
      Object.entries(checked.rpcProfile.endpoints!).map(([chain, url]) => [
        `PONDER_RPC_URL_${chain}`,
        url
      ])
    )
  };
}
