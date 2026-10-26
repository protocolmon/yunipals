// Fresh return wire identity over the authenticated native-return transactions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const FORMAT = "yunipals-arena-ypal-native-return-child-v4";
export const TEMPLATE = "/opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-native-return-child-v1.mjs";
export const TEMPLATE_SHA = "d543fef4204dc4c5c16f9daa9c0f49f3c79f8e4045b4dcdd07225ba69516994b";
export const INVERSE_CHILD = "/opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-business-inverse-child-v4.mjs";
export const INVERSE_CHILD_SHA = "b583b93c2362ece3566bdab014bec2c1e85e2aa3cc8b3b3fe72f61cc3c6dcff6";
export const ORIGINAL_CHILD = "/opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-business-inverse-child-v1.mjs";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");

export async function nativeReturnSource(raw, inverseChild, originalChild) {
  if (sha(raw) !== TEMPLATE_SHA || sha(inverseChild) !== INVERSE_CHILD_SHA) throw Error("exact_native_return_and_inverse3_child_sources_required");
  const inverse = await import("data:text/javascript;base64," + inverseChild.toString("base64"));
  const fullInverse = Buffer.from(inverse.successorSource(originalChild));
  let source = raw.toString();
  const replacements = [
    ['export const FORMAT = "yunipals-arena-ypal-native-return-child-v1";', `export const FORMAT = ${JSON.stringify(FORMAT)};`],
    ['export const TEMPLATE_SHA = "1140edcb47428a104fdaa46cc8001b6d5d34671b33febb4f98dcb0353245d9ec";', `export const TEMPLATE_SHA = ${JSON.stringify(sha(fullInverse))};`],
    ['export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v1";', 'export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v4";'],
    ['a.format==="yunipals-arena-ypal-business-inverse-authority-v1"', 'a.format==="yunipals-arena-ypal-business-inverse-authority-v4"'],
    ['a.format==="yunipals-arena-ypal-native-return-authority-v1"', 'a.format==="yunipals-arena-ypal-native-return-authority-v4"']
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw Error("five_exact_native_return_child_identity_seams_required");
    source = source.replace(before, after);
  }
  const retained = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  return retained.returnSource(fullInverse);
}

export async function composition(raw = readFileSync(TEMPLATE), inverseChild = readFileSync(INVERSE_CHILD), originalChild = readFileSync(ORIGINAL_CHILD), transactionSource) {
  const source = await nativeReturnSource(raw, inverseChild, originalChild);
  const retained = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  return retained.composition(transactionSource);
}

export async function main(...descriptors) {
  return (await composition()).main(...descriptors);
}

// Import and direct execution perform no operation.
