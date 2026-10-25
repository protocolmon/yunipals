# Source backend disappearance during read-only kernel capture

This is a new standalone source-authority producer. It creates no source,
cache, reader, feature or managed acknowledgement. The frozen V5 guard and
all its qualifications remain unchanged. Its own qualification and every
new caller timing record must use the actual V6 source hash.

The root read-only diagnostic on 2026-10-25 at 16:27:13 UTC proved an exact
`FileNotFoundError` at `/proc/<initial-role-backend>/stat`: the failed PID
belonged to the initial native role inventory, its exact `(pid, backendStart)`
was absent from a fresh role query, and `/proc/<pid>` was gone. Its old process
epoch was already unobservable. The observation connection was outside native
role 73004621; the diagnostic did not generate its own filtered backend.
The private detailed proof SHA was
`4537137df095f27022a4a1e9161d742e91602a3f9917205b96fce0db4c32d4f1`.
This established a failure cause, without qualifying source authority or
repeating the full cache review.

`ypal-ordinary-source-authority-v6.py` compiles the exact reviewed V5 source
(`052f363c…`) with a new format and audit directory. Every original Authority
method, including the full preflight/current/READ/private/route/native 44/
heartbeat/registration and postflight bodies, retains its bytecode and
constants. The only current-kernel driver replacement adds the following
strictly read-only observation path.

Only the first backend FD probe, for the complete role 73004621/DB 17584
inventory under UID 111/GID 113, can use the new probe. Its script derives the
exact `7034021d…` FD body and catches only `FileNotFoundError` whose filename
is that initial PID's exact `/proc/<pid>/stat`. It returns a typed failure
envelope with no partial FDs. The original runner still refuses every nonzero
exit, stderr, permission/assertion failure, timeout and unrelated missing file.
No generic command failure is reinterpreted as churn.

Before another observation, the guard requires a fresh valid bounded native
role query with the exact old `(pid, backendStart)` absent. It independently
requires the process to be absent, or a previously observed process start
epoch to have changed. When no initial process epoch was observable, the
process must actually remain absent. A same backend epoch, surviving old
process, unknown PID, invalid row or duplicate PID refuses.

The failed capture supplies no positive attribution or authority. The next
attempt starts the whole original kernel capture afresh. Every surviving or
new row must have unique positive socket ownership, source process epochs
must match, and the final role query must equal that fully attributed capture.
The original classified final-query-churn path retains its complete positive
attribution prerequisite. Both paths share a maximum of three total captures,
an explicit 90-second bound and the original 25-ms observation interval.
Full source actor/static/private/mount/route snapshots must remain identical
after every qualified observation failure, and the original final CAS still
runs. No effect is retried.

The interface remains `Authority(result_sha, input_sha, read_config=None)`
with `preflight`, `current`, `metadata_refresh` and `finish`. Only the actual
acknowledged standalone ordinary source epoch can qualify. The producer is
`yunipals-ypal-ordinary-source-authority-v6`; audit records use
`/var/backups/yunipals-ypal-ordinary-source-authority-v6-20261025`.
It supplies no managed, restored, canonical, financial or old whole-validator
success alias.

Default CLI/import remains inert. Root may perform a new read-only qualification
after staging and verifying the actual public source bytes:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-source-authority-v6.py --qualify ACTUAL_NEW_CAPTURE_ID ACTUAL_SOURCE_RESULT_SHA ACTUAL_SOURCE_INPUT_SHA --read-ref ACTUAL_READ_ACK ACTUAL_READ_PLAN ACTUAL_READ_INPUT
```

Those names are argument descriptions, not an emitted input or receipt. The
original fixed-host/root gate, private exclusive audit records, 240-second
qualification alarm and full pre/postflight execute. A failed qualification
stays immutable. A qualification supplies no measured caller deadline; the
new caller must separately measure and authenticate its complete real callback.

The static manifest lists the actual new producer and five direct public
prerequisites. Their original authenticated transitive dependencies and runtime
private inputs remain owned by the unchanged full preflight. The static builder
does not claim to deploy or qualify that whole graph:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-source-authority-v6-manifest.py --build
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-source-authority-v6.test.py
```

Fourteen controls cover exact retained source bodies, strict typed replies,
fresh-row/OS-epoch disappearance, duplicate/unmapped rows, private/actor/route
fences, bounded exhaustion, final-query churn and hard non-churn failures.
Real local UID 111 socketpair and exited-process probes pass with local
escalation because the sandbox cannot map that UID. These fixtures provide
no production source or cache acceptance evidence.
