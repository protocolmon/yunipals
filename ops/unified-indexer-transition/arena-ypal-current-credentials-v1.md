# Current Arena credentials

This small composition reuses frozen30a's password/file/LOGIN/TCP bodies in a
distinct namespace. Exactly seven identity/path constants and three receipt,
helper and lock literals change. A reverse-AST control proves no other body
change. Historical30a and its journals remain unchanged.

The actual c04d current-admission receipt is required. No future ACK is embedded.
The admission adapter exposes its source-free `verify_current` and static
`create()[0]` query context; it does not qualify or replace a writer. Every
catalog/auth phase preserves the exact nine role OIDs and 227/13 ACL scope.
The full original private/runtime/schema proof and current eight-Arena-actor
proof remain in the unchanged credential Host.

Generate a plan only after the actual nine-role ACK exists:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-current-credentials-v1.py --admission-plan ACTUAL_ADMISSION_SHA
```

The parent stores those exact plan bytes root0600, then uses the unchanged
review/apply interface:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-current-credentials-v1.py --plan ACTUAL_PLAN_FILE --plan-sha256 ACTUAL_PLAN_SHA --phase setup
```

Apply that phase only with its exact fresh review hash via `--apply HASH`.
The subsequent phases are `enable`, `auth`, and owned `disable`. Setup creates
nine exclusive root0600 private files and sets SCRAM verifiers while roles stay
NOLOGIN. Enable changes only those nine LOGIN bits. Auth makes bounded read-only
TCP probes, including bad-password and owner-elevation denial. No password enters
argv, environment or a public result; auth uses the retained anonymous0600 fd.
No key, provider, service, source selector or migration is changed.

New journals use
`/var/backups/yunipals-arena-ypal-current-credentials-v1-20261024`.
Unknown setup/LOGIN outcomes refuse retries and rotation. Files, inodes, catalogs,
negative role attributes and empty owned sessions remain exact. Credentials and
LOGIN were explicitly approved by the user; code publication does not claim that
any actual setup, LOGIN or authentication has run.

```sh
python3 -I -B ops/unified-indexer-transition/arena-ypal-current-credentials-v1.test.py
```

Six focused controls include actual current helper-byte/receipt binding and real
reused local filesystem lifecycle, unknown ACK and foreign-inode refusal. No
production inputs, TCP/database/provider calls or host actions were used.
