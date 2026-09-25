import assert from "node:assert/strict";
import test from "node:test";

import { MarketApiError } from "@/lib/marketplace/marketApiError";
import { tradeErrorMessage } from "@/lib/marketplace/tradeError";

test("trade errors preserve API guidance without blaming the wallet", () => {
  for (const status of [409, 429, 503]) {
    const error = new MarketApiError(status);
    assert.equal(tradeErrorMessage(error), error.message);
    assert.doesNotMatch(tradeErrorMessage(error), /balance|network/);
  }
  assert.match(
    tradeErrorMessage(new Error("User rejected request")),
    /cancelled/
  );
  assert.match(
    tradeErrorMessage(new DOMException("timeout", "TimeoutError")),
    /took too long/
  );
  const provider = new Error("private provider payload");
  provider.name = "RpcRequestError";
  assert.doesNotMatch(tradeErrorMessage(provider), /private provider payload/);
});
