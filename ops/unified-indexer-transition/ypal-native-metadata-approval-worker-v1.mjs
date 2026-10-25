// A finite source transform over the genuine worker. No source file is edited.
import { createHash } from "node:crypto";

export const FORMAT = "yunipals-native-metadata-approval-worker-v1";
export const WORKER_SOURCE_SHA = "44d4edddc65d103739d0d61f53a73b1048d4665554c421732311c3c8b4e926c7";
export const SCHEDULER_FILE = "ypal-native-metadata-approval-scheduler-v1.mjs";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");

export function workerSource(raw, helperSpecifier) {
  if (sha(raw) !== WORKER_SOURCE_SHA) throw new Error("exact_frozen_metadata_archive_worker_required");
  if (typeof helperSpecifier !== "string" || !helperSpecifier.endsWith("/" + SCHEDULER_FILE) ||
      /[\u0000-\u001f]/.test(helperSpecifier)) throw new Error("literal_native_approval_scheduler_source_required");
  let source = raw.toString("utf8");
  const replace = (before, after, count = 1) => {
    if (source.split(before).length !== count + 1) throw new Error("exact_native_approval_worker_seams_required");
    source = source.split(before).join(after);
  };
  const guard = '      if (role === "full" && Date.now() >= nextBase) {';
  const start = source.indexOf(guard);
  const taskStart = source.indexOf("        try {", start);
  const taskEnd = source.indexOf("        nextBase = Date.now() + (nativeBase ? 2000 : 15000);", taskStart);
  if (start < 0 || taskStart < start || taskEnd < taskStart) throw new Error("exact_original_native_approval_reporting_body_required");
  const task = source.slice(taskStart, taskEnd);
  replace("let stopping = false,", "let nativeApproval: ReturnType<typeof startNativeApproval> | undefined;\nlet stopping = false,");
  replace("  stopping = true;", "  stopping = true;\n  nativeApproval?.requestStop();", 2);
  replace(guard, '      if (role === "full" && !nativeBase && Date.now() >= nextBase) {');
  replace("try {\n  while (!stopping) {", `nativeApproval = nativeBase ? startNativeApproval(async () => {\n${task}  }, {\n    onError: (error) => console.error("Metadata archive worker deferred", safeErrorMessage(error))\n  }) : undefined;\n\ntry {\n  while (!stopping) {`);
  replace("} finally {\n  await unifiedBase?.close();\n  await pool.end();\n}",
    "} finally {\n  try { await nativeApproval?.stop(); }\n  finally {\n    await unifiedBase?.close();\n    await pool.end();\n  }\n}");
  return `import { startNativeApproval } from ${JSON.stringify(helperSpecifier)};\n` + source;
}
