import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { BnbOrderError } from "@/bnb/orders";
import { transaction } from "@/db/pool";

export const snapshotLimits = {
  retentionMs: 300000,
  reuseMs: 5000,
  perQueryRows: 10000,
  snapshots: 1000,
  totalRows: 50000,
  totalBytes: 64 * 1024 * 1024,
  responseBytes: 1024 * 1024
} as const;

export type SnapshotPageRequest = {
  limit: number;
  snapshot?: string;
  cursor?: string;
};
export type SnapshotRow = {
  id: string;
  header: Record<string, unknown>;
  observed_at: Date;
  row_count: string;
};
type SnapshotContents = {
  header: Record<string, unknown>;
  items: Record<string, unknown>[];
};

export function parsePageRequest(params: URLSearchParams): SnapshotPageRequest {
  const limit = params.get("limit") ?? "25";
  const snapshot = params.get("snapshot") ?? undefined;
  const cursor = params.get("cursor") ?? undefined;
  if (
    !/^[1-9][0-9]?$/.test(limit) ||
    Number(limit) > 25 ||
    (snapshot === undefined) !== (cursor === undefined) ||
    [snapshot, cursor].some(
      (value) => value !== undefined && !/^[a-zA-Z0-9_-]{1,256}$/.test(value)
    )
  )
    throw new BnbOrderError("invalid_pagination", 400);
  return { limit: Number(limit), snapshot, cursor };
}

function cursorFor(id: string, query: string, offset: number, limit: number) {
  // Public pagination, not a bearer credential. Its complete scope is checked
  // against the stored snapshot; no cursor can select another wallet's query.
  return Buffer.from(
    JSON.stringify([
      id,
      createHash("sha256").update(query).digest("hex"),
      offset,
      limit
    ])
  ).toString("base64url");
}

function cursorOffset(request: SnapshotPageRequest, query: string) {
  if (!request.cursor) return 0;
  try {
    const data: unknown = JSON.parse(
      Buffer.from(request.cursor, "base64url").toString()
    );
    if (!Array.isArray(data) || data.length !== 4) throw new Error();
    const offset: unknown = data[2];
    if (
      !Number.isSafeInteger(offset) ||
      typeof offset !== "number" ||
      offset <= 0 ||
      offset >= snapshotLimits.perQueryRows ||
      cursorFor(request.snapshot!, query, offset, request.limit) !==
        request.cursor
    )
      throw new Error();
    return offset;
  } catch {
    throw new BnbOrderError("snapshot_refresh_required", 409);
  }
}

