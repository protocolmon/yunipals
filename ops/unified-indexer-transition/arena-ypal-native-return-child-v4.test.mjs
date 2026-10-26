import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { composition, FORMAT } from "./arena-ypal-native-return-child-v4.mjs";
import { returnSource } from "./arena-ypal-native-return-child-v1.mjs";

const read = (name) => readFileSync(new URL(name, import.meta.url));
const template = read("./arena-ypal-native-return-child-v1.mjs");
const inverse = read("./arena-ypal-business-inverse-child-v4.mjs");
const original = read("./arena-ypal-business-inverse-child-v1.mjs");
const transactions = read("./arena-modern-public-rollback-v1.mjs");
const old = await (await import("data:text/javascript;base64," + Buffer.from(returnSource(original)).toString("base64"))).composition(transactions);
const current = await composition(template, inverse, original, transactions);

test("actual native-return transaction/private/CAS/XID and delegated runtime bodies stay exact", () => {
  assert.equal(current.FORMAT, FORMAT);
  for (const key of Object.keys(old)) {
    if (typeof old[key] === "function" && key !== "authority") assert.equal(current[key].toString(), old[key].toString(), key);
  }
  assert.equal(current.authority.toString(), old.authority.toString().replace("native-return-authority-v1", "native-return-authority-v4"));
  assert.match(current.loadRuntime.toString(), /nativeReadPoolClient\(readPoolFd,payload.readPoolIdentity\)/);
  assert(!current.loadRuntime.toString().includes("publicReadPoolClient"));
});

test("every authenticated derivation layer refuses drift before runtime construction", async () => {
  for (const values of [
    [Buffer.concat([template, Buffer.from("\n")]), inverse, original],
    [template, Buffer.concat([inverse, Buffer.from("\n")]), original],
    [template, inverse, Buffer.concat([original, Buffer.from("\n")])]
  ]) await assert.rejects(composition(...values, transactions));
});

test("historical scanner stays closed and operational reconciliation remains ahead of source construction", () => {
  assert.equal(current.scanner, undefined);
  const source = current.loadRuntime.toString();
  assert(source.indexOf('if(action==="reconcile")') < source.indexOf("const support=payload.support"));
});
