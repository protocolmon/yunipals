import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { parseArgs, parseEnv } from "node:util";
import pg from "pg";

export function argumentsOf(extra: Record<string, { type: "string" | "boolean"; default?: string | boolean }> = {}): Record<string, string | boolean | undefined> {
  return parseArgs({ options: {
    "legacy-root": { type: "string" },
    "env-file": { type: "string", default: ".env" },
    ...extra
  }, strict: true }).values;
}

export async function environmentFrom(path: string) {
  return parseEnv(await readFile(resolve(path), "utf8")) as Record<string, string>;
}

export async function postgresFrom(path: string) {
  const env = await environmentFrom(path);
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL missing from selected environment file");
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2,
    application_name: "metadata_migration", connectionTimeoutMillis: 5_000,
    statement_timeout: 120_000, lock_timeout: 2_000 });
  return { pool, env };
}

/** libpq tools get credentials through their environment, never argv/logs. */
export function postgresToolEnvironment(connectionString: string) {
  const connection = new URL(connectionString);
  const sslmode = connection.searchParams.get("sslmode") ?? "prefer";
  if (!["disable","allow","prefer","require","verify-ca","verify-full"].includes(sslmode)) throw new Error("Unsupported SSL mode");
  return { ...process.env, PGHOST:connection.hostname, PGPORT:connection.port || "5432",
    PGDATABASE:decodeURIComponent(connection.pathname.slice(1)), PGUSER:decodeURIComponent(connection.username),
    PGPASSWORD:decodeURIComponent(connection.password), PGSSLMODE:sslmode, PGAPPNAME:"metadata-recovery" };
}

export async function writeReport(path: string, data: unknown) {
  const full = resolve(path);
  await mkdir(dirname(full), { recursive: true });
  const temporary = `${full}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, full);
}

export function safeFailure(error: unknown) {
  // Driver errors may include credentials, server URLs or source payloads.
  if (error instanceof Error) {
    const code = "code" in error && /^[A-Z0-9_]+$/i.test(String(error.code)) ? ` (${error.code})` : "";
    return `${error.name}${code}; operation failed, report remains resumable`;
  }
  return "Migration operation failed";
}

export type SourceDocument = Record<string, any>;
type Cursor = {
  toArray(): Promise<SourceDocument[]>;
  sort(sort: Record<string, number>): Cursor;
  limit(limit: number): Cursor;
  hint(hint: Record<string, number> | string): Cursor;
};
export type SourceCollection = {
  find(query: SourceDocument, options?: SourceDocument): Cursor;
  findOne(query: SourceDocument, options?: SourceDocument): Promise<SourceDocument | null>;
  aggregate(pipeline: SourceDocument[], options?: SourceDocument): Cursor;
  estimatedDocumentCount(): Promise<number>;
  listIndexes(): Cursor;
};
export type SourceDatabase = {
  collection(name: string): SourceCollection;
  listCollections(query?: SourceDocument, options?: SourceDocument): Cursor;
};

// The Mongo driver is deliberately loaded only by migration commands, from the
// explicitly selected legacy installation. Neither runtime service imports it.
export async function legacyMongo(root: string) {
  if (!root || root === "undefined") throw new Error("--legacy-root is required");
  const env = await environmentFrom(join(root, ".env"));
  if (!env.ONE_COLLECTION_MONGO_URI) throw new Error("Legacy NFT Mongo source is not configured");
  const require = createRequire(join(resolve(root), "package.json"));
  const driver = require("mongodb") as {
    MongoClient: new (url: string, options: SourceDocument) => {
      connect(): Promise<void>; close(): Promise<void>; db(name: string): SourceDatabase;
    };
    ObjectId: new (value: string) => unknown;
    BSON: { EJSON: { serialize(value: unknown, options: { relaxed: boolean }): SourceDocument } };
  };
  const client = new driver.MongoClient(env.ONE_COLLECTION_MONGO_URI,
    { maxPoolSize: 1, serverSelectionTimeoutMS: 5_000, appName: "metadata-migration-read-only" });
  await client.connect();
  return { client, driver, env, db: client.db("nfts") };
}
