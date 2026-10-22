# Modern Arena constructor qualification

This operator tests an **already built and installed, unselected** modern Arena release against the retained production configuration. It does not run the owner migration, stop/start a service, change selectors, modify private files, start a worker loop, invoke an artwork/referee provider, sign or broadcast a transaction. The committed twelve migrations remain in place.

`arena-modern-runtime-preflight-v1.py` pins the actual owner-v11 and runtime-restore-v1 operators and receipts. It checks all eight original definitions, runtime entry hashes, private input hashes, current exact post-restore PID/start/invocation/UID971/GID965/argv/cwd/cgroup identities, and the existing read-only operational schema checks. A restarted or replaced worker requires investigation; it is not silently adopted by this operator.

The candidate plan is a protected root-owned JSON file with exactly these fields. Populate every digest and file from the **actual completed modern build/install**; there are no default or placeholder candidate pins:

- `format`: `yunipals-arena-modern-runtime-preflight-v1`
- `sourceDigest`, `sourceManifestSha256`
- `packageProofFile`, `packageProofSha256`
- `runtimeInventoryFile`, `runtimeInventorySha256`, `runtimeArchiveSha256`
- `installResultFile`, `installResultSha256`

The three artifact files must share one protected installation artifact directory, with names `arena-consumer-package-proof.json`, `runtime-supplement.inventory.json` and `install-result.json`. The source root is derived as `/opt/yunipals-unified/releases/<sourceDigest>`. The install result must be `yunipals-arena-modern-install-v1`, affirm an actual completed install, bind these exact proof/source/runtime hashes and counts, and record zero service/database/source-selection changes and `runtimeStarted:false`. Source and installed runtime inventories are fully verified; successful qualification does not imply the deferred 898-PNG media acceptance.

Run on the existing fixed host as root, after the new source/runtime install receipt exists. Shell variables below represent public hashes/paths, never private settings:

```sh
python3 -B /opt/yunipals-unified/operations/free-replay-20261020/arena-modern-runtime-preflight-v1.py \
  --plan "$PUBLIC_PLAN" --plan-sha256 "$ACTUAL_PLAN_SHA256" --scope api
```

The default action is read-only file/process/schema review: **zero constructor invocations and zero RPC requests**. Run the same command with `--qualify "$FRESH_REVIEW_HASH"` to qualify the API context. A successful result explicitly says `scope:"api", qualifiedContexts:1`; it is not an eight-context acceptance. For the complete qualification, obtain a fresh review using `--scope all-eight`, then repeat that exact scope with its returned review hash. No persistent intent or automatic retry is created. Save stdout externally only if the caller wants a receipt; the operator itself does not create output files.

For each selected context the root process reads `/proc/<retained-pid>/environ` into memory, checks the exact current credential-directory/rules/legacy settings, and seals it in an anonymous memfd. The fixed public command enters that PID's mount namespace, drops to UID971/GID965 with no supplementary groups, inherited/ambient capabilities or new privileges, and runs a small isolated relay. The relay verifies its dropped identity/capabilities, then execs the accepted Node24 binary with the actual retained environment. Environment values never appear in argv, stdout, exception messages or exported records. Only `TSX_DISABLE_CACHE=1` is added to prevent TypeScript cache writes; service configuration is not rewritten. Nonempty Node preload options are refused.

The source-qualified TypeScript script uses the installed `tsx` dependency and imports only the catalog/configuration dependencies and `src/arena/live/runtime.ts`. It calls `arenaRuntime({native:false})`, then `close()`. It never imports a worker entrypoint or calls `admit`, `step`, `loop`, `listen`, provider helpers or transaction methods. Every created PG pool has connection-level `default_transaction_read_only=on`. The scoped connection URL and explicit client settings both enforce statement/query timeouts of 5 seconds, lock timeout of 2 seconds, idle transaction timeout of 15 seconds and connection timeout of 2 seconds. These override conflicting URL query options without changing the actual process environment, endpoint, database, user, password or existing option prefix; PG URL parsing cannot remove the final read-only setting. The script requires both the candidate catalog and **the actual unchanged `ARENA_REPOSITORY_ROOT` catalog** to compute production rules hash `0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80`, the approved pool hash and all 898 islands, with the complete manifest matching the candidate's canonical production manifest. A matching env string alone is insufficient.

The constructor's existing Base multicall validates current contract settings and signer address. A fetch boundary admits only JSON-RPC `eth_call` and optional `eth_chainId` to the **actual Base read URL derived from the candidate's existing RPC registry configuration**. It permits at most three read requests per context. Provider URLs, broadcasts, state overrides and other methods are rejected before dispatch. It does not change endpoints or credentials to make qualification pass. RPC reads can consume the existing production read allowance; no paid AI/media request occurs.

The retained actor identity and exact environment hash are checked before/after each constructor; private source bytes are rechecked, then all eight actors, definitions, committed schema, complete candidate source and runtime are checked again. Child output is parsed against an exact success-field allowlist, and failures are reduced to fixed public codes. A timed-out child process group is killed to avoid leaving a TypeScript/esbuild helper behind. The operator does not resume, restart or select any runtime on failure.

No helper-data mount or credential export is required: the candidate is read from its existing immutable release path, the current credential mount is inherited via `nsenter`, and scripts/environment use anonymous memory. Actual namespace availability, dropped-identity execution and successful constructor outputs remain **production acceptance gates**; the offline tests do not claim those have passed.

Offline checks:

```sh
python3 ops/unified-indexer-transition/arena-modern-runtime-preflight-v1-test.py
```

These execute generated JavaScript against synthetic TS-import/PG/RPC modules, plus receipt, protected-file, sealed-FD, actor-race and private-input controls. They do not contact a host, database, provider or chain.
