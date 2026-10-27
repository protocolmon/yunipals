# Native generation publication and three reader cutover

This package prepares one coordinated transition for the current YPAL combined
release. It performs no action during source preparation. Every execution needs
the exact external `ypal-native-cutover-v1.manifest.json` and real protected input
receipts. A default review cannot manufacture an admission, candidate, witness,
service acknowledgement or successful installation.

The six runtime files are the root owner, publication child, proof module,
separate cache finish owner, bounded BNB fixture SQL and main action probe. The
manifest pins them plus their fixed predecessor dependencies. It is supplied by
SHA explicitly; no runtime file includes a hash of itself or a future receipt.
Historical owners and receipts remain unchanged. Capture detailed stdout only
in root-private storage: reviews contain internal catalog and process facts.

## Preconditions and authorization

The default review requires all of these actual facts:

- The separate 143 READ admission and c54 cache preparation, including its
  separately authorized four collector SELECTs, are acknowledged. Their complete
  relation ACLs, column ACLs, roles, object identities and transaction chains
  remain exact. Only the same four invalidation epochs may advance monotonically.
- The 762bc generation candidate is built and validated but unpublished, its
  predecessor is still generation 103, its capsule is authenticated, and the
  legacy fallback acceptance in the cache preparer still serves 103. No recurring
  generation worker is running or enabled.
- Current native source witnesses are ready; the exact source, free proxies and
  live YPAL service are preserved. The sustained ordinary observer has an actual
  nonexpiring activation acknowledgement. A one-hour qualification is insufficient.
- All six fixed-boundary ownership, lifecycle and history datasets pass their
  original baseline comparison **and** the separate canonical witness validates.
  The witness plan must bind the fixed protected parity and witness paths. A
  data comparison with missing historical block hashes is not canonical acceptance.
- The immutable metadata comparison validates all sixteen partitions. Selected
  native metadata, all current published provenance and final actor/private-input
  CAS are separately current. Capture-time comparison is not current readiness.
- The publisher and main successor have their actual installed acknowledgements;
  collector and Islands retain their exact accepted source closure. All three
  original reader actors, private inputs, ordered selectors and activation links
  are captured before changing them.

The owner separately admits **only two existing LOGIN bits**, main and Islands.
Collector remains LOGIN true. This needs its own reviewed authorization; neither
the 143 READ acknowledgement nor the cache four-read acknowledgement authorizes
it. No DML, role creation, password change or other privilege is added here.

## Review and forward execution

Use the existing fixed root host, shared source transition lock and generation
owner lock. Stage the reviewed public files separately; this owner is not a
stager. A private input JSON contains exactly six actual SHA-256 strings:

```json
{
  "sourceManifestSha256": "<actual exact public manifest SHA>",
  "cachePreparedSha256": "<actual c54 prepared.json SHA>",
  "publisherInstallSha256": "<actual acknowledged publisher install SHA>",
  "mainInstallSha256": "<actual acknowledged main install SHA>",
  "parityWitnessSha256": "<actual canonical witness result SHA>",
  "sustainedObserverSha256": "<actual sustained observer result SHA>"
}
```

Those labels are documentation, not valid input hashes. The program refuses
absent files, wrong producers and guessed receipts. With shell variables bound
from actual private files and reviewed outputs, the commands are:

```sh
python3 -I -B "$OPS/ypal-native-cutover-v1.py" \
  --source-manifest-sha "$MANIFEST_SHA" \
  --inputs "$INPUT_FILE" --inputs-sha "$INPUT_SHA"

python3 -I -B "$OPS/ypal-native-cutover-v1.py" \
  --source-manifest-sha "$MANIFEST_SHA" \
  --inputs "$INPUT_FILE" --inputs-sha "$INPUT_SHA" \
  --admit-readers "$REVIEW_HASH" --authorization-sha "$APPROVED_LOGIN_DELTA_SHA"

python3 -I -B "$OPS/ypal-native-cutover-v1.py" \
  --source-manifest-sha "$MANIFEST_SHA" --publication-review

python3 -I -B "$OPS/ypal-native-cutover-v1.py" \
  --source-manifest-sha "$MANIFEST_SHA" --publish "$PUBLICATION_REVIEW_HASH"
```

