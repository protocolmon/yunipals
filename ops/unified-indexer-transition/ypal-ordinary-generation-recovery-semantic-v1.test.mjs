import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  recoverySemantics,
  schema
} from "./ypal-ordinary-generation-recovery-semantic-v1.mjs";

const require = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
);
const ts = require("typescript");
const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const before = source("ypal-ordinary-generation-recovery-v5.mjs");
const after = source("ypal-ordinary-generation-recovery-semantic-v1.mjs");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const parsed = (value) =>
  ts.createSourceFile(
    "component.mjs",
    value,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
const oldTree = parsed(before),
  newTree = parsed(after);
const printer = ts.createPrinter({ removeComments: true });
const emit = (node, tree) =>
  printer.printNode(ts.EmitHint.Unspecified, node, tree);

test("frozen a194 component remains immutable and new semantics have an explicit identity", () => {
  assert.equal(
    sha(before),
    "a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df"
  );
  assert.equal(schema, "ypal_generation_recovery_v1");
  assert.equal(
    recoverySemantics.format,
    "yunipals-generation-recovery-semantic-v1"
  );
  assert.equal(recoverySemantics.predecessorComponentSha256, sha(before));
  assert.deepEqual(recoverySemantics.aggregateIdentity, [
    "count",
    "sha256",
    "tuple_bytes"
  ]);
  assert.equal(recoverySemantics.allocatedBytes, "observation-only");
  assert.equal(recoverySemantics.predecessorStrictSuccessClaimed, false);
  assert(
    Object.isFrozen(recoverySemantics) &&
      Object.isFrozen(recoverySemantics.aggregateIdentity)
  );
});

test("all genuine capture, observe, context, catalog, guard and transaction functions remain exact", () => {
  const oldFunctions = oldTree.statements.filter(ts.isFunctionDeclaration);
  const newFunctions = new Map(
    newTree.statements
      .filter(ts.isFunctionDeclaration)
      .map((node) => [node.name.text, node])
  );
  assert.deepEqual(
    [...newFunctions.keys()].filter(
      (name) => !oldFunctions.some((node) => node.name.text === name)
    ),
    ["semanticAggregate", "aggregateObservation"]
  );
  for (const node of oldFunctions) {
    if (
      ["verifyGenerationRecovery", "restoreGenerationRecovery"].includes(
        node.name.text
      )
    )
      continue;
    assert.equal(
      emit(newFunctions.get(node.name.text), newTree),
      emit(node, oldTree),
      node.name.text
    );
  }
  const oldVariables = oldTree.statements.filter(ts.isVariableStatement);
  const newVariables = new Map(
    newTree.statements
      .filter(ts.isVariableStatement)
      .map((node) => [node.declarationList.declarations[0].name.text, node])
  );
  for (const node of oldVariables) {
    const name = node.declarationList.declarations[0].name.text;
    assert.equal(
      emit(newVariables.get(name), newTree),
      emit(node, oldTree),
      name
    );
  }
});

test("verify and restore differ only at four aggregate predicates and two telemetry objects", () => {
  const counts = { aggregatePredicates: 0, telemetryObjects: 0 };
  for (const name of [
    "verifyGenerationRecovery",
    "restoreGenerationRecovery"
  ]) {
    const oldNode = oldTree.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name.text === name
    );
    const newNode = newTree.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name.text === name
    );
    const transformed = ts.transform(newNode, [
      (context) => {
        const visit = (node) => {
          if (
            ts.isVariableStatement(node) &&
            node.declarationList.declarations.length === 1
          ) {
            const declaration = node.declarationList.declarations[0];
            if (
              ["walletStatsAllocation", "derivedStampsAllocation"].includes(
                declaration.name.text
              )
            ) {
              const call = declaration.initializer;
              assert(
                ts.isCallExpression(call) &&
                  call.expression.text === "aggregateObservation"
              );
              assert.equal(call.arguments.length, 3);
              counts.aggregatePredicates++;
              return ts.factory.createExpressionStatement(
                ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("assert"),
                    "deepEqual"
                  ),
                  undefined,
                  name === "verifyGenerationRecovery"
                    ? call.arguments.slice(0, 2)
                    : call.arguments
                )
              );
            }
          }
          if (
            ts.isObjectLiteralExpression(node) &&
            node.properties.some(
              (row) => row.name?.text === "recoverySemantics"
            )
          ) {
            assert(
              node.properties.some(
                (row) => row.name?.text === "allocationObservations"
              )
            );
            counts.telemetryObjects++;
            return ts.factory.updateObjectLiteralExpression(
              node,
              node.properties.filter(
                (row) =>
                  !["recoverySemantics", "allocationObservations"].includes(
                    row.name?.text
                  )
              )
            );
          }
          return ts.visitEachChild(node, visit, context);
        };
        return visit;
      }
    ]);
    try {
      assert.equal(
        emit(transformed.transformed[0], newTree),
        emit(oldNode, oldTree),
        name
      );
    } finally {
      transformed.dispose();
    }
  }
  assert.deepEqual(counts, { aggregatePredicates: 4, telemetryObjects: 2 });
});
