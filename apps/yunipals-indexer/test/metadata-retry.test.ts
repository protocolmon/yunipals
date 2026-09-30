import { describe, expect, it } from "vitest";
import { MetadataHttpError, metadataRetry } from "../lib/metadata/retry.js";

describe("metadata retry classification", () => {
  it("keeps first and unrelated failures retryable", () => {
    expect(metadataRetry(new MetadataHttpError(404), 1, null).fetchStatus).toBe("retry");
    expect(metadataRetry(new MetadataHttpError(404), 40, "Metadata HTTP 503").fetchStatus).toBe("retry");
    expect(metadataRetry(new MetadataHttpError(503), 40, "Metadata HTTP 404").fetchStatus).toBe("retry");
    expect(metadataRetry(new Error("timeout"), 40, "Metadata HTTP 404").fetchStatus).toBe("retry");
  });
  it("rechecks persistently missing documents weekly rather than inventing success", () => {
    const result = metadataRetry(new MetadataHttpError(404), 45, "Metadata HTTP 404");
    expect(result).toEqual({ fetchStatus: "not_found", lastError: "Metadata HTTP 404", delaySeconds: 604800 });
    expect(metadataRetry(new MetadataHttpError(404), 46, result.lastError)).toEqual(result);
  });
  it("retains bounded retries for server errors after a not-found observation", () => {
    expect(metadataRetry(new MetadataHttpError(500), 46, "Metadata HTTP 404")).toEqual({
      fetchStatus: "retry", lastError: "Metadata HTTP 500", delaySeconds: 61440
    });
  });
});
