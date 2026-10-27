import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { composition, successorSource, FORMAT } from "./arena-ypal-business-inverse-child-v2.mjs";
import { composition as previous } from "./arena-ypal-business-inverse-child-v1.mjs";

const child = readFileSync(new URL("./arena-ypal-business-inverse-child-v1.mjs", import.meta.url));
const transactions = readFileSync(new URL("./arena-modern-public-rollback-v1.mjs", import.meta.url));
const current = await composition(child, transactions);
const old = await previous(transactions);

test("all transaction/private/CAS/XID and runtime functions remain exact", () => {
  assert.equal(current.FORMAT, FORMAT);
  for (const name of Object.keys(old)) {
    if (typeof old[name] === "function" && name !== "authority") assert.equal(current[name].toString(), old[name].toString(), name);
  }
  assert.equal(current.authority.toString(), old.authority.toString().replace("business-inverse-authority-v1", "business-inverse-authority-v2"));
});

test("only two byte-counted child identity literals change", () => {
  assert.equal(successorSource(child), child.toString().replace(
    'export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v1";',
    'export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v2";'
  ).replace('a.format==="yunipals-arena-ypal-business-inverse-authority-v1"', 'a.format==="yunipals-arena-ypal-business-inverse-authority-v2"'));
});

test("source drift refuses before construction and no scanner returns", async () => {
  await assert.rejects(composition(Buffer.concat([child, Buffer.from("\n")]), transactions));
  assert.equal(current.scanner, undefined);
  assert.match(current.loadRuntime.toString(), /publicReadPoolClient\(readPoolFd,payload.readPoolIdentity\)/);
  assert(!current.loadRuntime.toString().includes("new pg.Pool(readonly"));
});
