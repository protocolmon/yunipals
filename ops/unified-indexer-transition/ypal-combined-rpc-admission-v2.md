# Combined RPC admission v2

The installed v1 default read-only review refused `complete_fixed_unit_state_required`. The actual host diagnostic showed that precisely the five nonexistent new unit names omit `ExecStart` and `EnvironmentFiles`; loaded units include `ExecStart`.

This successor changes only the operation format/directory and that absent-unit parser case. It supplies an empty command only for the fixed new unit names when `LoadState=not-found`, PID0, inactive, no job, no fragment and no drop-ins are all observed. Missing properties on loaded units still fail. The existing typed empty `EnvironmentFiles` proof is unchanged. No admission, SQL, source, inverse, budget, process, expiry or startup semantics changed.

Use the [v1 phases and scope](ypal-combined-rpc-admission-v1.md) with `ypal-combined-rpc-admission-v2.py`. New evidence directory: `/var/backups/yunipals-ypal-combined-rpc-admission-v2-20261023`. The public profile/approval/official-runner paths and hashes stay unchanged. Four-route startup remains closed pending the separately qualified max1 proxy artifact.

The v1 owner remains byte-identical at `02eddae174a3178b59938f991509ce01b088724254064364e80c868377a4e09a`; its failed review made no operation-directory, database or service changes. There is no mutation retry or adoption of ambiguous effects.

Validation:25 Python tests pass. They include exact v1 hash preservation, AST equality of every function except `state`, all five actual omitted-property shapes, loaded/malformed-state refusals, and the existing typed loaded-source fallback. The official runner is unchanged.
