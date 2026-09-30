import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { argumentsOf, postgresFrom, postgresToolEnvironment, safeFailure, writeReport } from "./metadata/support.js";

const args = argumentsOf({ input: { type:"string" }, report: { type:"string" } });
async function main() {
  if (!args.input || !args.report) throw new Error("--input and its --report are required");
  const input = resolve(String(args.input)), reportFile = String(args.report);
  const report = z.object({ format:z.literal("metadata-http-cache-pgdump-v1"),sha256:z.string().regex(/^[a-f0-9]{64}$/),
    counts:z.array(z.object({ source:z.enum(["token_metadata","metadata_revision"]), records:z.string().regex(/^\d+$/) }))
  }).passthrough().parse(JSON.parse(await readFile(reportFile,"utf8")));
  assert.equal(report.counts.length,2);
  assert.equal(new Set(report.counts.map(row => row.source)).size,2);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(input)) digest.update(chunk);
  assert.equal(digest.digest("hex"),report.sha256,"Recovery file checksum differs from its report");
  const toc = (await promisify(execFile)("pg_restore",["--list",input])).stdout;
  const omittedTriggers: string[] = [];
  const filteredToc = toc.split("\n").filter(line => {
    if (!/^\d+;.* TRIGGER /.test(line)) return true;
    const match = line.match(/ TRIGGER metadata token_metadata (market_catalog_trait_(?:insert|update|delete)) /);
    assert.ok(match,"Unexpected trigger dependency in cache recovery archive");
    omittedTriggers.push(match[1]);
    return false;
  }).join("\n");
  const temporary = await mkdtemp(join(tmpdir(),"metadata-cache-restore-"));
  const tocFile = join(temporary,"restore.list");
  await writeFile(tocFile,filteredToc,{mode:0o600});
  const { pool,env } = await postgresFrom(String(args["env-file"]));
  try {
    const database = (await pool.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database,/^metadata_archive_test_[a-z0-9_]+$/,"Restore verification requires a disposable database");
    const existing = await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='metadata'");
    assert.equal(existing.rowCount,0,"Restore verification requires an absent metadata schema");
    await pool.query("CREATE SCHEMA metadata");
    await new Promise<void>((done,reject) => {
      const child = spawn("pg_restore",["--dbname",database,"--no-owner","--no-acl","--exit-on-error",`--use-list=${tocFile}`,input],
        { env:postgresToolEnvironment(env.DATABASE_URL),stdio:["ignore","ignore","ignore"] });
      child.once("error",reject);
      child.once("exit",code => code === 0 ? done() : reject(new Error("Cache restore verification failed")));
    });
    const actual = (await pool.query(`SELECT 'token_metadata' AS source,count(*)::text AS records FROM metadata.token_metadata
      UNION ALL SELECT 'metadata_revision',count(*)::text FROM metadata.metadata_revision`)).rows;
    const sorted = (rows: {source:string;records:string}[]) => [...rows].sort((a,b) => a.source.localeCompare(b.source));
    assert.deepEqual(sorted(actual),sorted(report.counts));
    await writeReport(reportFile,{...report,restoreVerified:true,restoreVerifiedAt:new Date().toISOString(),restoredCounts:actual,
      omittedApplicationTriggers:omittedTriggers,verificationScope:"Metadata records, revisions, constraints and indexes; application triggers require their owning marketplace schema"});
    console.log(JSON.stringify({ restoreVerified:true,counts:actual,omittedApplicationTriggers:omittedTriggers }));
  } finally { await pool.end(); await rm(temporary,{recursive:true,force:true}); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