export async function readSnapshotPage(
  pool: Pool,
  kind: "orders" | "catalog" | "activity",
  query: string,
  request: SnapshotPageRequest,
  build: (db: PoolClient, observedAt: Date) => Promise<SnapshotContents>,
  validate?: (
    db: Pick<PoolClient, "query">,
    row: SnapshotRow & { items: Record<string, unknown>[] }
  ) => Promise<void>
) {
  const offset = cursorOffset(request, query);
  const id =
    request.snapshot ??
    (await transaction(pool, async (db) => {
      // Serializable predicates protect capacity even when a transaction acquired
      // its MVCC snapshot just before the previous allocator committed. A conflict
      // fails this request and rolls back all rows; clients may retry.
      await db.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const lock = await db.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(732061,4) AS acquired"
      );
      if (!lock.rows[0]?.acquired)
        throw new BnbOrderError("snapshot_busy", 503);
      const nowResult = await db.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now"
      );
      const observedAt = nowResult.rows[0]!.now;
      const reusable = await db.query<SnapshotRow>(
        `SELECT id,header,observed_at,row_count::text FROM yunipals_market.snapshot
      WHERE kind=$1 AND query_key=$2 AND invalidated_at IS NULL
        AND observed_at BETWEEN $3::timestamptz-interval '5 seconds' AND $3
        AND expires_at>$3 ORDER BY observed_at DESC LIMIT 1`,
        [kind, query, observedAt]
      );
      if (reusable.rows[0]) return reusable.rows[0].id;
      await db.query(
        `DELETE FROM yunipals_market.snapshot WHERE id IN
      (SELECT id FROM yunipals_market.snapshot WHERE expires_at<=$1 OR invalidated_at IS NOT NULL
        ORDER BY expires_at LIMIT 1000)`,
        [observedAt]
      );
      const size = await db.query<{
        count: string;
        rows: string;
        bytes: string;
      }>(
        `SELECT count(*)::text AS count,coalesce(sum(row_count),0)::text AS rows,
      coalesce(sum(byte_count),0)::text AS bytes FROM yunipals_market.snapshot`
      );
      const capacity = size.rows[0]!;
      if (Number(capacity.count) >= snapshotLimits.snapshots)
        throw new BnbOrderError("snapshot_capacity", 503);
      const contents = await build(db, observedAt);
      const bytes =
        Buffer.byteLength(JSON.stringify(contents.header)) +
        contents.items.reduce(
          (sum, item) => sum + Buffer.byteLength(JSON.stringify(item)),
          0
        );
      if (
        contents.items.length > snapshotLimits.perQueryRows ||
        Number(capacity.rows) + contents.items.length >
          snapshotLimits.totalRows ||
        Number(capacity.bytes) + bytes > snapshotLimits.totalBytes
      )
        throw new BnbOrderError("snapshot_capacity", 503);
      const snapshotId = randomUUID();
      await db.query(
        `INSERT INTO yunipals_market.snapshot(id,kind,query_key,header,observed_at,expires_at,row_count,byte_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          snapshotId,
          kind,
          query,
          contents.header,
          observedAt,
          new Date(observedAt.getTime() + snapshotLimits.retentionMs),
          contents.items.length,
          bytes
        ]
      );
      if (contents.items.length)
        await db.query(
          `INSERT INTO yunipals_market.snapshot_item(snapshot_id,ordinal,payload)
      SELECT $1,ordinal-1,payload FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS data(payload,ordinal)`,
          [snapshotId, JSON.stringify(contents.items)]
        );
      // Account for PostgreSQL's stored JSON text, including JSONB spacing. This
      // bounds retained payload bytes, not just the smaller wire representation.
      const stored = await db.query<{ byte_count: string }>(
        `UPDATE yunipals_market.snapshot s SET byte_count=octet_length(s.header::text)+coalesce(
        (SELECT sum(octet_length(i.payload::text)) FROM yunipals_market.snapshot_item i WHERE i.snapshot_id=s.id),0)
      WHERE s.id=$1 RETURNING byte_count::text`,
        [snapshotId]
      );
      if (
        Number(capacity.bytes) + Number(stored.rows[0]!.byte_count) >
        snapshotLimits.totalBytes
      )
        throw new BnbOrderError("snapshot_capacity", 503);
      return snapshotId;
    }));
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id
    )
  )
    throw new BnbOrderError("snapshot_refresh_required", 409);
  const read = async (db: Pick<PoolClient, "query">) => {
    const page = await db.query<
      SnapshotRow & { items: Record<string, unknown>[] }
    >(
      `SELECT s.id,s.header,s.observed_at,s.row_count::text,
    coalesce((SELECT jsonb_agg(i.payload ORDER BY i.ordinal) FROM yunipals_market.snapshot_item i
      WHERE i.snapshot_id=s.id AND i.ordinal>=$4 AND i.ordinal<$4+$5),'[]'::jsonb) AS items
    FROM yunipals_market.snapshot s WHERE s.id=$1 AND s.kind=$2 AND s.query_key=$3
      AND s.invalidated_at IS NULL AND s.expires_at>clock_timestamp()`,
      [id, kind, query, offset, request.limit]
    );
    const row = page.rows[0];
    if (
      !row ||
      (offset > 0 && offset >= Number(row.row_count)) ||
      row.items.length !==
        Math.min(request.limit, Number(row.row_count) - offset)
    )
      throw new BnbOrderError("snapshot_refresh_required", 409);
    if (validate) await validate(db, row);
    const next = offset + row.items.length;
    const { provenance: _provenance, ...header } = row.header;
    const result = {
      ...header,
      schemaVersion: 1 as const,
      snapshot: { id, observedAt: row.observed_at.toISOString() },
      items: row.items,
      nextCursor:
        next < Number(row.row_count)
          ? cursorFor(id, query, next, request.limit)
          : null
    };
    if (
      Buffer.byteLength(JSON.stringify(result)) > snapshotLimits.responseBytes
    )
      throw new BnbOrderError("response_capacity", 503);
    return result;
  };
  if (!validate) return read(pool);
  return transaction(pool, async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return read(db);
  });
}
