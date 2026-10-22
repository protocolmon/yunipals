import assert from "node:assert/strict";
import { test } from "node:test";

import { sharedBnbSaleRuntimeConfiguration } from "./sharedBnbReplay";

test("native BNB runtime policy follows deployment for owner, worker and API", () => {
  assert.deepEqual(sharedBnbSaleRuntimeConfiguration("production"), {
    confirmationPolicy: { kind: "finalized" },
    policy: "bnb-finalized-tag-v1"
  });
  assert.deepEqual(sharedBnbSaleRuntimeConfiguration("staging"), {
    confirmationPolicy: { kind: "depth", subsequentBlocks: 20 },
    policy: "bnb-local-validation-depth-20-v1"
  });
});
