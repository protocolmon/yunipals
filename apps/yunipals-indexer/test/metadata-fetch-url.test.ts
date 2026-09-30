import { describe, expect, it } from "vitest";
import { metadataFetchUrl } from "../lib/uri/fetch-url.js";

describe("metadataFetchUrl", () => {
  it("maps the Base contract's unavailable metadata alias to the live origin", () => {
    expect(metadataFetchUrl("https://meta.yunipals.com/meta?id=1000156857"))
      .toBe("https://meta.polkamon.com/meta?id=1000156857");
  });

  it("does not rewrite unrelated metadata URLs", () => {
    expect(metadataFetchUrl("https://example.test/metadata/1"))
      .toBe("https://example.test/metadata/1");
  });
});
