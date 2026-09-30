import { describe, expect, it } from "vitest";
import { assertRecoveryRuntimeEnvironment } from "../scripts/metadata/recovery.js";

describe("recovery runtime connection guard", () => {
  const selected = {
    DATABASE_URL: "postgresql://localhost/metadata_archive_test_recovery_example",
    DATABASE_SCHEMA: "recovery_chain",
    READ_DATABASE_SCHEMA: "recovery_read",
    METADATA_SOURCE_MODE: "archive",
    RARITY_READ_SOURCE: "local"
  };

  it("accepts the same recovery configuration in the CLI and runtime", () => {
    expect(() => assertRecoveryRuntimeEnvironment(selected, { ...selected })).not.toThrow();
  });

  it("rejects a different database or schema without disclosing connection values", () => {
    const otherUrl = "postgresql://private-user:private-password@localhost/live";
    expect(() => assertRecoveryRuntimeEnvironment(selected, { ...selected, DATABASE_URL: otherUrl }))
      .toThrow("Recovery runtime environment mismatch: DATABASE_URL");
    expect(() => assertRecoveryRuntimeEnvironment(selected, { ...selected, READ_DATABASE_SCHEMA: "live_read" }))
      .toThrow("Recovery runtime environment mismatch: READ_DATABASE_SCHEMA");
  });
});
