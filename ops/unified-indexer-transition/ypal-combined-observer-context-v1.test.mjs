import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  CONTEXTS,
  PUBLIC_PINS,
  SOURCE_PREFIX,
  pinPublicFile,
  publicResolver
} from "./ypal-combined-observer-context-v1.mjs";

const checks = [];
const test = (name, run) => {
  run();
  checks.push(name);
};
const source = SOURCE_PREFIX + "apps/yunipals-indexer/lib/unified/rpc.ts";
const pass = () => {};

test("esm_uses_exact_package_parent_and_preserves_node_conditions", () => {
  const conditions = ["node", "import", "module-sync", "node-addons"];
  const attributes = {};
  const checked = [];
  const resolved = {
    url: pathToFileURL(CONTEXTS.viem.import).href,
    format: "module"
  };
  const resolver = publicResolver((file, pin) => checked.push([file, pin]));
  assert.equal(
    resolver(
      "viem",
      { parentURL: source, conditions, importAttributes: attributes },
      (specifier, context) => {
        assert.equal(specifier, "viem");
        assert.equal(
          context.parentURL,
          pathToFileURL(CONTEXTS.viem.parent).href
        );
        assert.equal(context.conditions, conditions);
        assert.equal(context.importAttributes, attributes);
        return resolved;
      }
    ),
    resolved
  );
  assert.deepEqual(
    checked.map(([file]) => file),
    [CONTEXTS.viem.parent, CONTEXTS.viem.package, CONTEXTS.viem.import]
  );
  assert(checked.every(([file, pin]) => pin === PUBLIC_PINS[file]));
});

test("cjs_uses_fixed_public_createRequire_before_normal_next_resolve", () => {
  let requireCalls = 0;
  const conditions = ["require", "node", "node-addons", "module-sync"];
  const resolver = publicResolver(pass, (parent) => {
    assert.equal(parent, pathToFileURL(CONTEXTS.pg.parent).href);
    return {
      resolve: (specifier) => {
        requireCalls++;
        assert.equal(specifier, "pg");
        return CONTEXTS.pg.require;
      }
    };
  });
  resolver("pg", { parentURL: source, conditions }, (specifier, context) => {
    assert.equal(specifier, pathToFileURL(CONTEXTS.pg.require).href);
    assert.equal(context.conditions, conditions);
    assert.equal(context.parentURL, pathToFileURL(CONTEXTS.pg.parent).href);
    return { url: specifier, format: "commonjs" };
  });
  assert.equal(requireCalls, 1);
});

test("only_two_exact_bare_packages_and_physical008_parents_redirect", () => {
  const resolver = publicResolver(() => {
    throw Error("must_not_check");
  });
  for (const [specifier, parentURL] of [
    ["viem/chains", source],
    ["viem/accounts", source],
    ["pg/lib/index.js", source],
    ["node:net", source],
    ["__proto__", source],
    ["viem", SOURCE_PREFIX.slice(0, -1) + "-foreign/a.ts"],
    ["viem", pathToFileURL(CONTEXTS.viem.parent).href],
    ["pg", undefined]
  ]) {
    const context = { parentURL, conditions: ["import"] };
    const sentinel = {};
    assert.equal(
      resolver(specifier, context, (s, c) => {
        assert.equal(s, specifier);
        assert.equal(c, context);
        return sentinel;
      }),
      sentinel
    );
  }
});

test("wrong_resolved_entry_refuses_before_use", () => {
  for (const packageName of ["pg", "viem"])
    assert.throws(
      () =>
        publicResolver(pass)(
          packageName,
          { parentURL: source, conditions: ["import"] },
          () => ({ url: "file:///tmp/foreign.mjs" })
        ),
      /exact_public_dependency_entry_required/
    );
});

test("changed_pinned_package_or_entry_refuses", () => {
  for (const failure of [
    CONTEXTS.viem.parent,
    CONTEXTS.viem.package,
    CONTEXTS.viem.import
  ]) {
    const resolver = publicResolver((file) => {
      if (file === failure) throw Error("changed_dependency");
    });
    assert.throws(
      () =>
        resolver("viem", { parentURL: source, conditions: ["import"] }, () => ({
          url: pathToFileURL(CONTEXTS.viem.import).href
        })),
      /changed_dependency/
    );
  }
});

test("require_and_import_entries_are_distinct_exact_pins", () => {
  assert.equal(Object.keys(CONTEXTS).length, 2);
  assert.notEqual(CONTEXTS.viem.require, CONTEXTS.viem.import);
  assert.notEqual(
    PUBLIC_PINS[CONTEXTS.viem.require],
    PUBLIC_PINS[CONTEXTS.viem.import]
  );
  assert.equal(
    PUBLIC_PINS[CONTEXTS.viem.import],
    "ea32975364e9f2d599b10639d81985ec6a3ed87f6942fe0cb73b1bf738959057"
  );
  assert.equal(Object.keys(PUBLIC_PINS).length, 10);
});

test("real_file_guard_refuses_hash_or_writable_input", () => {
  // /root ancestry is protected; the temporary directory itself is private.
  const directory = mkdtempSync(
    path.join(process.cwd(), ".observer-context-test-")
  );
  try {
    const file = path.join(directory, "public.mjs");
    const bytes = Buffer.from("export const synthetic = true;\n");
    writeFileSync(file, bytes, { mode: 0o644 });
    chmodSync(file, 0o644);
    const pin = createHash("sha256").update(bytes).digest("hex");
    pinPublicFile(file, pin);
    assert.throws(
      () => pinPublicFile(file, "00".repeat(32)),
      /exact_public_dependency_bytes_required/
    );
    chmodSync(file, 0o666);
    assert.throws(
      () => pinPublicFile(file, pin),
      /protected_public_dependency_required/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

console.log(
  JSON.stringify({
    passed: true,
    checks,
    productionCalls: 0,
    databaseConnections: 0,
    providerCalls: 0
  })
);
