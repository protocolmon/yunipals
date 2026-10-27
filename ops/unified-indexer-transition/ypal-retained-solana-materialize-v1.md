# Retained Solana child configuration materialization

The planned managed child reads `/etc/yunipals-unified/solana.env`. The actual inactive managed v2 review stopped before staging because this future path was absent. Existing Solana still uses its original configuration; no missing production credential is inferred.

This operator copies the exact existing `private/solana.env` from authenticated stage35093ff3/review77ee7e43 to that new path. The two original root0600 files, selected staged root:9640640 inode, actual Solana actor/definition/boot and restored source/pack peers must remain exact. It creates no credential or principal, changes no existing permission, writes no database and starts no service. The new root:9640640 target has the same child group access as the already-qualified stage. A new directory, if required, is root0755; existing directories must retain their exact identity and mode.

Default mode returns static metadata before constructing a host. On the actual host, run `python3 -I -B` with `--review`, then `--stage ACTUAL_REVIEW_HASH`. The same shared transition lock guards both phases. Stage creates exclusive root0700/0600 audit records and an absent-only target, rechecks source bytes before copying and runs a cap-dropped UID970/GID964 no-import hash read. Only that actual read can qualify production readability. Any unknown or partial result is preserved and refuses automatic retry/overwrite.

Eight focused filesystem/lifecycle controls pass independently. The local executor maps only gid0, so fixture chown records the exact requested964 and uses mapped gid0 for local file effects; this is not production gid/readability evidence. Actual server execution remains pending.
