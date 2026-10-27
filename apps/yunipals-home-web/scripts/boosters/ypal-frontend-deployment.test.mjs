import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ypalFrontendDeployment,
  YPAL_CONFIRMED_SHA256
} from "./ypal-frontend-deployment.mjs";

const packageRaw = await readFile(
  new URL("../../public/boosters/ypal-fresh-launch-v1.json", import.meta.url)
);
const confirmedRaw = await readFile(
  new URL(
    "../../../../docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json",
    import.meta.url
  )
);

test("the actual signed YPAL deployment supplies all purchase and collection identities", () => {
  const actual = ypalFrontendDeployment(
    packageRaw,
    confirmedRaw,
    YPAL_CONFIRMED_SHA256
  );
  assert.equal(
    actual.paymentToken,
    "0xCd3709E84fc817b46196FA2D5b7202710AB51346"
  );
  assert.equal(actual.monsters, "0x7D62628806E7eeF76A354C7c48787879e3440b16");
  assert.equal(actual.engine, "0xDF4AaA47Fe0e8208b5a33c74898f834B2952189e");
  assert.equal(actual.registry, "0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3");
  assert.equal(actual.pmon, "0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7");
  assert.equal(actual.paymentSymbol, "YPAL");
  assert.equal(actual.chainId, 8453);
  assert(Object.isFrozen(actual));
});

test("a substituted token, receipt, package or unreviewed manifest pin cannot enable sales", () => {
  const original = JSON.parse(confirmedRaw);
  for (const mutate of [
    (x) => {
      x.ypal = "0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3";
    },
    (x) => {
      x.receipts.activate.status = "reverted";
    },
    (x) => {
      x.monsters = x.engine;
    },
    (x) => {
      x.chainId = 1;
    }
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() =>
      ypalFrontendDeployment(
        packageRaw,
        JSON.stringify(changed),
        YPAL_CONFIRMED_SHA256
      )
    );
  }
  assert.throws(() =>
    ypalFrontendDeployment(
      Buffer.from("{}"),
      confirmedRaw,
      YPAL_CONFIRMED_SHA256
    )
  );
  assert.throws(() =>
    ypalFrontendDeployment(packageRaw, confirmedRaw, "0".repeat(64))
  );
});
