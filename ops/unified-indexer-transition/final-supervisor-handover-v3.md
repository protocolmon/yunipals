# Final supervisor handover v3

This immutable successor retains source008, the Solana supervisor, native writer
and consumer acceptance, role/process ownership, financial limits, five owned
boot-link retirements, selector CAS, lost-acknowledgement handling and rollback
protocol from v2. It uses a fresh evidence directory:
`/var/backups/yunipals-final-supervisor-handover-v3`. Historical v1/v2 files remain
unchanged. No stage or production action is included in this preparation.

The new source kind is `normal-free-proxy-qualified-base1`. It admits only the
actual `add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d`
qualification produced by `source6-normal-proxy-requalification-v1.py` SHA
`8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658`.
Its validator must freshly prove the original e077/c346 process, schema/build,
boot-link ownership, current proxy tuples and unchanged free-only financial
window. The returned proof explicitly keeps `originalWholeValidationPassed=false`
and `nativeCaughtUpClaimed=false`. This does not replace final native readiness.

The final consumer producer is `consumer-operational-live-booster-v1.py` SHA
`7fc0f645067be01406c4643abf4a4473a936fdbea54bfce68943a739e3a25f1b`.
Its installation format remains `yunipals-consumer-operational-install-v7`.
The feature owner is `booster-feature-handover-v6.py` SHA
`114dd95754dce1280d3d93553150b02b07e8cd77f328aab355b4d39a7f60d12b`.
Its inverse must freshly validate `oldTenReadsPreserved=true` and the two prior
native reads; an old nine-read proof is insufficient. These dependencies preserve
the actual b624 API's global browse, claim reveal, birth metadata and holo assets.

Use the existing final plan/acceptance interface, selecting the exact add6d4
receipt and 8f956 helper in `sourceRecovery`/`sourceHelperSha256`. Review requires
actual direct acceptance proofs, four successful current-entry consumer installs,
the v6 feature retirement receipt, complete native coverage, Solana lock/run and
budget evidence, and the unchanged resource/transport artifacts. Missing future
receipts remain blockers; this preparation supplies none.

Default CLI review remains read-only. The existing explicit apply, inspection,
owned rollback and retirement commands are unchanged; do not reuse old operation
folders or infer an apply acknowledgement. Staging must first be reviewed and
performed separately by the owner.

Validation: `python3 -I -B
ops/unified-indexer-transition/final-supervisor-handover-v3-test.py` passes71
controls. It retains all v2 lifecycle/boot tests, replaces the two obsolete v5/old
entry assertions with equivalent current-binding tests, checks the ten-read
inverse, and exercises the exact new source-kind refusals. The fake source helper
is a real temporary protected file deriving its producer SHA from `__file__`;
changed helper bytes fail before execution. All production functions except
`current_source` and `feature_inverse` remain AST-identical to v2.
