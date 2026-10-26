Reader5 forward source handover, 2026-10-26

This is a source procedure. Cache COMMIT, reader timing, LOGIN, publication and
reader/cache acceptance are not claimed here. Root owns all runtime dispatch.
No receipt hash below is a future result.

The first concrete driver is
[ypal-cont5-reader-qualification-owner-v1.py](../../ops/unified-indexer-transition/ypal-cont5-reader-qualification-owner-v1.py).
Its source is byte-identical to the reviewed temporary driver `fd6d00b8…`. Import/default are
inert. Its `--run` is closed until the actual successful cache commit JSON exists
at `/tmp/yunipals-cont5-cache-commit-production-20261026-1.json`. It authenticates
the entire canonical local result, the server root result and all sixteen actual
private proofs, then the actual prepared ACK and committed four-READ receipt.
The protected generation report is the exact `12691114…` report for candidate 105;
its source refs, cache input `2aaf…` and candidate/config relation must agree.

The genuine static renderer is `ypal-ordinary-publication-continue-inputs-v5.py`
(`e3d95076…`). Its `reader_inputs(actualPreparedSHA,455c09d5…)` loads recorded
receipt ancestry only. It returns exactly ten reader refs plus the actual
immutable metadata refs. The driver saves both the complete renderer result and
the ten-ref dictionary as exclusive 0600 private audit files. It does not create
a new admission, installer, transport, candidate, metadata selection or ACK.

The driver constructs one fresh
`caller.Session(report['sourceRefs'],455c09d5…,actualMetadataRefs)`, executes its
full `preflight()`, then
`session.reader_context(455c09d5…,actualTenRefs)`. The accepted metadata epoch,
prepared cache receipt and entire actual reader context must agree. The reader
operation directory must still be absent and LOGIN disabled. It invokes only
`caller.qualify_reader(session,captureId)` and authenticates the actual result
with `session.continuation_caller.require_timing(session,ref,'reader-before-login')`.

Reader timing uses the unchanged original prepublication predicates plus legacy
HTTP and full Source postflight. It opens no rollback transaction. The receipt
is explicitly `syntheticTimingInputOnly:true`, `productionCOMMITQualified:false`;
the original protocol requires measured callback time plus 70 seconds strictly
less than 240 seconds. The 1200/1220-second root preparation/transport bounds do not
extend that callback window or the cache 90-second approval and 5-second reserve.
Only subprocess diagnostics observe the original read commands; no SQL/Popen
transport wrapper or predicate is replaced. Memory histories cover the retained
Session and reader-context Epoch instances, not every temporary nested Context.

The subsequent order, to be implemented as separate reviewed root actions, is:

1. With the actual private ten refs and before-LOGIN timing ref, construct a
   fresh forward Session/context and run
   `execute_reader(session,'review',[inputs],ownReviewAttempt)`. Authenticate its
   actual `reviewHash` and `binding.loginAuthorizationSha256`; then dispatch
   `execute_reader(session,'admit-readers',[inputs,reviewHash,loginAuthorization],ownAdmitAttempt,timingRef)`.
   The genuine body reexecutes full review, both role/catalog checks, owned SQL
   session/XID/prepared callback and Source pre/postflight. Any unknown LOGIN
   outcome requires inspection of that actual intent/prepared XID and catalog;
   no automatic rerun or inferred role change is permitted.
2. After the actual roles-admitted receipt and committed LOGIN XID, construct a
   fresh post-LOGIN Session/context. Obtain a new genuine reader capture with
   mode `reader-after-login`. The earlier before-LOGIN receipt cannot authorize
   publication because its mode/context comparison must match exactly.
3. Run the genuine `execute_reader(...,'publication-review',[],ownAttempt)`.
   Authenticate the returned publication review and actual installed full BNB
   action proof. Only a separate explicit
   `execute_reader(...,'publish',[actualReviewHash],ownPublishAttempt,afterLoginTimingRef)`
   may dispatch the original publication transition. It retains the single
   private/business session, generation 105/predecessor 103 CAS, wallet/two-stamp
   publication, literal prepared acknowledgements and XID journals.
4. `publish` itself calls the original finite `complete_readers`: each of main,
   collector and islands gets a preview start/positive API acceptance/owned
   drain, exact old reader stop, native definition/start/positive acceptance,
   boot restoration and final all-three health. It retains actual API/action and
   staking-status route checks. If it stops after publication, preserve the
   publication and actor journals. Only actual `continue-review`/`continue-readers`
   or a named reconcile path may finish its current owned phase; never republish.
5. Cache worker startup is separate: obtain the actual completed reader result
   and its immutable ACK, build the same bound root/proof/current Context, and
   obtain the context's actual `root.cache_finish_module(context)` factory.
   Its own review/start/acceptance-review/accept sequence must retain full four
   official freshness checks, actual three reader acceptance, exact old boot
   archive inode and own cache actor/start/reload journals. Do not import the
   frozen unbound cache finish entry as if it were the continued Reader5 owner.
   The current derived cache-finish review still requests a new-directory
   `stopped.json`, while CONT5 authenticates the actual stopped-cache receipt in
   the retained old directory. This later step needs a separately reviewed
   explicit stop-ancestry successor; no new stop ACK may be fabricated.

The initial driver has no LOGIN/publication/cache/reader/service action API,
inverse constructor or generic retry. Later action drivers remain unimplemented
until their actual predecessor receipts exist and their exact contracts are
reviewed. Before traffic cutover, the separately qualified coordinated inverse
must be ready: own-stop Reader5/cache while Ready1/cache4/two LOGIN remain,
distinct metadata inverse2 restores an acknowledged new CF333 invocation, then
later LOGIN/cacheguard/original9b reversal follows its actual owned prefix.
Arena business inverse4 and required fresh native-return4 are separate owners;
neither current2 support nor this reader timing receipt grants their authority.
