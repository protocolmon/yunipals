# Native approval scheduling candidate

The candidate runs one native approval task at a time in the existing metadata
worker and pool, independently of awaited enqueue, URI audit and publication
work. It retains the original refresh function, writer advisory lock, quiet
check at 60 seconds, and all 90-second/frontier/canonical/hash/implementation
gates. Signals stop further scheduling; shutdown joins an existing task before
closing the pool. Legacy, unified and publish-only behavior is unchanged.

The actual executed predecessor is normalization artifact `cf333946...`, worker
SHA `5c868742...`. Its authenticated sourcemap embeds archive worker `44d4eddd...`
and normalized native-base `710b77ba...`. The older `e3169833...` source in the
working directory is not that executed bundle. The builder reconstructs all 84
exact predecessor inputs, reproduces its six outputs byte for byte, then changes
only `dist/metadata-worker.mjs` and its sourcemap. The four other CLI files remain
identical. Current changed package files are never substituted for old pins.

The new artifact is
`7489372f92886018d06718401fb46dca2f97e840f6ae56b7fa6b19e488de1887`, manifest
`fc579afc4169b658df1cd3f8faaaba1fa811b0a1db3999c5deba322870712c3b`.
The complete eight-file public payload is committed under
`ops/unified-indexer-transition/ypal-native-metadata-approval-runtime-v1/`.
The preparation record maps every real source and payload file to its exact
deployment target. No private environment file or runtime dependency tree is
included. The installer source manifest authenticates its five Python programs.

`ypal-native-metadata-approval-install-v1.py` reuses the genuine normalization
installer's dependency verification and durable installation functions. It
separately authenticates the real normalization install acknowledgement before
review or install. Its default CLI is inert. Root operators may stage the eight
payload files at
`/opt/yunipals-unified/operations/free-replay-20261020/ypal-native-metadata-approval-runtime-v1/`
and the finite installer source closure at the corresponding OPS filenames.
The actual prior install receipt is
`/var/backups/yunipals-metadata-normalization-runtime-install-v1-20261022/result.json`.
Use that file's actual SHA with `--predecessor-install-sha` and `--review`.
An explicit `--install` with the returned fresh review hash and the same prior
receipt SHA installs the public artifact under
`/opt/yunipals-unified/nonmarket-consumer-releases/7489372f92886018d06718401fb46dca2f97e840f6ae56b7fa6b19e488de1887`.
It performs no database, service, source selection or provider action.

This installation is inactive. A separately reviewed owner must stop the real
current metadata epoch, install its own ExecStart overlay, start and prove the
new program/private context/kernel epoch, and issue a genuine new receipt.
Old 9b operation/selected receipts, the prior program, boot inode and private
environment remain immutable. Neither installation nor local tests qualify the
old selected PID as current, a new live epoch, or sustained production cadence.
An inverse must restore cf333 as a new owned restart before invoking the genuine
old metadata inverse; it cannot relabel the original selected actor.

The evidence supports delay behind foreground awaits; it does not prove every
historical gap has that cause. This change does not bound its own four sequential
RPC calls, database/pool waits or CPU stalls. Existing budgets and fail-closed
freshness remain applicable. Actual epoch and sustained cadence qualification
are still required before consumer acceptance.

Local checks passed: seven actual transformed-worker scheduling/error/shutdown
controls, six genuine compiler/filesystem controls, and four installer controls.
The compiler controls independently reproduced the same artifact in fresh
relocated roots. No database or provider was called by these tests.

Reproduction uses Node 24.18.1:

```sh
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-native-metadata-approval-worker-v1.test.mjs
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-native-metadata-approval-build-v1.test.mjs --predecessor /tmp/yunipals-metadata-normalization-runtime-v1-20261022 --recovery-root /tmp/yunipals-unified-release-hathkqhl/source --recovery-root /tmp/ypal-generation-statistics-v3-source-20261025
python3 -I -B ops/unified-indexer-transition/ypal-native-metadata-approval-install-v1.test.py
```

The recovery roots supply public files only when their bytes match the exact
predecessor manifest. Missing or modified inputs refuse before artifact output.
