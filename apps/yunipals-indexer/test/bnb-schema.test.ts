import { describe, expect, it } from "vitest";
import { bnbReadSchemaStatements } from "../lib/bnb/read-schema.js";

describe("BNB isolated read model", () => {
  it("creates restart-safe ingestion state and union views", () => {
    expect(bnbReadSchemaStatements.some((sql) => sql.includes("sync_state"))).toBe(true);
    expect(bnbReadSchemaStatements.some((sql) => sql.includes("CREATE OR REPLACE VIEW") && sql.includes(".token AS"))).toBe(true);
    expect(bnbReadSchemaStatements.some((sql) => sql.includes("UNION ALL") && sql.includes("bnb_indexer"))).toBe(true);
  });
});
