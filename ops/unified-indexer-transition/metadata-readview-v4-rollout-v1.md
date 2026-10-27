# Metadata normalization: dormant v4 rollout

The Base ABI represents `rarityScore` as a number, while the legacy metadata API stores it as a string. The corrected metadata reader converts that one field at its read boundary. Canonical indexed events, source build `bf4939b3ff`, and the live Ponder database are unchanged. The full normalized comparison covered 440,194 metadata events with no missing, extra or changed payloads; evidence is in `docs/unified-indexer/production-metadata-fixed-parity-normalized-2026-10-22.json`.

## Installed and staged, still unselected

- The three-entry metadata artifact is `cf333946766e6c858d143612827fc52fd2f860e22af746c56e571513729696cc`, installed under `/opt/yunipals-unified/nonmarket-consumer-releases/`. Its actual installation result is `/var/backups/yunipals-metadata-normalization-runtime-install-v1-20261022/result.json`, SHA `14ca61dac4a1c8ec86f5b64ecbe701a572b2c972fac807c8054a299aed522b83`.
- Seventeen dormant selector/command files are staged under `/var/backups/yunipals-metadata-readview-v4-candidates-v1-20261022/`. Its actual `result.json` SHA is `be0e6ec9f39d9b967a5395a7955496be801a04dc26cf90f3ce7173941e8591a0`. They preserve the existing private environment order and values, changing only the two read-schema selectors and the affected metadata commands.
- New candidate schema: `yunipals_ownership_35cdcb32_v4`. Read identity: `0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d`.
- The old v3 schema, prior candidate files, and installed 41e5/bc540 artifacts remain intact. Main API still uses bc540; collector, Islands API and derived workers retain their prior runtime. The market-only runtime is unaffected.

## Owner review, rollback rehearsal and application

Do not run the metadata database transaction concurrently with the BNB repair's exclusive database phase. Once that phase is released, use ordinary root on `yunipals-main`; the already reviewed peer transport performs its own credential and capability reduction. No provider access is involved.

Stage the new public owner helper into the existing protected operations directory, with SHA `011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948`. Its pinned dependencies are the candidate stager `19b3ab7f…`, metadata installer `08fa7d4c…`, existing peer helper `00cdaae1…`, fixed v4 plan and grants, and `production-rpc-profile-2026-10-20.draft.json` (`eb32453e…`). Verify each exact path and pin before execution. The first host read-only attempt found that last public profile file missing, before making any SQL call; copy the unchanged file from `docs/unified-indexer/` to the expected operations path before repeating the review. This requires no operator change.

Read-only catalog review:

```sh
python3 -B /opt/yunipals-unified/operations/free-replay-20261020/metadata-readview-v4-owner-v1.py \
  --install-receipt-sha 14ca61dac4a1c8ec86f5b64ecbe701a572b2c972fac807c8054a299aed522b83
```

The review binds the exact source manifest/build, source definitions, previous v3 definitions and ACLs, five existing restricted roles, active selectors, and absence of the v4 schema. It does not require an obsolete source invocation to remain alive.

Rehearse the full owner transaction and verify complete rollback:

```sh
python3 -B /opt/yunipals-unified/operations/free-replay-20261020/metadata-readview-v4-owner-v1.py \
  --install-receipt-sha 14ca61dac4a1c8ec86f5b64ecbe701a572b2c972fac807c8054a299aed522b83 \
  --rehearse
```

The transaction uses the exact 19 official owner statements plus only the read grants in `metadata-readview-v4-grants.review.sql`. All copied rights must already exist on v3. Its final guard compares every non-owner schema, relation, column and function ACL, including grant options, to the reviewed grant list. Unexpected default read or write privileges cause rollback. It also proves that existing schemas, roles, source definitions and active selectors are unchanged.

Run a fresh read-only review after rehearsal, then substitute its actual `bindingSha256` below. The helper refuses a stale binding or a prior apply intent; the placeholder is not an executable approval.

```sh
python3 -B /opt/yunipals-unified/operations/free-replay-20261020/metadata-readview-v4-owner-v1.py \
  --install-receipt-sha 14ca61dac4a1c8ec86f5b64ecbe701a572b2c972fac807c8054a299aed522b83 \
  --apply ACTUAL_FRESH_REVIEW_SHA256
```

The durable result will be `/var/backups/yunipals-metadata-readview-v4-owner-v1-20261022/result.json`. Save its actual hash and successful post-commit catalog check. There is no source selection, service start/restart, role login change, physical data update, or provider request in this operation.

## Remaining consumer admission

1. Complete source recovery and its existing canonical-witness/readiness acceptance. Dormant v4 view creation alone does not satisfy source readiness.
2. Use the staged `native-recovery.sh` with the official `native-adopt`, `native-refresh` and `native-provenance` commands at their established cutover phases. The new artifact applies the string conversion consistently in parity comparison, metadata reads and provenance construction. Adoption retains the full tuple comparison, split into sixteen bounded buckets within one repeatable-read transaction.
3. Regenerate metadata publication, derived/cache outputs and staking verification against the v4 identity. Previously stamped v3 generations cannot be relabeled as accepted v4 results. Check API/collector/Islands behavior against the fresh outputs before traffic selection.
4. Use the exact staged candidate drop-ins during the existing stopped-worker/API admission sequence. Staging does not install or select them. The staking file is an updated reviewed template, not a claim that its actual host unit has been compared; final staking admission must compare that unit and preserve its existing runtime and private settings.

## Recovery

The previous v3 schema, permissions and candidate files stay available. Failed SQL rehearsals and failed pre-commit guards roll back atomically. If an apply loses its acknowledgment, its durable intent remains and automatic repetition is refused: inspect the fixed v4 catalog and saved intent first. Do not drop either schema or restore old metadata provenance blindly. Any later selected-consumer rollback follows the existing stopped-worker/identity and generation rules.

## Local verification

`docs/unified-indexer/metadata-readview-v4-owner-local-evidence-2026-10-22.json` records the exact operator/test hashes. Six focused Python tests and nine genuine PostgreSQL 16 checks passed, including rollback, stale review, extra default INSERT/SELECT/EXECUTE privileges, correct normalized committed views, unchanged old catalog and duplicate-creation refusal. The database and fixture roles were disposable and removed afterward. No production or provider calls were made by these tests.
