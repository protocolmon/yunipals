# Public reader transport host qualification

This separate owner stages the frozen five-file transport and its exact eight
public operations dependencies. It does not stage the coordinator, SQL,
configuration, credentials or a service definition. The original transport's
independent twelve-control review is pinned to a6ea297e…; all original bytes
remain unchanged.

The only fixed incoming directory is
`/var/tmp/yunipals-reader-peer-runtime-input-v1-20261024`. Its public payload,
this owner and `independent-review.json` must be uploaded byte-for-byte into an
exclusive root 0700 directory. Existing inputs are never overwritten. The
destination is the existing private operations directory. All newly created
public files are root 0600. Matching existing root 0600/0644 files retain their
exact inode/mode; any mismatch refuses. No existing directory mode changes.

Default review reads the public inputs and immutable runtime metadata only. It
authenticates the installed 41e dependency inventory, exact main 40e/publisher 2b
manifests, bundles/maps, Node binary, symlink targets and every finite external
dependency entry resolved from the pinned compiler metafiles. Builtin Node
resolution imports no application or dependency module. The actual postgres
mapping must be 111/113; the main API mapping is freshly read from its existing
OS account and bound in the review.

```sh
python3 -I -B /var/tmp/yunipals-reader-peer-runtime-input-v1-20261024/ypal-reader-peer-runtime-host-v1.py
```

An explicit `--stage <reviewHash>` repeats those checks, creates the exclusive
root 0700 audit directory below, fsyncs an intent, creates only missing public
files with O_EXCL, and acknowledges the final exact closure. It never replaces
an existing file, including a same-byte file appearing after review. An
incomplete prefix remains evidence and requires explicit reconciliation.

```sh
python3 -I -B /var/tmp/yunipals-reader-peer-runtime-input-v1-20261024/ypal-reader-peer-runtime-host-v1.py --stage <reviewHash>
```

The audit directory is
`/var/backups/yunipals-reader-peer-runtime-host-v1-20261024`. The explicit
qualification takes the exact `stage-result.json` SHA. It checks the same
current files/dependencies/OS mapping, records an exclusive intent and invokes
the frozen `--qualify postgres` and `--qualify main` once each. These isolated
children use cleared groups/capabilities, no-new-privileges and clean
environments; imports deny network transports and instantiate no Pool/Client.
Before either qualification evaluates any dependency, the owner walks every
dependency tree declared by the authenticated runtime inventory. It verifies
all file bytes/modes and symlink targets and refuses extra or missing nodes.
This includes transitive and optional code without relying on a package's
declared dependency graph. This filesystem-only authorization has a 120-second
bound. Default review still resolves and hashes only finite entrypoints.

The main qualification hashes the installed main bundle without importing it.
A third isolated PostgreSQL-peer import then rechecks every actually loaded
`pg` CJS dependency against that inventory, including transitive helpers. The
result distinguishes this pre-evaluation dependency-tree proof from the
post-import observed closure. Other source files outside dependency trees are
not described as fully rehashed.

```sh
python3 -I -B /var/tmp/yunipals-reader-peer-runtime-input-v1-20261024/ypal-reader-peer-runtime-host-v1.py --qualify <stageResultSha256>
```

Each frozen qualification is bounded by 40 seconds and the transitive import by 20
seconds. Raw stdout/stderr stay in that root 0700 audit directory as root 0600
files. Exported results contain only peer IDs, counts and hashes. A failed or
unacknowledged attempt is never automatically repeated. There is no stop,
restart, reload, network/provider call, database connection, SQL, role operation,
app startup, environment-file read or permission broadening in this owner.

The resulting proof covers public file transport, actual restricted-user
readability/imports and the installed dependencies. It does not qualify source
health, the real application action, current grants, publication or native
cutover. A future explicit coordinator successor remains necessary and must
wait for the settled source epoch and its own reviewed runtime composition.

Local controls use actual fixed public payload bytes and disposable filesystem
fixtures. They cover readonly default, exact writes and existing-mode retention,
changed inputs, UID drift, racing same-byte foreign inode, stage drift, private
failure logs/no-repeat and transitive dependency hash refusal. Additional
controls verify the entire dependency tree without evaluating a module, refuse
an unlisted node and reject a same-length modified transitive module before
any qualification subprocess can execute:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-reader-peer-runtime-host-v1.test.py -v
```

The first incoming upload was rejected before execution by automatic approval
review because publication/authorization of repository source and review data
was not established. No incoming files or qualification ran. Its original
payload and rejection are preserved separately under `/tmp` for the parent's
review. The corrected source-only packet must be verifiably published/reviewed
before a genuinely public-only staging request; this document does not authorize
retrying the rejected upload or changing an existing approval decision.
