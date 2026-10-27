# Frozen public runtime source

These four files preserve exact historical source bytes required by the existing
migration operators. They are public TypeScript source, not private configuration,
production receipts, build output or the active application tree.

`manifest.json` maps each original repository path to its source release, SHA-256,
owner and retained public release-manifest hash. The files were read from their
protected retained public copies only after the owner-pinned hashes matched; the
release association was independently checked against its public manifest.

Keep these files byte-identical. Do not format, import as the current application,
or substitute a newer source hash into a historical owner. To reconstruct an old
release or its exact source6 patch inputs, copy the selected release subtree to
its original relative paths in a separate build workspace, then verify the map's
hashes. Current source remains under `apps/` and `packages/`.

The action-evidence file belongs to release `41e5b5fd…`; the three RPC-proxy files
belong to the source6 package release `6e112a0c…`. Their older versions are needed
for reproducible migration validation and retained rollback/build lineage.
