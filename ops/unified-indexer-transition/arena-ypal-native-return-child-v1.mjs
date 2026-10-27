// Fresh return to accepted native readers; retain the completed inverse's SQL.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const FORMAT = "yunipals-arena-ypal-native-return-child-v1";
export const TEMPLATE = "/opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-business-inverse-child-v1.mjs";
export const TEMPLATE_SHA = "1140edcb47428a104fdaa46cc8001b6d5d34671b33febb4f98dcb0353245d9ec";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");

export function returnSource(raw) {
  if (sha(raw) !== TEMPLATE_SHA) throw Error("exact_completed_inverse_child_source_required");
  let source = raw.toString("utf8");
  const replace = (before, after, count = 1) => {
    if (source.split(before).length !== count + 1) throw Error("exact_native_return_child_seam_required");
    source = source.split(before).join(after);
  };
  replace('export const FORMAT = "yunipals-arena-ypal-business-inverse-child-v1";', `export const FORMAT = ${JSON.stringify(FORMAT)};`);
  replace('a.format==="yunipals-arena-ypal-business-inverse-authority-v1"', 'a.format==="yunipals-arena-ypal-native-return-authority-v1"');
  replace('publicReadPoolClient', 'nativeReadPoolClient', 3);
  replace('payload.targetKind==="legacy_rollback" && payload.readPoolKind==="target"', 'payload.targetKind==="unified" && payload.readPoolKind==="native"');
  replace('actual_root_delegated_shared_target_pool_without_new_reader_connection_required', 'actual_root_delegated_shared_native_pool_without_new_reader_connection_required');
  replace('application_name:"arena_ypal_business_inverse_owner"', 'application_name:"arena_ypal_native_return_owner"');
  return source;
}

export async function composition(raw = readFileSync(TEMPLATE)) {
  const successor = await import("data:text/javascript;base64," + Buffer.from(returnSource(raw)).toString("base64"));
  return successor.composition();
}

export async function main(...descriptors) {
  return (await composition()).main(...descriptors);
}

// Import and default execution perform no runtime or database work.
