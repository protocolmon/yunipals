import { describe, expect, it } from "vitest";
import { baseMetadataIngestionMode } from "../lib/metadata/base-mode.js";

describe("Base metadata ingestion selection", () => {
  it("keeps existing RPC and finalized consumer selection explicit", () => {
    expect(baseMetadataIngestionMode({})).toBe("rpc");
    expect(
      baseMetadataIngestionMode({ BASE_METADATA_INGESTION: "unified" })
    ).toBe("unified");
    expect(() =>
      baseMetadataIngestionMode({ BASE_METADATA_INGESTION: "other" })
    ).toThrow();
  });
  it("requires native metadata to share the selected ownership release and archive", () => {
    const native = {
      BASE_METADATA_INGESTION: "native",
      OWNERSHIP_READ_MODE: "unified",
      METADATA_SOURCE_MODE: "archive"
    };
    expect(baseMetadataIngestionMode(native)).toBe("native");
    expect(() =>
      baseMetadataIngestionMode({ ...native, OWNERSHIP_READ_MODE: "legacy" })
    ).toThrow();
    expect(() =>
      baseMetadataIngestionMode({
        ...native,
        METADATA_SOURCE_MODE: "legacy-http"
      })
    ).toThrow();
  });
});
