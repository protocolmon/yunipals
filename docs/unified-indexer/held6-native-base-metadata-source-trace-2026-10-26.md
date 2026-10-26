# HELD6 Native Base metadata guard: source trace

This is source analysis, not a new runtime qualification. Root reported that
HELD6's full publication peer raised `Native Base metadata unavailable` and
that XID `17009625` was aborted with its child and backend gone. Those facts
do not by themselves identify the rejected SQL predicate or establish complete
catalog restoration. No production command or new held attempt was run for
this analysis.

The exact V5 function statement is retained in
`ops/unified-indexer-transition/ypal-combined-readview-v5.preparation.json`
(SHA `d968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7`).
Its generator is `apps/yunipals-indexer/lib/unified/base-metadata-views.ts`,
lines 53–85. `base_metadata_frame(true)` catches every inner exception and
raises SQLSTATE `YI001`, message `Native Base metadata unavailable`, and
`DETAIL = SQLERRM`.

The inner branches are:

- `base_policy_unavailable`: `source_boundary('base')` returned no row or its
  policy was not `latest`.
- `base_metadata_source_mismatch`: the registered Base source's chain, manifest,
  or complete definition did not match the fixed expected source.
- `base_metadata_approval_pending`: no approval row joined the native-mode
  scan; or the read identity, ready state, event frontier, implementation,
  timestamp, checked boundary, or canonical checked hash failed the grouped
  predicate.
- An error propagated by `source_boundary` or another SQL operation. The source
  boundary itself wraps failures as `unified_ownership_source_unavailable`.
  Because the outer handler copies `SQLERRM`, nested exception detail may be
  lost. A later healthy observation cannot establish the original inner reason.

For the approval branch, the expected V5 identity is
`0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab`.
The frontier is the latest eligible canonical metadata event's `id:block_hash`,
or `none`. Approval must have the fixed implementation, must not be older than
the function's unchanged 90-second bound or in the future relative to
`statement_timestamp()`, and must name a checked canonical block no later than
the current boundary. The separate authority gate remains stricter about its
actual remaining time and five-second reserve.

`base_metadata_event` cross joins `base_metadata_frame(true)` (generator lines
101–108). The genuine full publication proof counts the official metadata read
relation, including that event view, and separately checks
`base_metadata_probe()`. Thus an exception in the count can abort the whole
publication query. The probe's own exception-to-false behavior does not suppress
an exception from the event view. The unchanged peer executes this count in a
read-only transaction with its original 60-second statement and one-second
lock timeouts; see `ypal-ordinary-publication-query-v2.py`, lines 83–109.

The installer source is
`apps/yunipals-indexer/lib/metadata/read-cache-schema.ts`, SHA
`1de7856e5fc9253dbc08d6db0b0408516252030d353bcc4409ecdb20a0922757`.
Its bytes match the retained release-recovery source. The original cache
transition starts one transaction and explicitly locks its fixed relation set
in `SHARE ROW EXCLUSIVE` mode; that set includes
`metadata_source.native_base_metadata_state`, `chain_metadata_scan`, and the
canonical event relation. See `ypal-ordinary-cache-transition-v5.mjs`, lines
17–47 and 233–240. The installer also creates/replaces and enables the native
approval relation's dirty/truncate triggers (installer lines 167–178 and
194–228). These locks remain held while the original prepared callback runs.

The official worker refresh reads the approval with a 60-second reuse check.
When it needs a fresh check, it releases the read transaction, performs the
original point checks, rechecks the current frontier/canonical/adopted facts,
then INSERT/UPSERTs the approval with `checked_at = clock_timestamp()`. See
`apps/yunipals-indexer/lib/metadata/native-base.ts`, lines 81–101 and 194–275.
The held table locks conflict with that write. Ordinary read-only SELECTs can
still see the previously committed approval. Therefore an expiry error during
the full publication query does not require a query lock timeout. The owned
two-second scheduler cannot renew a row while that write remains blocked.
This explains a possible mechanism; it does not prove HELD6 failed on age
rather than another grouped predicate.

The next decision must use the actual private peer `DETAIL`/context, approval
gate snapshot and monotonic timing, and callback profile. If elapsed cost is
the issue, the narrow source proposal is a new root driver that removes only
passive global trace/profile overhead, retains the complete original
qualifier/callback/SQL and final deadline, and obtains a genuinely new complete
rollback-only qualification. The reviewed post-exception witness can retain
the original inner exception after unwinding without installing a live trace,
profile, parent wrapper, or pipe observer. Diagnostic failure must not replace
the original operation failure.

This proposal does not authorize a new attempt. It does not change the
90-second TTL, five-second reserve, dependency deadline, readiness checks,
current publication query, approval worker, or transaction body. No pre-held or
warmed publication proof may substitute for the actual callback, and no gate
may write approval or reset its lifetime. If an observer-free complete callback
still cannot fit the real remaining window, that is a separate architectural
problem requiring explicit source design and review.
