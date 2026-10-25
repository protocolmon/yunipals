// New owner wire identity over the authenticated, unchanged transactions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v2";
export const TEMPLATE = "/opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-business-inverse-child-v1.mjs";
export const TEMPLATE_SHA = "1140edcb47428a104fdaa46cc8001b6d5d34671b33febb4f98dcb0353245d9ec";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");

export function successorSource(raw) {
  if (sha(raw) !== TEMPLATE_SHA) throw Error("exact_original_inverse_child_source_required");
  let source = raw.toString("utf8");
  const changes = new Map([
    ['export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v1";', `export const FORMAT = ${JSON.stringify(FORMAT)};`],
    ['a.format===\"yunipals-arena-ypal-business-inverse-authority-v1\"', 'a.format===\"yunipals-arena-ypal-business-inverse-authority-v2\"']
  ]);
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw Error("two_exact_inverse_child_identity_seams_required");
    source = source.replace(before, after);
  }
  return source;
}

export async function composition(raw = readFileSync(TEMPLATE), transactionSource) {
  const retained = await import("data:text/javascript;base64," + Buffer.from(successorSource(raw)).toString("base64"));
  return retained.composition(transactionSource);
}

export async function main(...descriptors) {
  return (await composition()).main(...descriptors);
}

// Import and direct execution perform no operation.
