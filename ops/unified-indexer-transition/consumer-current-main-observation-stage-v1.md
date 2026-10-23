# Two-file current-main observer publication

This operator publishes only the previously reviewed public sources
`consumer-current-main-observation-v1.py` (`a57dbbf7…`) and
`consumer-retained-selectors-observe-v1.py` (`066c74a8…`) to the existing protected
operations directory. Both sources are published in commit `3baf7e27`.
The helper's existing acknowledgement/consumer-composition limitations remain.

Default review checks the two input hashes, four existing helper hashes, two
historical baseline hashes, current main and booster API identities, the original
normal source receipt/process identity, and a fresh full source qualification.
The fifth helper is the observer being published. Its exact pending source is
loaded only into the prospective helper instance during review. This is explicitly
not installed default execution. The source's old whole runtime validator is
not called or claimed to pass; its exact original PID/invocation/start identity
is fenced, and no source readiness is inferred.

The protected `read`, directory and exclusive-link primitives come from the
unchanged stager `7bf2ef8969cb4694af40f9ae018c00b29c203685b9bb4930a09bb61cf1cdfc72`.
Missing targets are created root:root 0644. Identical existing 0644 files retain
their inodes; foreign bytes, symlinks, hardlinks, modes and publication races
refuse. Partial publication requires a fresh review and never overwrites files.

Read-only review:

```sh
python3 -I -B consumer-current-main-observation-stage-v1.py --source /tmp/yunipals-current-main-observer-public-input-20261023
```

The actual production default review passed with hash
`ac0bc4183891dde49c1ffbfcaa81ab47bdff93d7eb083f1ab3070a5800eb52b8`.
Both targets were absent. The captured review stdout has SHA
`618aa92bbb9e00d2844dd0b3f06dd946dcf50c2398f56a80243665460e7d2692`.
It retained main PID1437990/invocation29aaa…, booster API PID1824982/7858…,
and source PID716994/c346… with original start ticks6611794751.

After root's review, the exact apply command appends:

```sh
--apply ac0bc4183891dde49c1ffbfcaa81ab47bdff93d7eb083f1ab3070a5800eb52b8
```

The same reviewed operator can be executed from sealed memory to avoid adding a
third operations file. It freshly recomputes the review before either exclusive
link. After publishing both sources it executes exactly:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/consumer-current-main-observation-v1.py
```

It passes no acknowledgement, run ID, environment file or alternate entrypoint.
The sanitized installed result must equal the reviewed source qualification;
all three actor identities and both published hashes/modes are checked again.
Only public equivalence hashes, counts and identities are returned. A qualification
failure preserves the public files for inspection and does not retry or roll back
runtime services. The operator has no service, SQL, provider, role, private
acknowledgement or downstream consumer action.

Local real-filesystem controls:

```sh
python3 -I -B ops/unified-indexer-transition/consumer-current-main-observation-stage-v1-test.py
```

All11 controls pass, including exact payloads, dependency/source drift, stale review,
actor changes, existing inode preservation, foreign/racing files, partial publication
and the exact default-only child argv. A successful source publication/default
qualification still does not create the protected current-main acknowledgement
or implement its future consumer entry.
