import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, open, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { argumentsOf, postgresFrom, postgresToolEnvironment, safeFailure, writeReport } from "./metadata/support.js";

const args = argumentsOf({ output: { type: "string" }, report: { type: "string" } });

async function main() {
  if (!args.output) throw new Error("--output is required");
  const output = resolve(String(args.output)), temporary = `${output}.${randomUUID()}.tmp`;
  await mkdir(dirname(output),{recursive:true});
  const { pool,env } = await postgresFrom(String(args["env-file"]));
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
    const observedAt = new Date().toISOString();
    const counts = (await client.query(`SELECT 'token_metadata' AS source,count(*)::text AS records FROM metadata.token_metadata
      UNION ALL SELECT 'metadata_revision',count(*)::text FROM metadata.metadata_revision`)).rows;
    const childEnv = postgresToolEnvironment(env.DATABASE_URL);
    const file = await open(temporary,"wx",0o600); await file.close();
    await new Promise<void>((done,reject) => {
      const child = spawn("pg_dump",["--format=custom","--no-owner","--no-acl",`--snapshot=${snapshot}`,
        "--table=metadata.token_metadata","--table=metadata.metadata_revision",`--file=${temporary}`],
      { env:childEnv,stdio:["ignore","ignore","ignore"] });
      child.once("error",reject);
      child.once("exit",code => code === 0 ? done() : reject(new Error("PostgreSQL cache backup failed")));
    });
    await client.query("COMMIT");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(temporary)) digest.update(chunk);
    const report = { format:"metadata-http-cache-pgdump-v1",observedAt,counts,
      sha256:digest.digest("hex"),bytes:(await stat(temporary)).size,output,
      restoreVerified:false,offHostCopyVerified:false };
    await link(temporary,output); // never replace an existing recovery file
    if (args.report) await writeReport(String(args.report),report);
    console.log(JSON.stringify(report));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); await unlink(temporary).catch(() => {}); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
