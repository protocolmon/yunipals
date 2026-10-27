import { ownershipReadConfiguration } from "../ownership/read-mode.js";

export function sqlIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}

export const physicalPonderSchemaName = process.env.DATABASE_SCHEMA ?? "public";
export const ownershipReadConfig = ownershipReadConfiguration();
export const unifiedOwnershipReads = ownershipReadConfig.mode === "unified";
export const readSchemaName = ownershipReadConfig.readSchema;
export const bnbSchemaName = process.env.BNB_DATABASE_SCHEMA ?? "bnb_indexer";
export const physicalPonderSchema = sqlIdentifier(physicalPonderSchemaName);
export const ponderSchema = sqlIdentifier(readSchemaName);
export const bnbSchema = sqlIdentifier(bnbSchemaName);
// DDL, Ponder and trigger installation keep using the physical constants above.
export const ownershipPonderSchema = unifiedOwnershipReads
  ? ponderSchema
  : physicalPonderSchema;
export const ownershipBnbSchema = unifiedOwnershipReads
  ? ponderSchema
  : bnbSchema;
export const ownershipIslandsSchemaName = unifiedOwnershipReads
  ? readSchemaName
  : physicalPonderSchemaName;

export function ownershipCollectionsFor<T extends string>(
  schema: string,
  chains: readonly T[]
): T[] {
  if (unifiedOwnershipReads) {
    if (schema !== ponderSchema)
      throw new Error(
        "Unified ownership reads require the selected logical schema."
      );
    return [...chains];
  }
  return chains.filter((chain) =>
    schema === bnbSchema
      ? chain === "bnb"
      : schema === physicalPonderSchema
        ? chain !== "bnb"
        : true
  );
}
export function ownershipBnbOnlySchema(schema: string) {
  return !unifiedOwnershipReads && schema === bnbSchema;
}
