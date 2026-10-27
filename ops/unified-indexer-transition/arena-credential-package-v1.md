# Arena credential compatibility package

Prepared only. No production build, dependency copy, service change, database call or provider call was performed by this preparation. Root must review the frozen builder and the actual same-namespace credential probe before starting it.

This is a narrow successor to frozen `arena-consumer-package-v4.py` (SHA256 `846e4d641b57c5de5e44ba281636a98b3dedc328e1ffcbf460f3ce156de0793b`). It starts from installed source `3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d` and its independently pinned source archive, runtime archive/inventory and completed build proof. The only source changes are `config.ts`, new `privateFile.ts`, and new `privateFile.test.ts` under `apps/yunipals-market-api/src/arena/live`. No worker, selector, transport, dependency or Ponder input changes are included.

The resulting deterministic source identity is `7471e3b544280c0efc2bdb0a4ccfb653f94269f12f5d8e8bb593c3687a6b119f`, manifest SHA256 `85ab1c930c1bb9e3f8d7da2134180bf1ca97b1cf7d3bc06321ddb4bf7a1ab323`, containing 1748 files. Runtime hashes are intentionally unknown until the real offline build succeeds.

## Fixed inputs and staging

Use one new public operation directory, `/opt/yunipals-unified/operations/arena-credential-package-20261022`, and one new empty root-owned 0700 volume directory, `/mnt/HC_Volume_107222036/arena-credential-package-20261022`. Preserve every old operation, release, runtime archive and work directory. The finite file map and hashes are in `arena-credential-package-v1.inputs.json`. Copy only the small public builder/helper/proposal/patch inputs from the prepared archive. Copy the retained 2,202,375-byte source archive directly **on the server** from `/mnt/HC_Volume_107222036/arena-consumer-package-20261021-d/source.tar.gz` to `OPS/base-source.tar.gz`, checking SHA256 `af09ea5b6f557f582e5203dbca38eed6641280bc5b5f49ee180a76b528a7aa2f`. Copy the 6887-byte proof directly from `/var/tmp/yunipals-runtime-3c8776b9-20261021/arena-consumer-package-proof.json` to `OPS/base-consumer-evidence.json`, checking SHA256 `50491f6ddd840a65cbd07d45eeb2923edd88eb62647a8cce5587050d6077b000`. Use exclusive creation; refuse different or existing work/plan/unit state. Neither runtime archive nor installed dependency tree needs to cross the executor or be duplicated during staging.

No original baseline directory is made writable. The two accepted public runtime files are read from `/var/tmp/yunipals-runtime-3c8776b9-20261021`; only the fresh volume workspace receives extracted dependencies. Old volume siblings are inaccessible inside the build namespace, including the old baseline workspace. This is why the small source archive is first copied to the public operation directory.

After independently checking the public builder hash, root can load it without invoking `main` and render the fixed plan and units:

```python
from pathlib import Path
import hashlib, json, types
ops = Path('/opt/yunipals-unified/operations/arena-credential-package-20261022')
path = ops / 'arena-credential-package-v1.py'
raw = path.read_bytes()
assert hashlib.sha256(raw).hexdigest() == 'e0770439a818dd6fa131f5915fe6281fa6bda1d75b82b7c64e2b566102c23a74'
m = types.ModuleType('reviewed_arena_credential_package'); m.__file__ = str(path)
exec(compile(raw, str(path), 'exec'), m.__dict__)
plan = {'format': m.FORMAT, 'operatorSha256': m.sha(raw), 'work': str(m.WORK),
        'baseSourceDigest': m.BASE_DIGEST, 'hiddenVolumeChildren': m.hidden_children()}
# Write using O_EXCL/root-owned no-overwrite staging; do not reuse an old plan.
# m.encoded(plan) -> OPS/plan.json
# m.unit_text('review', plan) -> new review unit below.
```

The review unit is `yunipals-arena-credential-package-v1-review-20261022.service`; build unit is `yunipals-arena-credential-package-v1-build-20261022.service`. Install these as new transient definitions under `/run/systemd/system`. Store each command's stdout/stderr in new root-only files outside empty WORK using the same existing owned output-drop-in pattern as v4. `unit_text` supplies the entire execution and sandbox definition. Existing unit names, source services and workers must not be changed.

