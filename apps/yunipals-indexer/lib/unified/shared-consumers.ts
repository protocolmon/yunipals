import {
  sharedIndexerConsumerSettings,
  validateSharedIndexerDeployment,
  type SharedIndexerDeployment
} from "./shared-deployment.js";

export const sharedIndexerConsumers = [
  "reader",
  "publisher",
  "booster",
  "arena",
  "observer",
  "marketplace-ownership",
  "marketplace-sales",
  "marketplace-bnb-discovery",
  "marketplace-bnb-sales"
] as const;
export type SharedIndexerConsumer = (typeof sharedIndexerConsumers)[number];

/** Public overlays only. Database credentials, worker modes and provider keys
 * remain in each service's existing private configuration. */
export function sharedConsumerSettings(
  value: SharedIndexerDeployment,
  consumer: SharedIndexerConsumer,
  files: {
    deployment?: string;
    profile?: string;
    ownershipReadSchema?: string;
  } = {}
): Record<string, string> {
  const deployment = validateSharedIndexerDeployment(value);
  const common = sharedIndexerConsumerSettings(deployment);
  if (consumer === "publisher")
    return {
      ...sharedConsumerSettings(deployment, "reader"),
      PROJECTION_ANCHOR_RPC_PROFILE_ID: deployment.rpcProfileId,
      ...Object.fromEntries(
        Object.entries(deployment.rpcProfile.endpoints!).map(([chain, url]) => [
          `PROJECTION_ANCHOR_RPC_URL_${chain}`,
          url
        ])
      )
    };
  if (consumer === "booster")
    return { BOOSTER_DATABASE_SCHEMA: deployment.schema };
  if (consumer.startsWith("marketplace-")) {
    if (
      consumer === "marketplace-ownership" &&
      (!files.ownershipReadSchema ||
        !/^[a-z_][a-z0-9_]{0,62}$/.test(files.ownershipReadSchema) ||
        files.ownershipReadSchema === deployment.schema)
    )
      throw new Error(
        "Select the marketplace ownership schema created with the latest BNB read policy."
      );
    const prefix = (
      {
        "marketplace-ownership": "MARKET_OWNERSHIP_INDEXER",
        "marketplace-sales": "MARKET_SALE_INDEXER",
        "marketplace-bnb-discovery": "MARKET_BNB_DISCOVERY_INDEXER",
        "marketplace-bnb-sales": "MARKET_BNB_SALE_INDEXER"
      } as Partial<Record<SharedIndexerConsumer, string>>
    )[consumer];
    if (!prefix) throw new Error("Unsupported marketplace consumer.");
    return {
      [`${prefix}_MODE`]: "unified",
      [`${prefix}_RELEASE_ID`]: deployment.releaseId,
      ...(consumer === "marketplace-ownership"
        ? { [`${prefix}_READ_SCHEMA`]: files.ownershipReadSchema! }
        : {})
    };
  }
  if (consumer === "reader")
    return {
      DATABASE_SCHEMA: deployment.schema,
      READ_DATABASE_SCHEMA: deployment.ownershipReadSchema,
      OWNERSHIP_READ_SCHEMA: deployment.ownershipReadSchema,
      OWNERSHIP_READ_MODE: "unified",
      OWNERSHIP_RELEASE_ID: deployment.releaseId,
      UNIFIED_INDEXER_RELEASE_ID: deployment.releaseId,
      BASE_METADATA_INGESTION: "native",
      METADATA_SOURCE_MODE: "archive",
      YUNIPALS_PROJECTION_MODE: "generation"
    };
  if (consumer === "arena")
    return {
      ARENA_INDEXER_MODE: "unified",
      ARENA_INDEXER_SOURCE_KIND: "unified",
      ARENA_INDEXER_RELEASE_ID: deployment.releaseId
    };
  if (consumer !== "observer")
    throw new Error("Unsupported shared indexer consumer.");
  if (!files.deployment?.startsWith("/") || !files.profile?.startsWith("/"))
    throw new Error(
      "Absolute observer deployment and RPC profile paths required."
    );
  return {
    ...Object.fromEntries(
      Object.entries(common).filter(
        ([key]) =>
          key === "UNIFIED_INDEXER_RELEASE_ID" ||
          key.startsWith("UNIFIED_RPC_") ||
          key.startsWith("PONDER_RPC_URL_")
      )
    ),
    UNIFIED_INDEXER_DEPLOYMENT_FILE: files.deployment,
    UNIFIED_RPC_PROFILE_FILE: files.profile
  };
}

/** Shared syntax for Node --env-file and systemd EnvironmentFile. No shell
 * expansion is involved; reject multiline values rather than escaping them. */
export function encodeSharedConsumerSettings(settings: Record<string, string>) {
  return (
    Object.entries(settings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        if (
          !/^[A-Z][A-Z0-9_]*$/.test(key) ||
          typeof value !== "string" ||
          /[\r\n\0']/.test(value)
        )
          throw new Error("Invalid public consumer setting.");
        return `${key}='${value}'`;
      })
      .join("\n") + "\n"
  );
}
