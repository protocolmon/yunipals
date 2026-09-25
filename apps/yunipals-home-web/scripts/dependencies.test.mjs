import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const rainbowKit = createRequire(require.resolve("@rainbow-me/rainbowkit"));
const wagmi = createRequire(require.resolve("wagmi"));
const connectors = createRequire(wagmi.resolve("@wagmi/connectors"));
const walletConnect = createRequire(
  connectors.resolve("@walletconnect/ethereum-provider")
);
const walletUtils = createRequire(
  walletConnect.resolve("@walletconnect/utils")
);

test("RainbowKit can encode a WalletConnect pairing URI as a QR code", async () => {
  const { create } = await import(rainbowKit.resolve("cuer/QrCode"));
  const uri = `wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"0".repeat(64)}`;
  const qr = create(uri, { errorCorrection: "medium" });
  assert.ok(qr.edgeLength > 0);
  assert.equal(qr.edgeLength % 4, 1);
  assert.equal(qr.grid.length, qr.edgeLength);
  assert.ok(qr.grid.every((row) => row.length === qr.edgeLength));
  assert.ok(qr.grid[0].slice(0, 7).every(Boolean));
});

test("RainbowKit's parser still recognizes desktop download platforms", () => {
  const { UAParser } = rainbowKit("ua-parser-js");
  const cases = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Mac OS"],
    ["Mozilla/5.0 (X11; Linux x86_64)", "Linux"]
  ];
  for (const [userAgent, platform] of cases) {
    assert.equal(UAParser(userAgent).os.name, platform);
  }
});

test("WalletConnect query parsing preserves URI and Unicode round trips", () => {
  const queryString = walletUtils("query-string");
  const fields = {
    uri: "wc:test-topic@2?relay-protocol=irn&symKey=test-only",
    name: "Yuni 🌈",
    redirect: "https://example.invalid/return?chain=1&value=a+b"
  };
  assert.deepEqual(
    { ...queryString.parse(queryString.stringify(fields)) },
    fields
  );
  assert.equal(queryString.parse("bad=%EA%A0&ok=yes").bad, "%EA%A0");
});

test("malformed encoded input completes in a bounded subprocess", () => {
  // A separate process lets the timeout stop a synchronous decoder regression.
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
        const assert = require("node:assert/strict");
        const queryString = require(${JSON.stringify(walletUtils.resolve("query-string"))});
        const malformed = "%EA".repeat(4096);
        const decoded = queryString.parse("bad=" + malformed + "&ok=yes");
        assert.equal(decoded.bad, malformed);
        assert.equal(decoded.ok, "yes");
      `
    ],
    { timeout: 5000, encoding: "utf8" }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("MetaMask retains CommonJS UUID generation and validation", () => {
  const sdk = createRequire(connectors.resolve("@metamask/sdk"));
  const { v4, validate, version } = sdk("uuid");
  const id = v4();
  assert.equal(validate(id), true);
  assert.equal(version(id), 4);
  const buffer = new Uint8Array(16);
  assert.equal(v4({}, buffer), buffer);
});
