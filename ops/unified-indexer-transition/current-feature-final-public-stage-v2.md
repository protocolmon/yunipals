# Stage the reviewed current-feature and final-v4 public sources

This stager publishes dormant source files only. It verifies the fixed
`current-feature-final-public-stage-v2.files.json` SHA embedded in its source,
21 exact payload hashes and23 preexisting historical public code/config hashes.
It does not import or run any migration operator, inspect a process, read private
configuration, query a database, or require an actual future v7 grant/switch/
retirement receipt. Runtime acceptance gates remain inside the unchanged reviewed
operators.

The payload contains the current15 recent-feature files plus their independent review, the three final-v4
source/test/runbook files, its preparation manifest, and the final-v4 independent review
record `ec6157fb…`. New operator/test/runbook basenames are added under
`/opt/yunipals-unified/operations/free-replay-20261020/`. Public proof JSONs go in
its new `current-feature-final-source-v2-20261023/` subdirectory. The stager does
not replace a historical helper or configuration. Source tests are supplied for
review; their checkout/dependency fixtures are not installed by this stager.

Keep the source snapshot's repository-relative directory structure. From a
root-owned, protected extracted snapshot on the server, first run only:

```sh
STAGE_INPUT=/var/tmp/yunipals-current-feature-final-public-source-v2-20261023
python3 -I -B "$STAGE_INPUT/ops/unified-indexer-transition/current-feature-final-public-stage-v2.py" --source "$STAGE_INPUT"
```

After reviewing that exact source-only result, the owner may run the same command
with `--apply <actual-review-hash>`. The destination is fixed in code; it is not a
CLI argument. The immutable payload includes consumer entry `e283589f…`, v7 owner
`0f5024cd…` and final supervisor `05de84bf…`. The feature code still requires the
actual41fe API/5ae unit, ten launch reads and eight native reads before serving
through the native schema.

Review makes no writes. Apply rechecks the review hash and uses fsynced temporary
files plus exclusive links, refusing a destination that appears during the write.
Existing identical files retain their bytes, modes and inodes; differing files,
symlinks, hardlinks and unsafe ancestry are refused. Only the one fixed evidence
subdirectory may be created. Historical dependencies are rechecked in the final
postcheck.

A partial file-write failure leaves any completed, exact public files intact and
produces no staging success. Re-run read-only review, inspect the changed
`alreadyPresent` values, and use its new hash to finish. No automatic retry,
cleanup, service reload/start or operational rollback is included. Staging success
claims neither runtime readiness nor permission admission.

Local verification:

```sh
python3 -I -B ops/unified-indexer-transition/current-feature-final-public-stage-v2.test.py
```

Eleven real-filesystem controls cover exact source/manifest/dependency pins,
read-only review with no operational receipts, fresh-hash apply, inode retention,
foreign files/symlinks/hardlinks, unsafe mappings/ancestry, partial completion and
an exclusive-link race. They perform no production actions.

The source-only scope remains21 payloads and the same23 direct historical public
code/config dependencies as v1. All historical v1/v2/v3 supervisor and old current
feature/stager files remain unchanged. Runtime gates include10 final acceptance
checks,4 actual consumer installs, Solana writer/ledger/budget evidence, native
Arena/metadata/current canonical state and owned feature retirement/inverse.
An Arena financial-only proof with `sourceRuntimeRequired:false` never substitutes
for native adoption/readiness. No grants, auth/roles, source changes or permit
renewal are performed here. The batch-purchase frontend did not change the actual
41fe API binding. The v4 operator's72 controls and recent-feature46 controls plus14
real PostgreSQL groups remain separate from these11 source-publication controls.
