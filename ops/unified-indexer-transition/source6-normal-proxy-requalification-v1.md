# Normal source proxy requalification

This owner acknowledges only replacement proxy process tuples while retaining
the exact original normal source `e0772a5a…`, PID 716994, invocation `c3463c9a…`.
It does not restart or adopt a source, change SQL, select a release, alter
service definitions, create credentials, or renew financial authority.

The original `c8c06c03…` validator and its receipt stay unchanged. Its whole
validation currently refuses because all four proxy PID/invocation tuples
changed after dependency restarts. A separate read-only observation showed
identical source financial state, proxy argv and every unit/drop-in hash. That
observation is preparation evidence, not a produced qualification receipt.

The new owner reuses the frozen normal operator's actual
`normal_configuration`, `current_identity`, `fixed_inputs`, `native`,
`preserved`, `financial`, `link_identity`, and strict `s.proxies()` checks. It
also authenticates the historical static review against the original runtime's
review hash. Financial state must exactly equal the original snapshot: same
profile, manifest, scope and fixed 19 November expiry, no active permits, and
both expired historical permit rows retained. The four current proxies must
pass the frozen free-profile/route/paid0 preflights. Their graph may differ from
the original **only** in PID and InvocationID; all command and definition hashes
and their complete path sets must remain equal.

Default invocation is read-only:

```sh
python3 /opt/yunipals-unified/operations/free-replay-20261020/source6-normal-proxy-requalification-v1.py
```

The reported `reviewHash` binds the unchanged source identity, same boot,
immutable inputs, financial state, exact current proxy tuples, native catalog
identity and original boot-link inode. Live checkpoint/session counters appear
as observations outside that hash. Every observation still verifies that
retained checkpoints have not regressed. This does not claim native catch-up,
fresh indexing, or successful execution of the old whole validator.

A separate reviewed acknowledgement repeats those checks under the existing
source handover lease, creates a fresh root0700 directory, saves the review,
then repeats the checks before exclusively saving the root0600 result:

```sh
python3 /opt/yunipals-unified/operations/free-replay-20261020/source6-normal-proxy-requalification-v1.py --acknowledge ACTUAL_REVIEW_HASH
```

Its distinct format is `yunipals-source6-normal-proxy-requalification-v1`, with
`acknowledged:true`, the original `originalRuntimeReceiptSha256`, the unchanged
`runtime`, new exact `proxies`, `operatorSha256`, `normalHelperSha256`, the
original static review hash, native identity, `beforeNative`, financial state,
boot link and review-file hash. `sourceRestarted`, `financialWindowRenewed`,
`nativeCaughtUpClaimed` and `originalWholeValidationPassed` remain false. The
result is `/var/backups/yunipals-source6-normal-proxy-requalification-v1-20261023/result.json`.
No future file hash or successful production acknowledgement is invented here.

The exported `validate_current(pin)` reads that fixed protected path and
rechecks the same immutable/source/financial boundaries and the result's
**exact new** proxy tuple, plus monotonic checkpoints. Another proxy or source
restart refuses; it is not implicitly followed. The CLI equivalent is:

```sh
python3 /opt/yunipals-unified/operations/free-replay-20261020/source6-normal-proxy-requalification-v1.py --validate ACTUAL_RESULT_SHA256
```

The returned proof includes `validated`, `qualificationReceiptSha256`,
`originalRuntimeReceiptSha256`, actual producer hash, unchanged runtime, exact
proxies, boot link and unchanged financial expiry. A lost file-write
acknowledgement is reconciled by hashing the existing result and validating it,
without repeating the acknowledgement. An incomplete directory without a
result remains an explicit manual-review condition; this owner never deletes
old evidence or retries a partial operation.

The frozen final-supervisor-v2 binding table currently admits only the bounded
and original normal receipts. It must continue refusing this new format until
a separately reviewed successor explicitly pins the actual produced result
file/SHA and this producer, calls `validate_current`, and requires the unchanged
original runtime plus all existing catch-up/feature/retirement gates. The
original final-supervisor, Arena direct owner and receipt-worker source pins
are not rewritten by this package. The consumer owner/preview/install and
booster handover continue using their existing release/ACL/availability and
dynamic process checks; no consumer grant, LOGIN or API restart is needed for
this acknowledgement.

Run the focused local controls:

```sh
python3 ops/unified-indexer-transition/source6-normal-proxy-requalification-v1-test.py
```

The tests reuse the retained synthetic fixture with the actual frozen normal
review/apply/configuration/identity/native algorithms. They cover strict proxy
graph negatives, authority/source/static-review/checkpoint drift, exact
acknowledgement and subsequent validation, future-proxy refusal, file ACK loss,
and a replacement during acknowledgement. No production service, database or
provider request is performed by these tests.
