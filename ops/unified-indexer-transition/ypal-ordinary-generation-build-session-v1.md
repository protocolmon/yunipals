# One-Host generation build caller

This is a new caller of the actual V2 generation owner. It does not change the
owner, monitor, artifact, worker SQL, source guards or existing operation. Its
default CLI and import are inert. No production invocation is claimed by these
source files or their tests.

The caller authenticates owner
`4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753`
and all 164 direct source pins, then obtains the owner's actual V2 composition.
It constructs exactly one genuine `Host(actual_input_sha)`. Under that Host's
original `retained.lock()`, it authenticates `operation(actual_operation_sha)`,
calls the original `build_review(host, operation)`, records its real result and
hash, then calls the original `build(host, operation, actual_review_hash)` on
the same Host. No original CLI or `main()` is invoked or claimed to have passed.

The original build performs its own second build review and all its later
current-source, capsule/context/catalog, 35-guard, lease, capacity and full backup
window checks. Those bodies are byte-authenticated and unchanged. This caller
removes the second Host construction between separate CLI phases. It does not
remove either build review or any repeated check inside the build.

Its explicit parent bound is 900 seconds, including constructor and both calls.
The worker's existing 1470–2400 second policy and `maximum + 30` systemd limit
are unchanged. A parent timeout leaves an unknown outcome for reconciliation;
it neither retries nor claims that the worker was stopped. The original full
backup-window check still decides whether a 40-minute build can start. This
caller cannot force a missed hourly window.

The once-only caller journal is
`/var/backups/yunipals-ypal-ordinary-generation-build-session-v1-20261025`,
root-owned mode0700 with exclusive mode0600, fsynced files. It records its own
producer SHA, the actual input/operation refs, the original owner SHA and
`originalMainInvoked:false`. `host-result.json`, `review.json`, `result.json`
and failures contain actual monotonic stage durations for the Host constructor,
external review and original build call. The build-call duration includes all
the original internal repeated checks. A failure records an unfinished stage
and elapsed time when applicable.

An existing caller directory, original build/public-env/unit/start prefix or
worker runtime directory cannot enter build again. The caller delegates only
to the original read-only `reconcile(host, operation)` under the same lock.
The original reconciler may refuse an incomplete prefix; that refusal is kept
and no missing record is invented. No original guards or receipts are erased,
overwritten or reset. Unknown start acknowledgements never cause a second start.

After root independently verifies and stages this public source at its fixed
OPS filename, the actual operation adopted at13:32:49 has these root-supplied
refs. This command is prepared source only and has not been executed here:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-generation-build-session-v1.py --input-sha f5e35a8c4a25b9b7bf95f4a02c32096c62e95da66b2a198e6172eeaaeef29c28 --operation-sha dfc3adef373c5c904ec2143cce22ccd7aba4c93d80b6586c8c0f0e71f3e362b5 --start
```

For inspection after any unknown outcome, use those same actual refs with
`--reconcile`. This performs only the original read-only reconciliation and
writes no caller journal. Original owner records remain the authority for the
actual unit/start/worker outcome. A successful caller receipt proves only an
acknowledged worker start; it does not prove preparation, acceptance, publication
or a future generation ID.

Focused controls:

```sh
/usr/bin/python3 -I -B ops/unified-indexer-transition/ypal-ordinary-generation-build-session-v1.test.py
```

The controls compose the actual V2 source locally and compare the unchanged
original bodies. Controlled filesystem/service doubles exercise one Host call
at the genuine constructor seam, the real original build/review control flow, repeated-check
failures, durable exclusive journals, unknown start ACKs and read-only replay
refusal. They never construct a production Host or run a service/database query.