`OPS` is the fixed `/opt/yunipals-unified/operations/free-replay-20261020` path.
The operation directory is
`/var/backups/yunipals-ypal-native-cutover-v1-20261024`.

The publication review first runs the bounded installed-main action probe as the
existing restricted main peer. It uses a genuine, bounded native BNB transaction
candidate joined to full receipt evidence, canonical event and header; no missing
fixture is fabricated. The probe makes no listener or provider connection and
allows only its local read-only peer database socket. Actual host peer execution
is a separate prerequisite check, not claimed by local DTO/SQL tests.

The publication child authenticates as the retained `yunipals` database role on
one persistent client. Heavy leaderboard work uses a repeatable-read private
snapshot and commits only session-private temporary rows. A read-committed
transaction stages wallet statistics and stamps invisibly. Root records the
actual backend/XID and private handle before authorizing the final dual-proof
pointer/traits CAS followed immediately by the sole global COMMIT. Its database
URL stays in the child's environment, never arguments or protocol records.

After the actual COMMIT acknowledgement the owner previews each native reader,
drains only that reader's kernel-attributed backend subset, publishes its exact
overlay, starts it once and tests the fixed enabled features. Main includes full
BNB action evidence; collector includes owned Color filtering; Islands includes
staking. Solana, ENS and legacy metadata routes remain acceptance gates. Final
acceptance repeats actual HTTP and private/process facts for all three readers.
No old PID is claimed restored after a restart.

The post-COMMIT window is bounded to 600 seconds per explicit attempt. Manager
dispatch refuses an expired window. A failure preserves the actual partially
completed state. The result reports the measured COMMIT-to-reader-health gap, or
an honest unknown commit time after lost acknowledgement. It makes no zero-outage
claim. The native cache and recurring generation worker remain stopped.

## Unknown acknowledgements and explicit recovery

Never rerun `--publish`, an unknown SQL transaction, start or stop. Default
`--inspect` reports current owned phases without retrying them.

- `--reconcile-roles INTENT_SHA` and `--reconcile-publication INTENT_SHA` inspect
  their own durable XID, terminated child/backend and exact actual postcondition.
  In-progress, unknown, foreign or contradictory states refuse.
- Use `--service NAME --service-phase PHASE --service-reconcile-review`, then
  `--reconcile-service REVIEW_HASH`, for one fixed already-requested preview
  start/stop, original stop, reader start or reload. This performs no service action.
- `--continue-review` followed by `--continue-readers REVIEW_HASH` opens a new
  explicit bounded reader-completion window. It never republishes and refuses
  unreconciled service actions.
- For a lost configuration reload, `--reload-phase PHASE --reload-review` binds
  the current files, actors and original intent. `--reconcile-reload REVIEW_HASH`
  acknowledges an already loaded postcondition without a manager request.
  `--reload-config REVIEW_HASH` is a separately explicit daemon-reload-only
  request, limited to three per phase. It checks pending fragments/drop-ins on
  disk and recaptures the review after fsync. It cannot start, stop or issue SQL.
- A proved aborted, unstarted publication attempt may be separately reviewed
  with `--archive-publication-review` and archived with
  `--archive-publication REVIEW_HASH`. Exclusive same-filesystem rename preserves
  all old bytes/inodes. Unknown effects, service intents, foreign ACLs or epoch
  decreases refuse. Archiving never starts a retry.

## Serving inverse

`--inverse-review` followed by `--inverse REVIEW_HASH` starts one explicit owned
inverse; `--finish-inverse THE_ORIGINAL_INVERSE_REVIEW_HASH` completes its known
prefix. It drains owned previews/readers/cache and their exact current kernel
backend subsets, restores original reader definitions, reverses only its two
LOGIN bits and the cache's four reads/guard, then restores global generation 103,
wallet statistics and stamps through the authenticated capsule. The 143 READ
admission remains admitted.

