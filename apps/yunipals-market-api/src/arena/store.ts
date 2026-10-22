import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Lab persistence with real transaction semantics. Each row is authenticated
// ciphertext, including unrevealed prompts. Never serve this directory via HTTP.
export class ArenaStore<T> {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;

  constructor(path: string, key: Buffer) {
    if (key.length !== 32)
      throw new Error("Arena storage requires a 256-bit key.");
    this.key = Buffer.from(key);
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = DELETE;
      CREATE TABLE IF NOT EXISTS arena_state (
        id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL
      );
    `);
  }

  private seal(id: string, value: T) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final()
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      "base64"
    );
  }

  private open(id: string, ciphertext: string): T {
    const data = Buffer.from(ciphertext, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12)
    );
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final()
      ]).toString("utf8")
    ) as T;
  }

  insert(id: string, state: T) {
    this.db
      .prepare("INSERT INTO arena_state VALUES (?, ?)")
      .run(id, this.seal(id, state));
  }

  read(id: string): T | null {
    const row = this.db
      .prepare("SELECT ciphertext FROM arena_state WHERE id = ?")
      .get(id) as { ciphertext: string } | undefined;
    return row ? this.open(id, row.ciphertext) : null;
  }

  ids() {
    const rows = this.db
      .prepare("SELECT id FROM arena_state ORDER BY rowid DESC")
      .all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  // No async work inside this transaction. Concurrent writers re-read the latest
  // committed row; the fourth submission and reveal happen in the same commit.
  update<R>(id: string, action: (state: T | null) => R): R {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.read(id);
      const result = action(state);
      if (state)
        this.db
          .prepare("UPDATE arena_state SET ciphertext = ? WHERE id = ?")
          .run(this.seal(id, state), id);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}
