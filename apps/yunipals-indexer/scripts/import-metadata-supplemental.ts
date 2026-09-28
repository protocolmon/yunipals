import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { archiveReleaseId } from "../lib/metadata/source/canonical.js";
import { aliasNamespace, staticNamespace, exomonAliasRecords, islandDocumentRecord,
  importSupplemental, projectExomonAliases } from "../lib/metadata/source/supplemental.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";

const args = argumentsOf({ release: { type: "string" }, "legacy-url": { type: "string", default: "http://127.0.0.1:9001" },
  "project-only": { type: "boolean", default: false }, report: { type: "string" } });

async function main() {
  const release = archiveReleaseId(String(args.release ?? ""));
  const { pool } = await postgresFrom(String(args["env-file"]));
  try {
    if (!args["project-only"]) {
      const file = await readFile(join(String(args["legacy-root"]),"dist/rest/endpoints/exomon.json"));
      const aliases = exomonAliasRecords(JSON.parse(file.toString("utf8")));
      if (aliases.length !== 10000) throw new Error("Unexpected Exomon alias coverage");
      const documents = [];
      for (const id of ["10000000", "20000000"]) {
        const response = await fetch(new URL(`/v1/island-meta/grassland/${id}`,String(args["legacy-url"])), { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Could not capture static metadata response");
        documents.push(islandDocumentRecord(id,await response.json()));
      }
      await importSupplemental(pool,release,aliasNamespace,aliases,
        { file: "dist/rest/endpoints/exomon.json", sha256: createHash("sha256").update(file).digest("hex") });
      await importSupplemental(pool,release,staticNamespace,documents,
        { method: "GET", path: "/v1/island-meta/grassland/:id", handler: "getIslandMeta.js" });
    }
    const projection = await projectExomonAliases(pool,release);
    const report = { release, observedAt: new Date().toISOString(), projection,
      completeCoverage: projection.unresolved === 0, activation: "unchanged" };
    if (args.report) await writeReport(String(args.report),report);
    console.log(JSON.stringify(report));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
