# Exomon source provenance

The original `/root/protobits` checkout was unavailable when this feature was
ported. This local Git worktree was reconstructed from the deployed monorepo
snapshot `/opt/yunipals/releases/f0bd9a0`. The indexer app's `lib`, `scripts`,
`test`, and `package.json` were then updated from the deployed API artifact
`/opt/yunipals/releases/9a2bb8a-read-api`, which contains later projection,
read-cache, and query-capacity fixes. The baseline is local commit `4ddd582`.

The resulting development branch had no configured Git remote. Its local
commit hashes are not upstream monorepo commits. The public release branch was
created from `protocolmon/yunipals` main at `b592658`, then the Exomon commits
were ported onto that history. The public branch already contained the deployed
API projection, read-cache, and query-capacity fixes, as well as the newer
Islands feature and CI. Those upstream changes were preserved during the port.
