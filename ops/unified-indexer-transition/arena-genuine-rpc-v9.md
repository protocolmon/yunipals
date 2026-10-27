Arena-v9 preserves failed [v8](arena-genuine-rpc-v8.md), its h workspace and all old logs. The actual v8 supervisor caught FileNotFoundError while waiting for the running Arena harness, then gracefully sent SIGTERM. Both Ponder generations had started; the harness had emitted no error. The supervisor discarded the original filename/trace, so the historical missing path cannot be proved afterward.

An actual tiny deterministic test exposed the allocator race: the old `os.walk` returned a temporary filename, that entry was deleted, and the allocator's unguarded `lstat` raised FileNotFoundError. During the observed waiting phase, allocator and disk-reserve checks are the supervisor's filesystem activity. This is a supported failure mechanism, not a claim to have recovered the original exception path.

The new allocator uses directory descriptors from `os.fwalk` and no-follow relative stats. It tolerates only vanished child entries. It proves the real WORK directory's UID/GID/mode/device/inode before and after; root disappearance/replacement, symlink root, foreign/device files, permission and other errors remain fatal. The required read-only mirror symlinks are counted as links, never followed. Disk/scratch/time caps and the hard private temporary mounts are unchanged. Future caught failures retain only fixed relative-area labels, errno and numeric frames in the pinned operator, without message, filename, source line or credential values.

The other changes are fresh format9, unit `yunipals-arena-genuine-rpc-20261021-i.service` and absent WORK `20261021-genuine-i`. Production code, handlers, worker logic, generated harness, fee cap, source/runtime/binary/asset pins, exact Anvil fee flags and all network/resource/cleanup guards remain unchanged.

Root stages these three public files under existing protected Arena OPS:

| Local file | Host name | SHA256 |
| --- | --- | --- |
| arena-genuine-rpc-v9.py | arena-genuine-rpc-v9.py | 2be5b2028baec771ec0cd365ccb4ea8b3125ef1cc3cb124e71171eadea0c602b |
| arena-genuine-rpc-v9.plan.example.json | plan-genuine-i.json | dab3590e0329f2e89d144a9a50cfc1a15e883989f1ee22780b24bf2878f96f6d |
| arena-genuine-rpc-v9-rollout.py | arena-genuine-rpc-v9-rollout.py | 7e05b2bd4e110d3ac8a5ef759b3cb1f362d60399e371b4981d03143f99182de4 |

Run the rollout without arguments for the default isolated review. After that review unit is collected, run the same file with `--apply FRESH_HASH`. Keep creation of new volume children paused between review and apply, since their exact masks are part of the approval. No old WORK or started unit is reusable. Logs are new `actual-review-v9.*`/`actual-run-v9.*`; ambiguous starts retain intent and require manual reconciliation.

The helper passes47 local checks, including actual tiny unlink/root replacement/root removal, permission/device/link/cap tests and exact source delta. Three rollout checks prove the previously executed8r2 protocol differs only in names and pins. No host, database, Anvil or provider was started by this agent. Genuine combined lifecycle acceptance still requires the actual final i result.
