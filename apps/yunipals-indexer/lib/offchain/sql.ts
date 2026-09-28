export function sqlIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}

export const physicalPonderSchemaName = process.env.DATABASE_SCHEMA ?? "public";
export const readSchemaName = process.env.READ_DATABASE_SCHEMA ?? physicalPonderSchemaName;
export const bnbSchemaName = process.env.BNB_DATABASE_SCHEMA ?? "bnb_indexer";
export const physicalPonderSchema = sqlIdentifier(physicalPonderSchemaName);
export const ponderSchema = sqlIdentifier(readSchemaName);
export const bnbSchema = sqlIdentifier(bnbSchemaName);
