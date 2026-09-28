import { argumentsOf, postgresFrom, safeFailure } from "./metadata/support.js";
import { exportSources, restoreSources } from "./metadata/source-backup.js";

const args = argumentsOf({ release: { type: "string" }, output: { type: "string" }, input: { type: "string" } });
async function main() {
  if (!args.release || (!!args.output === !!args.input)) throw new Error("Provide --release and exactly one of --output or --input");
  const { pool } = await postgresFrom(String(args["env-file"]));
  try {
    console.log(JSON.stringify(args.output ? await exportSources(pool, String(args.release), String(args.output))
      : await restoreSources(pool, String(args.release), String(args.input))));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
