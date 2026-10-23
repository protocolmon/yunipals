# Stage the reviewed current-feature and final-v3 public sources

This stager publishes dormant source files only. It verifies the fixed
`current-feature-final-public-stage-v1.files.json` SHA embedded in its source,
21 exact payload hashes and23 preexisting historical public code/config hashes.
It does not import or run any migration operator, inspect a process, read private
configuration, query a database, or require an actual future v6 grant/switch/
retirement receipt. Runtime acceptance gates remain inside the unchanged reviewed
operators.

The payload contains the original15 current-feature files, the three final-v3
source/test/runbook files, its preparation manifest, and both independent review
records including `26f9eee3…`. New operator/test/runbook basenames are added under
`/opt/yunipals-unified/operations/free-replay-20261020/`. Public proof JSONs go in
its new `current-feature-final-source-v1-20261023/` subdirectory. The stager does
not replace a historical helper or configuration. Source tests are supplied for
review; their checkout/dependency fixtures are not installed by this stager.

Keep the source snapshot's repository-relative directory structure. From a
root-owned, protected extracted snapshot on the server, first run only:

```sh
STAGE_INPUT=/var/tmp/yunipals-current-feature-final-public-source-v1-20261023
python3 -I -B "$STAGE_INPUT/ops/unified-indexer-transition/current-feature-final-public-stage-v1.py" --source "$STAGE_INPUT"
```

After reviewing that exact source-only result, the owner may run the same command
with `--apply <actual-review-hash>`. The destination is fixed in code; it is not a
CLI argument. The immutable payload includes consumer entry `7fc0f645…`, v6 owner
`114dd957…` and final supervisor `9bbef642…`. The feature code still requires the
actual b624 API/b160 unit, ten launch reads and eight native reads before serving
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
python3 -I -B ops/unified-indexer-transition/current-feature-final-public-stage-v1.test.py
```

Eleven real-filesystem controls cover exact source/manifest/dependency pins,
read-only review with no operational receipts, fresh-hash apply, inode retention,
foreign files/symlinks/hardlinks, unsafe mappings/ancestry, partial completion and
an exclusive-link race. They perform no production actions.
