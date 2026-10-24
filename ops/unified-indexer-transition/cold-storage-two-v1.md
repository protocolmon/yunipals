# Two historical database archive relocation

This owner reuses the accepted September archive relocation sequence for two
closed database payloads. Its actual source paths, inodes, timestamps, data
hashes, filesystem devices and directory identities are supplied in a private
root-owned plan, not in this public source or test fixture.

It copies bytes to the already attached volume, verifies the entire copies, then
replaces each original file path with a root-owned absolute alias to its verified
copy. All other files and directories remain in place. The current recovery set,
service definitions, runtime files, configuration, PostgreSQL data and active
logs are outside the accepted path patterns. There are no database connections,
provider calls, service commands, grants or cleanup/prune operations.

The plan is a root-owned, single-link `0600` file at the fixed `PLAN` path in the
owner. Pass its externally reviewed SHA-256 to every command. It must contain
exactly the `cutover` and `premerge` entries, each matching the two historical
payload patterns, complete protected source ancestry, full file identity and
SHA-256, plus the distinct mounted volume and existing private cold-parent
identity. Do not publish the production plan or receipts.

The source and destination must stay on their bound filesystems. The existing
cold parent and every newly created destination directory are root-owned `0700`;
files are root-owned `0600`. The owner allows no symlinked source ancestors,
foreign destination paths, overwritten files or second attempt after an intent.

## Commands

Run on the fixed production host as root, under the normal reviewed launch
context. The owner has a 600-second whole-command deadline. Commands that write
hold a fixed nonblocking operation lock. `review` and `reconcile` do not create an
operation directory or lock when none exists.

```text
python3 -I -B cold-storage-two-v1.py review --plan-sha PLAN_SHA
python3 -I -B cold-storage-two-v1.py copy --plan-sha PLAN_SHA --expect REVIEW_RESULT_SHA
python3 -I -B cold-storage-two-v1.py reclaim --plan-sha PLAN_SHA --expect COPY_RECEIPT_SHA
python3 -I -B cold-storage-two-v1.py reconcile --plan-sha PLAN_SHA
```

`review` hashes both entire originals, checks all fixed source identities and
absent destination directories, scans process descriptors and checks capacity.
`copy` repeats the fresh review before its durable copy intent, exclusively
creates each destination, checks the open source identity and content during the
copy, fsyncs the copy and containing directory, independently rereads its complete
hash and records its exact identity. No original path is modified in this phase.

`reclaim` authenticates the complete copy receipt and both unchanged originals.
Before each atomic alias replacement, it saves a durable intent and the created
alias inode, checks that neither original nor copy is open by another process,
and freshly compares the original, copy and temporary-alias identities. The
original bytes are reclaimed only after the verified destination and intent are
durable. A final receipt binds both owned aliases.

The copy and inverse checks preserve at least 25 GB free on both filesystems.
They do not change the generation worker's separate 30 GB abort threshold or
accept its capacity estimate: rerun that preparation's own capacity check after
a successful reclaim. Space observations are not reservations.

## Interrupted commands and inverse

A deadline, lost SSH response or exception is not permission to rerun a phase.
Keep the operation directory, partial copies, temporary aliases and every intent
and receipt. `reconcile` is read-only: it checks the owned intent and full copies,
and reports each original, owned alias or owned restored file. It accepts an
alias only when its inode matches the durable staged-alias record. A partial
copy is reported and preserved. No files are deleted or overwritten to clear a
failed attempt. Partial transitions require a separately reviewed, exact-state
continuation; this owner deliberately refuses to restart them automatically.

After a complete two-alias state, the explicit inverse is:

```text
python3 -I -B cold-storage-two-v1.py inverse --plan-sha PLAN_SHA --expect RECONCILIATION_RESULT_SHA
```

It repeats reconciliation and requires its exact hash, both operation-owned
aliases, and enough free root space for both entire payloads plus a small copy
allowance above the 25 GB reserve. It then creates new `0600` sibling copies,
verifies and fsyncs them, saves their identities, compares each owned alias again
immediately before replacement, and restores the regular original paths. The
volume copies remain intact. Bytes, mode and modification time are preserved;
restored files necessarily have new inodes and change times. The same read-only
reconciliation recognizes a restored file after an acknowledgement is lost by
its durable staged-copy inode and full content hash.

## Local verification

```text
python3 -B ops/unified-indexer-transition/cold-storage-two-v1.test.py
```

Tests use tiny synthetic files in a disposable local directory. They cover full
copy/alias/inverse byte preservation, read-only review, stale and changed inputs,
foreign destinations and aliases, open descriptors, partial copies, missing
acknowledgements, space refusal, receipt tampering and intent-before-replacement.
They do not access production archives or mutate production files or services.
