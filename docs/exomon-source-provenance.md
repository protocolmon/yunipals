# Exomon source provenance

The original `/root/protobits` checkout was unavailable when this feature was
ported. This local Git worktree was reconstructed from the deployed monorepo
snapshot `/opt/yunipals/releases/f0bd9a0`. The indexer app's `lib`, `scripts`,
`test`, and `package.json` were then updated from the deployed API artifact
`/opt/yunipals/releases/9a2bb8a-read-api`, which contains later projection,
read-cache, and query-capacity fixes. The baseline is local commit `4ddd582`.

The resulting feature branch is a complete reviewable source tree, but it has
no configured Git remote. Do not treat the local commit hash as an upstream
monorepo commit. Reconcile this branch with the authoritative repository when
it becomes available, preserving the deployed API fixes and the Exomon port.
