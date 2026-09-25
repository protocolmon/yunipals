import { catalogSql, parseCatalogRequest } from "../src/reads/catalogQuery.ts";

// Emit a read-only metadata-scale probe. This intentionally substitutes an empty
// orderbook so it can run on the existing indexer before marketplace deployment.
// It does not measure real order joins or assert provider completeness.
const chain =
  process.argv.find((arg) => arg.startsWith("--chain="))?.slice(8) ?? "all";
const phase =
  process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8) ?? "count";
if (
  !["all", "ethereum", "base", "polygon", "bnb"].includes(chain) ||
  !["count", "nonnull", "null-known", "null-missing"].includes(phase) ||
  process.argv
    .slice(2)
    .some((arg) => !arg.startsWith("--chain=") && !arg.startsWith("--phase="))
)
  throw new Error(
    "Use --chain=all|ethereum|base|polygon|bnb and --phase=count|nonnull|null-known|null-missing."
  );
const query = parseCatalogRequest(
  new URLSearchParams(chain === "all" ? "" : `chain=${chain}`)
);
const sources = {
  statuses: {
    bnb: "unavailable",
    ethereum: "unavailable",
    base: "unavailable",
    polygon: "unavailable"
  },
  provenance: {}
};
const statements = catalogSql(
  query,
  new Date(),
  sources,
  undefined,
  phase === "count" ? "all" : phase
);
const statement = phase === "count" ? statements.count : statements.page;
const start = statement.text.indexOf(",\n    hidden AS");
if (start < 0)
  throw new Error(
    "Catalog query structure changed; review the metadata-only probe."
  );
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
function literal(value) {
  if (value === null) return "NULL";
  if (Array.isArray(value))
    return "ARRAY[" + value.map(literal).join(",") + "]";
  if (value instanceof Date) return quote(value.toISOString());
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return quote(value);
  throw new Error("Unsupported probe parameter.");
}
const sql = (
  "WITH books AS (SELECT NULL::integer AS chain_id,NULL::text AS contract_address,NULL::numeric AS token_id," +
  "NULL::text AS maker,NULL::integer AS lifecycle,NULL::numeric AS price,NULL::jsonb AS listings WHERE false)" +
  statement.text.slice(start)
).replace(/\$(\d+)\b/g, (_, index) =>
  literal(statement.values[Number(index) - 1])
);
process.stdout.write(
  "BEGIN READ ONLY;\nSET LOCAL statement_timeout='8s';\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " +
    sql +
    ";\nROLLBACK;\n"
);
