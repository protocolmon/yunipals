# Actual synthetic scanner qualification

V4 is the frozen synthetic-only owner `arena-public-scanner-probe-v4.py` SHA `1c95c5c1422393864eaac6b5a2aabd21e5618153c8a5e6bd1335054984a39494`. It retains the exact `arena-public-scanner-probe-v1.mjs` probe SHA `34a2051062a2ba52d93a87c0598a4330ed29de8e1a5354954617ada80494d5ed` and public rollback/credential reader child f606. Its fixed reader-probe unit is separate from the actual scanner unit.

The only credential is a public, fixed synthetic connection string. The unit uses DynamicUser, a private network, blocked network/database APIs and a 45-second lifetime, with no boot links or automatic restart. It imports the exact installed 264a public projector/runtime code and constructs clients without opening connections. It never calls the scanner loop or an actual database, provider, RPC, signer or broadcaster.

V4 accepts an absent opaque `LoadCredential` display only when all seven exact absent-unit metadata fields and the typed `a(ss)[]` value agree. Once loaded, it accepts only the exact fixed fake credential tuple for its fresh V4 evidence directory. Unknown/foreign credentials and missing metadata refuse. This does not relax the frozen credential reader.

The actual one-time production run passed on 23 October. The DynamicUser credential mount was root-owned 0440 inside root-owned 0550 readonly tmpfs with the required mount flags; both the reader and installed imports/client constructors qualified. Database connections and network requests were zero. The owner stopped its exact process and removed the fake credential, temporary programs and transient unit. A separate terminal read confirmed not-found/inactive/dead, PID0, empty job, successful result, no boot links and zero stderr.

The [public production evidence](../../docs/unified-indexer/arena-public-scanner-synthetic-production-qualification-v4-2026-10-23.json) contains the review, actual process/mount observations, protected receipt hashes and independent terminal verification. This proves the synthetic mount/import boundary only; target database authentication, RPC reachability, financial authority, source coverage and actual fallback selection remain separate requirements. Historical v1–v3 code/receipts are not rewritten.

Local validation commands:

```sh
python3 ops/unified-indexer-transition/arena-public-scanner-probe-v4-test.py
node ops/unified-indexer-transition/arena-public-scanner-probe-v1-test.mjs
```

Twenty Python controls and five JavaScript controls cover the fixed metadata, fake-only isolation and owned cleanup. An actual run is not repeated to reproduce the publication checks. Default owner execution is read-only review; `--run` requires its fresh exact review hash and an unused evidence namespace. The completed V4 namespace must remain preserved, so another invocation cannot silently repeat that operation.
