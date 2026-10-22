export function ownershipReadConfiguration(
  env: NodeJS.ProcessEnv = process.env
) {
  const mode = env.OWNERSHIP_READ_MODE ?? "legacy";
  const bnbConfirmations = Number(env.BNB_CONFIRMATIONS ?? 20);
  if (
    !Number.isSafeInteger(bnbConfirmations) ||
    bnbConfirmations < 1 ||
    bnbConfirmations > 1000
  )
    throw new Error("Invalid BNB ownership confirmation policy.");
  if (mode !== "legacy" && mode !== "unified")
    throw new Error("Invalid ownership read mode.");
  if (mode === "legacy") {
    if (
      env.OWNERSHIP_READ_SCHEMA !== undefined ||
      env.OWNERSHIP_RELEASE_ID !== undefined
    )
      throw new Error("Unified ownership selectors require unified read mode.");
    return {
      mode,
      readSchema: env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA ?? "public",
      releaseId: null,
      bnbConfirmations
    } as const;
  }
  const readSchema = env.OWNERSHIP_READ_SCHEMA,
    releaseId = env.OWNERSHIP_RELEASE_ID;
  if (
    !readSchema ||
    !/^[a-z_][a-z0-9_]{0,62}$/i.test(readSchema) ||
    !releaseId ||
    !/^0x[0-9a-f]{64}$/.test(releaseId) ||
    !env.DATABASE_SCHEMA ||
    env.YUNIPALS_PROJECTION_MODE !== "generation" ||
    readSchema === env.DATABASE_SCHEMA ||
    (env.READ_DATABASE_SCHEMA !== undefined &&
      env.READ_DATABASE_SCHEMA !== readSchema)
  )
    throw new Error(
      "Configure one registered ownership release, its candidate read schema and the physical Ponder schema."
    );
  return { mode, readSchema, releaseId, bnbConfirmations } as const;
}
