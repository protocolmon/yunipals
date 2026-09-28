import { join } from "node:path";
import { argumentsOf, legacyMongo, safeFailure, writeReport, type SourceDocument } from "./metadata/support.js";
import { renderLegacySnapshot } from "../lib/metadata/render/snapshot.js";
import { historicalOriginIds, renderRainbowOrigins } from "../lib/metadata/render/origins.js";
import { comparisonDocument } from "../lib/metadata/render/compare.js";
import { canonicalJson } from "../lib/metadata/source/canonical.js";

const args = argumentsOf({ output: { type: "string", default: "test/fixtures/metadata" } });
function sanitize(value: unknown): unknown {
  if (typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value)) return "0x0000000000000000000000000000000000000001";
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,sanitize(item)]));
  return value;
}

async function main() {
  const source = await legacyMongo(String(args["legacy-root"]));
  const manifest: SourceDocument[] = [];
  try {
    for (const origin of ["GEN1_BOOSTER","GEN1_GHOST_BOOSTER","GEN1_RAINBOW_FUSION","GEN1_EXOMON_DROP","GEN1_ORIGIN","GEN1_UKRAINIAN_UNIDONKEY"]) {
      const collection = source.db.collection("pmonCollection");
      const selected = await collection.findOne({ "origin.type": origin }, { maxTimeMS: 10000 });
      if (!selected) { manifest.push({ origin, status: "source_missing" }); continue; }
      // Match the old /meta lookup, which does not accept a family discriminator.
      const doc = await collection.findOne({ "nft.id": selected.nft.id }, { maxTimeMS: 10000 });
      if (!doc || doc.origin?.type !== origin) { manifest.push({ origin, status: "legacy_alias_collision", id: selected.nft.id }); continue; }
      const rawParents: SourceDocument[] = [];
      const plain = JSON.parse(JSON.stringify(doc));
      if (origin === "GEN1_RAINBOW_FUSION") {
        for (const id of historicalOriginIds(plain)) {
          const filter = { "genId.type": "GEN1", "genId.id": id };
          const parent = await collection.findOne(filter, { maxTimeMS: 10000 })
            ?? await source.db.collection("pmonCollectionBurned").findOne(filter, { maxTimeMS: 10000 });
          if (!parent) throw new Error("Required rainbow parent missing");
          rawParents.push(parent);
        }
      }
      const response = await fetch(`http://127.0.0.1:9001/meta?id=${encodeURIComponent(doc.nft.id)}`, { signal: AbortSignal.timeout(30000), redirect: "error" });
      const body = await response.json() as SourceDocument;
      if (!response.ok || !body.id) { manifest.push({ origin, status: "legacy_error", httpStatus: response.status }); continue; }
      const parents = JSON.parse(JSON.stringify(rawParents));
      const updatedAt = Number(body.attributes?.find((trait: SourceDocument) => trait.trait_type === "Last metadata update")?.value ?? 1700000000);
      const rainbow = origin === "GEN1_RAINBOW_FUSION" ? renderRainbowOrigins(historicalOriginIds(plain), parents) : undefined;
      const rendered = renderLegacySnapshot(plain, { publicFacing: true, metadataUpdatedAt: updatedAt, rainbow });
      const match = canonicalJson(comparisonDocument(rendered)) === canonicalJson(comparisonDocument(body));
      await writeReport(join(String(args.output), `${origin.toLowerCase()}.json`), sanitize({ envelope: plain, parents,
        expected: body, metadataUpdatedAt: updatedAt, comparison: { match, httpStatus: response.status } }));
      manifest.push({ origin, id: doc.nft.id, status: match ? "matched" : "mismatch" });
      console.log(`${origin}: ${match ? "matched" : "mismatch"}`);
    }
    await writeReport(join(String(args.output), "manifest.json"), { capturedAt: new Date().toISOString(), samples: manifest,
      comparisonRules: ["Ignore volatile Last metadata update trait", "Compare trait arrays as sets of complete trait objects; preserve other array order"],
      sanitization: "EVM addresses replaced consistently with a fixture address" });
    if (manifest.some(item => item.status === "mismatch")) process.exitCode = 1;
  } finally { await source.client.close(); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
