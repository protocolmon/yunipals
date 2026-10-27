// Transport for the exact frozen public reader closure. No business logic,
// credentials, database connections or changes to filesystem permissions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OPS = "/opt/yunipals-unified/operations/free-replay-20261020";
const PINS = Object.freeze({
  "ypal-native-cutover-v1.mjs":
    "950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7",
  "ypal-native-reader-probe-v1.mjs":
    "4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f",
  "ypal-native-cutover-v1.manifest.json":
    "efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168",
  "ypal-generation-recovery-v1.mjs":
    "b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21",
  "ypal-cache-guard-transition-v1.mjs":
    "6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2",
  "fixed-boundary-witness-v3.mjs":
    "bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c",
  "ownership-parity-peer-v4.mjs":
    "b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e",
  "ownership-parity-peer-v2.mjs":
    "d1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920"
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = fs.readFileSync.bind(fs);
const descriptor = Number(process.env.YUNIPALS_READER_PUBLIC_FD);
assert(
  Number.isSafeInteger(descriptor) && descriptor >= 3 && descriptor <= 4096
);
function descriptorBytes(fd, maximum) {
  const info = fs.fstatSync(fd);
  assert(info.isFile() && info.size > 0 && info.size <= maximum);
  const bytes = Buffer.alloc(info.size);
  let offset = 0;
  while (offset < bytes.length) {
    // Explicit positions preserve the parent's offsets, including if a caller
    // qualifies and then launches from the same immutable public descriptors.
    const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
    assert(count > 0);
    offset += count;
  }
  return bytes;
}
const metadataBytes = descriptorBytes(descriptor, 16384);
const metadata = JSON.parse(metadataBytes);
assert.deepEqual(Object.keys(metadata).sort(), ["files", "format"]);
assert.equal(metadata.format, "yunipals-reader-sealed-public-v1");
assert.equal(metadata.files.length, Object.keys(PINS).length);
const contents = new Map();
const descriptors = new Set([descriptor]);
for (const row of metadata.files) {
  assert.deepEqual(Object.keys(row).sort(), ["bytes", "fd", "name", "sha256"]);
  assert(Object.hasOwn(PINS, row.name));
  assert.equal(row.sha256, PINS[row.name]);
  assert(Number.isSafeInteger(row.fd) && row.fd >= 3 && row.fd <= 4096);
  assert(!descriptors.has(row.fd));
  descriptors.add(row.fd);
  assert(
    Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 1048576
  );
  const bytes = descriptorBytes(row.fd, 1048576);
  assert.equal(bytes.length, row.bytes);
  assert.equal(sha(bytes), row.sha256);
  const url = pathToFileURL(OPS + "/" + row.name).href;
  assert(!contents.has(url));
  contents.set(url, bytes);
}
assert.equal(contents.size, Object.keys(PINS).length);
delete process.env.YUNIPALS_READER_PUBLIC_FD;
// Everything is now a validated private copy; the descriptors have no further
// use, including by retained application imports or a future subprocess.
for (const fd of descriptors) fs.closeSync(fd);

function denied() {
  const error = new Error("unlisted_reader_public_operations_path_refused");
  error.code = "EACCES";
  throw error;
}
function operationsURL(input) {
  if (typeof input === "number") return null;
  const value = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  let url;
  if (value instanceof URL) url = value;
  else if (typeof value === "string") {
    if (value.startsWith("file:")) url = new URL(value);
    else if (value.startsWith("/")) url = pathToFileURL(resolve(value));
    else return null;
  } else return null;
  if (url.protocol !== "file:") return null;
  const path = fileURLToPath(url);
  if (path !== OPS && !path.startsWith(OPS + "/")) return null;
  if (url.search || url.hash || !contents.has(url.href)) denied();
  return url.href;
}
fs.readFileSync = function (path, options) {
  const url = operationsURL(path);
  if (!url) return read(path, options);
  const encoding = typeof options === "string" ? options : options?.encoding;
  // Return a copy so a caller cannot mutate subsequent self-hash evidence.
  const bytes = Buffer.from(contents.get(url));
  return encoding ? bytes.toString(encoding) : bytes;
};
syncBuiltinESMExports();
registerHooks({
  resolve(specifier, context, nextResolve) {
    let url;
    if (specifier.startsWith("file:")) url = new URL(specifier);
    else if (specifier.startsWith("/")) url = pathToFileURL(specifier);
    else if (
      specifier.startsWith(".") &&
      context.parentURL?.startsWith("file:")
    )
      url = new URL(specifier, context.parentURL);
    if (url && operationsURL(url)) return { url: url.href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const key = operationsURL(url);
    if (key) {
      assert(key.endsWith(".mjs"), "only_pinned_javascript_can_be_imported");
      return {
        format: "module",
        source: contents.get(key).toString("utf8"),
        shortCircuit: true
      };
    }
    return nextLoad(url, context);
  }
});
