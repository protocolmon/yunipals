import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const schema = process.env.DATABASE_SCHEMA;
const connection = process.env.DATABASE_URL;
if (!schema || !/^[a-z_][a-z0-9_]*$/.test(schema) || !connection) {
  throw new Error("DATABASE_URL and a valid DATABASE_SCHEMA are required");
}
const backupRoot =
  process.env.ISLANDS_BACKUP_DIR ?? "/var/backups/yunipals-islands-indexer";
const directory = join(
  backupRoot,
  new Date().toISOString().replace(/[:.]/g, "-")
);
await mkdir(backupRoot, { recursive: true, mode: 0o700 });
await mkdir(directory, { mode: 0o700 });
const pool = new pg.Pool({ connectionString: connection, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (
    await client.query<{ snapshot: string }>(
      "SELECT pg_export_snapshot() AS snapshot"
    )
  ).rows[0]!.snapshot;
  const sources = await client.query(
    `SELECT b.* FROM metadata_source.source_blob b
      WHERE EXISTS(SELECT 1 FROM metadata_source.island_revision r WHERE r.source_hash=b.content_hash)
      ORDER BY b.content_hash`
  );
  const readiness = await client.query(
    "SELECT * FROM metadata.chain_readiness WHERE collection='ethereum-islands'"
  );
  await writeFile(
    join(directory, "sources.json"),
    JSON.stringify(sources.rows) + "\n",
    { mode: 0o600 }
  );
  await writeFile(
    join(directory, "readiness.json"),
    JSON.stringify(readiness.rows) + "\n",
    { mode: 0o600 }
  );
  const url = new URL(connection);
  for (const [name, filters] of [
    ["islands.dump", [`--schema=${schema}`]],
    [
      "publication.dump",
      [
        "--table=metadata_source.island_revision",
        "--table=metadata.island_publication",
        "--table=metadata.island_verification"
      ]
    ]
  ] as const) {
    const dump = join(directory, name);
    await writeFile(dump, "", { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const dumpProcess = spawn(
        "/usr/bin/pg_dump",
        [
          "--format=custom",
          `--snapshot=${snapshot}`,
          `--file=${dump}`,
          ...filters
        ],
        {
          stdio: ["ignore", "ignore", "inherit"],
          env: {
            ...process.env,
            PGHOST: url.hostname,
            PGPORT: url.port || "5432",
            PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
            PGUSER: decodeURIComponent(url.username),
            PGPASSWORD: decodeURIComponent(url.password)
          }
        }
      );
      dumpProcess.once("error", reject);
      dumpProcess.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Islands pg_dump exited with ${code}`));
      });
    });
  }
  const files: Record<string, string> = {};
  for (const name of [
    "islands.dump",
    "publication.dump",
    "sources.json",
    "readiness.json"
  ]) {
    files[name] = createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex");
  }
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({ schema, sourceBlobs: sources.rowCount, files }, null, 2) +
      "\n",
    { mode: 0o600 }
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ event: "islands_backup_complete", directory }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
