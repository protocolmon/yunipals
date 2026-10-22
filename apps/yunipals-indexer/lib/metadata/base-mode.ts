import { ponderSchema, unifiedOwnershipReads } from "../offchain/sql.js";

export function baseMetadataIngestionMode(
  env: NodeJS.ProcessEnv = process.env
) {
  const mode = env.BASE_METADATA_INGESTION ?? "rpc";
  if (!["rpc", "unified", "native"].includes(mode))
    throw new Error("Invalid Base metadata ingestion mode.");
  if (
    mode === "native" &&
    (env.OWNERSHIP_READ_MODE !== "unified" ||
      env.METADATA_SOURCE_MODE !== "archive")
  )
    throw new Error(
      "Native Base metadata requires unified ownership and archived metadata."
    );
  return mode as "rpc" | "unified" | "native";
}
export function nativeBaseMetadataReads() {
  const native = baseMetadataIngestionMode() === "native";
  if (native && !unifiedOwnershipReads)
    throw new Error(
      "Native Base metadata requires its registered read schema."
    );
  return native;
}
export const baseMetadataEventsRelation = () =>
  nativeBaseMetadataReads()
    ? `${ponderSchema}.base_metadata_event`
    : "metadata_source.chain_metadata_event";
export const baseMetadataScanRelation = () =>
  nativeBaseMetadataReads()
    ? `${ponderSchema}.base_metadata_scan`
    : "metadata_source.chain_metadata_scan";
export const baseMetadataEventKeySql = (alias: string) => {
  if (!/^[a-z_]+$/.test(alias))
    throw new Error("Invalid Base metadata event alias.");
  return `${alias}.transaction_hash||':'||${alias}.log_index::text`;
};
