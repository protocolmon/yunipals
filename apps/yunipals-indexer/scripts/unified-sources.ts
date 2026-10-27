import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.js";

const manifest = buildSourceManifest();
console.log(
  JSON.stringify(
    {
      kind: "unified_indexer_source_manifest",
      productionApplied: false,
      manifestHash: sourceManifestHash(manifest),
      manifest
    },
    null,
    2
  )
);
