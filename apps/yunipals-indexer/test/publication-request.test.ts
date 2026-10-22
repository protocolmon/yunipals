import { describe, it, expect } from "vitest";
import { publicationRequestKey } from "../lib/metadata/publication-request.js";

describe("publication request migration compatibility", () => {
  const base = {
    asset_key: "asset",
    input_hash: "binding",
    event_transaction: null,
    event_log: null,
    event_block_hash: null
  };
  it("preserves installed non-Base and legacy Base request identities", () => {
    expect(publicationRequestKey(base)).toBe(
      "56ff424b77d558b034e9b96d7db8a94fefbdacf0ac994cb95dab4a69ce587394"
    );
    const event = {
      ...base,
      event_transaction: "0x1234",
      event_log: 7,
      event_block_hash: "block-a"
    };
    expect(publicationRequestKey(event)).toBe(
      "be30b9a66ee11751adc6d804bacf5a319690241e19a00c17c1e14380fe60a6e9"
    );
    expect(
      publicationRequestKey({ ...event, event_block_hash: "block-b" })
    ).toBe(publicationRequestKey(event));
  });
  it("requires fresh native Base work for a different inclusion of the same event", () => {
    const event = {
      ...base,
      event_transaction: "0x1234",
      event_log: 7,
      event_block_hash: "block-a"
    };
    expect(publicationRequestKey(event, true)).not.toBe(
      publicationRequestKey(event)
    );
    expect(
      publicationRequestKey({ ...event, event_block_hash: "block-b" }, true)
    ).not.toBe(publicationRequestKey(event, true));
  });
});