Start the review unit once. Its exact command is:

```text
/usr/bin/python3 -B /opt/yunipals-unified/operations/arena-credential-package-20261022/arena-credential-package-v1.py --plan /opt/yunipals-unified/operations/arena-credential-package-20261022/plan.json
```

The review performs no build or work writes. It binds actual effective sandbox properties, zero capabilities, fresh work inode, exact current sibling masks, all accepted baseline artifacts, Node/platform, three patch hashes and rendered eight-unit hashes. Preserve its actual compact result and manager acknowledgement. Do not add another volume sibling between review and build.

Only after root accepts that result, render `unit_text('build', plan)` and replace its single `REVIEW_HASH` with the actual reviewed hash. The build re-runs the same review and refuses any difference. Start the fresh build unit once using `systemctl start --no-block`; observe status in calls shorter than 60 seconds. The command differs only by `--build <actual_review_hash>`. Do not automatically retry an interrupted or failed build or reuse its partial workspace.

## Build and acceptance

Both units are root/root but carry no capability sets, use `NoNewPrivileges`, private network/AF_UNIX only, no environment files, `ProtectSystem=strict`, `ProtectHome=yes` and fixed private-path masks. Only WORK is writable. Bounds remain 2GiB memory/no swap, one CPU, 35-minute outer oneshot deadline, 30-minute helper deadline, bounded command logs and 50MiB/s volume I/O. The monitored allocation cap is 3GB and remaining volume reserve is 25GB; the cap is a sampled bound, not a filesystem quota. Existing volume flock is held without editing its contents.

The builder copies the exact accepted manifest source, clones the existing 330-package/60918-path dependency closure into a fresh tree, and applies only the three fixed patches. It captures deterministic source archives twice, runs the official source verifier, full indexer and full market API typechecks, and the 79 focused credential-reader controls using Node24 with `--import tsx`. The tests use synthetic temporary files and scoped filesystem observations; no production credential, PostgreSQL or provider is accessed. It then runs the ordinary full API build for all 34 bundles and the unchanged catalog smoke test.

The first runtime capture must preserve every path, type, mode, dependency/shim/metadata byte and link target. Only Arena bundle/map files whose **accepted baseline** sourcemaps contain the changed config may differ. Every such config-bearing bundle must now contain the exact new reader source; test sources must never enter any runtime bundle. The standard runtime helper verifies all 34 source maps against the new manifest. Proxy and non-Arena output must stay byte-identical.

A separate relocated source tree then receives runtime-a exclusively, repeats the 79 controls and ordinary full API build, and captures runtime-b. Archive and inventory bytes must match runtime-a exactly. Both source trees and the unchanged 898-island/four-profile catalog are reverified. Rendered native unit files remain public outputs only and are never installed or started by the builder.

Success produces `WORK/arena-consumer-package-proof.json`, `WORK/source.tar.gz`, `WORK/runtime-a/runtime-supplement.tar.gz`, `WORK/runtime-a/runtime-supplement.inventory.json`, and eight `WORK/native-units` files. It records exact actual hashes, both test/build runs and resource observations. Failed/partial attempts remain in `attempt-result.json`, with fixed public labels and hashes; arbitrary compiler/test messages remain in root-only bounded logs.

This creates a candidate package only. Root still owns actual isolated installation, same-namespace reading of real systemd 0440 credentials with boolean-only output, owner/template repinning and runtime replacement. The retained historical proxy bundle must not replace the current source6 proxies. No dependency installation, live private-state migration or public feature cutover is claimed by this build.

## Local checks

```text
python3 -B ops/unified-indexer-transition/arena-credential-package-v1-test.py
python3 -B ops/unified-indexer-transition/arena-consumer-package-v4-test.py
```

14 new boundary controls and 17 retained v4 controls pass. They exercise real tiny archives/files/processes, exact accepted source composition, unrelated source/runtime drift refusal, sourcemap binding, synthetic clean child environment, effective sandbox properties, retained failures and reserve/root-identity guards. They do not build/copy application runtimes or call production.
