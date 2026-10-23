import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const YPAL_CONFIRMED_SHA256 =
  "3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c";
export const YPAL_PACKAGE_SHA256 =
  "12bad482e7f34aa0dcc51033ee115b177bac4874181b4b522513adf2a3944886";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");

// Build-time only. The fixed manifest contains the ten actual signed receipts;
// no address is inferred from future nonces or inherited VITE configuration.
export function ypalFrontendDeployment(packageRaw, confirmedRaw, requestedSha) {
  assert.equal(requestedSha, YPAL_CONFIRMED_SHA256);
  assert.equal(sha(packageRaw), YPAL_PACKAGE_SHA256);
  assert.equal(sha(confirmedRaw), YPAL_CONFIRMED_SHA256);
  const confirmed = JSON.parse(confirmedRaw);
  assert.equal(confirmed.format, "yunipals-ypal-fresh-deployment-confirmed-v1");
  assert.equal(confirmed.launchId, "base-ypal-v1");
  assert.equal(confirmed.chainId, 8453);
  assert.equal(confirmed.packageSha256, YPAL_PACKAGE_SHA256);
  assert.equal(confirmed.packTypeId, "1");
  assert.equal(Object.keys(confirmed.receipts).length, 10);
  assert(
    Object.values(confirmed.receipts).every((r) => r.status === "success")
  );
  return Object.freeze({
    manifestSha256: YPAL_CONFIRMED_SHA256,
    launchId: confirmed.launchId,
    chainId: confirmed.chainId,
    registry: confirmed.registry,
    engine: confirmed.engine,
    monsters: confirmed.monsters,
    paymentToken: confirmed.ypal,
    paymentSymbol: "YPAL",
    pmon: confirmed.pmon
  });
}
