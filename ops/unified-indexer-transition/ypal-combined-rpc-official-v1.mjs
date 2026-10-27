/** Execute the pinned official policy CLI; rehearsal changes only COMMIT to ROLLBACK. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

export const release =
  "/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6";
export const officialSha =
  "f7dc476dc2ac20ee6d05b94dee73126c2221f26f2ac9dbef1524e50d22e30669";
export const approval =
  "/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-v1/approval.json";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
export function officialProgram(raw, phase, root = release) {
  if (
    sha(raw) !== officialSha ||
    !["review", "rehearse", "commit"].includes(phase)
  )
    throw Error("exact_official_cli_and_phase_required");
  let text = raw.toString();
  const replacements = [
    [
      'from "pg"',
      `from ${JSON.stringify(pathToFileURL(root + "/apps/yunipals-market-api/node_modules/pg/lib/index.js").href)}`
    ],
    [
      '"../../../packages/yunipals-indexer-server/src/rpc-policy.js"',
      JSON.stringify(
        pathToFileURL(
          root + "/packages/yunipals-indexer-server/src/rpc-policy.ts"
        ).href
      )
    ],
    [
      '"../../../packages/yunipals-indexer-server/src/identity.js"',
      JSON.stringify(
        pathToFileURL(
          root + "/packages/yunipals-indexer-server/src/identity.ts"
        ).href
      )
    ]
  ];
  for (const [before, after] of replacements) {
    if (text.split(before).length !== 2)
      throw Error("exact_official_import_required");
    text = text.replace(before, after);
  }
  if (phase === "rehearse") {
    if (
      text.split('await client.query("COMMIT");').length !== 2 ||
      text.split('event: "unified_rpc_policy_approved"').length !== 2
    )
      throw Error("single_official_commit_required");
    text = text
      .replace(
        'await client.query("COMMIT");',
        'await client.query("ROLLBACK");'
      )
      .replace(
        'event: "unified_rpc_policy_approved"',
        'event: "unified_rpc_policy_rehearsed"'
      );
  }
  return stripTypeScriptTypes(text, { mode: "strip" });
}
export async function main(args = process.argv.slice(2)) {
  const [phase, reviewHash] = args;
  if (
    args.length !== (phase === "review" ? 1 : 2) ||
    (phase !== "review" && !/^0x[0-9a-f]{64}$/.test(reviewHash ?? ""))
  )
    throw Error("fixed_official_phase_arguments_required");
  const source = readFileSync(
    release + "/apps/yunipals-market-api/scripts/review-unified-rpc-policy.ts"
  );
  const code = officialProgram(source, phase);
  process.argv = [
    process.argv[0],
    "official-policy-review",
    "--file",
    approval,
    ...(phase === "review" ? [] : ["--apply", reviewHash])
  ];
  await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error("fixed_official_policy_execution_failed");
    process.exitCode = 1;
  });
}
