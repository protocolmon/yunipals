import { describe, expect, it } from "vitest";
import { ownershipReadConfiguration } from "../lib/ownership/read-mode.js";

describe("ownership read selection", () => {
  const unified = {
    OWNERSHIP_READ_MODE: "unified",
    DATABASE_SCHEMA: "physical_candidate",
    OWNERSHIP_READ_SCHEMA: "read_candidate",
    OWNERSHIP_RELEASE_ID: `0x${"12".repeat(32)}`,
    YUNIPALS_PROJECTION_MODE: "generation"
  };
  it("preserves legacy defaults without selecting a candidate", () => {
    expect(ownershipReadConfiguration({})).toMatchObject({
      mode: "legacy",
      readSchema: "public",
      releaseId: null,
      bnbConfirmations: 20
    });
    expect(
      ownershipReadConfiguration({ READ_DATABASE_SCHEMA: "retained" })
        .readSchema
    ).toBe("retained");
  });
  it("requires an explicit release and distinct physical/logical schemas", () => {
    expect(ownershipReadConfiguration(unified)).toMatchObject({
      mode: "unified",
      readSchema: "read_candidate"
    });
    for (const override of [
      { OWNERSHIP_RELEASE_ID: undefined },
      { DATABASE_SCHEMA: undefined },
      { OWNERSHIP_READ_SCHEMA: "physical_candidate" },
      { READ_DATABASE_SCHEMA: "other" },
      { YUNIPALS_PROJECTION_MODE: "legacy" },
      { OWNERSHIP_READ_SCHEMA: 'bad"schema' }
    ])
      expect(() =>
        ownershipReadConfiguration({ ...unified, ...override })
      ).toThrow();
  });
  it("refuses accidental mixed modes and unsupported confirmation policies", () => {
    expect(() =>
      ownershipReadConfiguration({ ...unified, OWNERSHIP_READ_MODE: "legacy" })
    ).toThrow();
    expect(() =>
      ownershipReadConfiguration({ ...unified, OWNERSHIP_READ_MODE: "other" })
    ).toThrow();
    for (const value of ["0", "-1", "1.5", "1001", "x"])
      expect(() =>
        ownershipReadConfiguration({ ...unified, BNB_CONFIRMATIONS: value })
      ).toThrow();
    expect(
      ownershipReadConfiguration({ ...unified, BNB_CONFIRMATIONS: "30" })
        .bnbConfirmations
    ).toBe(30);
  });
});