An acknowledged combined source may be terminal. Inverse-only source proof still
requires its exact static/private/profile/catalog/boot lineage and absence of a
replacement, but never claims source readiness. The new metadata inverse context
authenticates the same operation and unchanged private/table/role/proxy identities
and delegates to the unchanged 772 leaves. It restores real RPC mode and the
original writer before old readers/cache serve. Lost original-start acknowledgement
is reconciled against the actual owned writer and monotonic cursor; it does not
reset a cursor or send a second start. Full real legacy HTTP acceptance ends the
inverse. A durable inactive intermediate state is not reported as serving recovery.

An already-failed acknowledged reader, cache or metadata invocation can be
observed terminal without another stop. Its exact invocation/static/private
lineage, empty cgroup and gone processes are required. Every remaining backend
of its fixed database role must map positively through kernel socket peers to
another live process identity. An orphan, ambiguous or changing backend refuses;
the owner never assumes shared-role connection count zero or uses session age.

Unknown inverse SQL uses `--inverse-phase roles|cache|capsule --intent-sha SHA
--reconcile-inverse`; its actual own committed XID and complete postcondition are
required. No inverse SQL is silently resent. Reload recovery above also covers
fixed metadata and old-cache configuration phases. A failed or not-yet-running
unknown start remains a refusal rather than permission to resend it.

## Cache finish and later managed ownership

After an actual completed three-reader result, review the separate
`ypal-cache-finish-v2.py --source-manifest-sha SHA --cutover-sha SHA`.
`--start REVIEW_HASH` starts the accepted official cache worker once; it is not
yet acceptance. `--accept-review` and `--accept REVIEW_HASH` require actual
four-collection official freshness plus full reader HTTP and boot/actor proof.
Its `--reconcile-start` inspects a lost start ACK without another request.
Cache-only reload recovery has fixed `native-load`, `native-enable` and
`inverse-disable` phases. Inverse uses the root coordinator's ordered recovery.

`validate_reader_leaf(result_sha, manifest_sha, feature_refs=None)` and
`validate_cache_leaf(result_sha, manifest_sha, feature_refs=None)` are narrow
facts for a **new separately pinned managed owner**. They qualify their actual
owned actors, private/definition/inode/session facts, global publication, metadata
provenance and own four role slices. Exact optional e506 retirement/manifest/input
SHA references compose only its eight collector SELECTs. Both leaves explicitly
return source, observer, financial and full-global-role authority as false.
They do not call obsolete c96/f81 whole qualifiers after a parent takeover.

The reader leaf exposes authenticated full recorded catalogs at
`recordedRead143AndCache4Catalog` (`/postProof/catalog`) and
`recordedRead143Cache4AndTwoLOGINCatalog` (`/after`) so the managed owner can verify
the complete composed graph itself. It must supply current source/observer/financial
authority separately. CLI forward and inverse gates remain strict; an internal
later-owner context must bind the exact same operation and external manifest.

Recurring generation, descendant publication lineage, automatic 24-hour refresh,
fresh YPAL reader retirement, Arena and final managed EVM/Solana takeover remain
separate unfinished acceptance boundaries. This initial-candidate capsule cannot
authenticate an unrelated later generation. None is reported complete here.

## Local validation

```sh
python3 -I -B ops/unified-indexer-transition/ypal-native-cutover-v1.test.py
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-native-reader-probe-v1.test.mjs
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-native-reader-probe-v1-postgres.test.mjs
```

The frozen publication child has a separate ten-group genuine disposable PG16
suite, independently rerun before this owner freeze. No production peer launch,
publication, LOGIN change, service transition or full serving inverse is claimed
from local tests. All actual reviews/receipts and row-bearing fixtures stay private.
