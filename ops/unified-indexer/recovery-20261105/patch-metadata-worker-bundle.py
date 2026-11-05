#!/usr/bin/env python3
"""Apply the URI audit limit to the deployed metadata worker bundle.

Usage: patch-metadata-worker-bundle.py INPUT OUTPUT

INPUT is dist/metadata-worker.mjs from nonmarket-consumer-releases/7489372f...
The logic matches lib/metadata/bounded-read.ts, lib/metadata/uri-audit.ts and
lib/metadata/archive-worker.ts in apps/yunipals-indexer.
"""

import hashlib
import sys

INPUT_SHA256 = "dfabd70fb96e21ac5f9fa941308492fbbaf80aa08d7d9527fccf088815a4afb6"
OUTPUT_SHA256 = "bd253f1b70fafea720b594f8c991321959cac90680dd81149786dce493117304"

HELPER = """async function boundedRead(pool2, timeout, read) {
  const client = await pool2.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('statement_timeout',$1,true)", [timeout]);
    const result = await read(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
}
"""

ENTRY = "async function auditArchiveUris(pool2, readSchema, resolveUri2, limit = 128) {"

REPLACEMENTS = [
    (ENTRY, HELPER + ENTRY),
    (
        "  const rows = (await pool2.query(`SELECT m.collection,m.token_id::text,m.lifecycle,p.asset_key,m.token_uri",
        '  const rows = await boundedRead(pool2, "5min", async (client) => (await client.query(`SELECT m.collection,m.token_id::text,m.lifecycle,p.asset_key,m.token_uri',
    ),
    (
        "ORDER BY m.uri_checked_at NULLS FIRST,m.collection,m.token_id LIMIT $2`, [release, limit])).rows;",
        "ORDER BY m.uri_checked_at NULLS FIRST,m.collection,m.token_id LIMIT $2`, [release, limit])).rows);",
    ),
    (
        """            await auditArchiveUris(pool, readSchemaName, resolveUri);
            nextUri = Date.now() + 6e4;
""",
        """            try {
              await auditArchiveUris(pool, readSchemaName, resolveUri);
            } finally {
              nextUri = Date.now() + 6e4;
            }
""",
    ),
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    with open(sys.argv[1], "rb") as file:
        source = file.read()
    if sha256(source) != INPUT_SHA256:
        sys.exit("The input is not the reviewed metadata worker bundle.")
    text = source.decode("utf-8")
    if "boundedRead" in text:
        sys.exit("The input already defines boundedRead.")
    for before, after in REPLACEMENTS:
        if text.count(before) != 1:
            sys.exit(f"Expected exactly one match for: {before[:60]}")
        text = text.replace(before, after)
    output = text.encode("utf-8")
    if sha256(output) != OUTPUT_SHA256:
        sys.exit("The patched bundle does not match the tested artifact.")
    with open(sys.argv[2], "wb") as file:
        file.write(output)


if __name__ == "__main__":
    main()
