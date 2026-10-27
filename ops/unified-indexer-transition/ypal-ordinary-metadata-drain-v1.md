# Initial ordinary V5 metadata drain

This executor addresses transient PostgreSQL session inventories in the initial metadata review. It is limited to the existing, not-yet-created V5 metadata operation. It neither adopts native metadata nor selects or starts a writer. The published common context and metadata owner remain unchanged.

The executor loads the exact published common/owner/template and the fixed actual execution input and staged candidate references. It obtains the genuine original review, retains its full binding and database observation privately, and computes a separate action digest over every original binding field except `oldSessions`, plus the independently qualified current source and V5 READ binding. The original writer unit, invocation, process start ticks, private file hashes, boot inode, candidate and execution ancestry all remain in the action digest. Coverage is checked freshly before any drain.

Only the session inventory is observational. Immediately before the original operation directory is created, an additional fence rechecks private inputs, the exact writer, boot/drop state, and source/READ authority. The real original drain then writes its fresh full binding to the original V5 `operation.json`. It retains its boot removal, daemon reload, fresh session capture, durable stop intent, immediate actor comparison, one stop, owned-process/backend drain proof and covered cursor checks. Downstream adoption, selection, provenance and inverse continue to use the unchanged original V5 owner and the genuine resulting operation hash.

## Bounded read-only observation

The genuine current session body and kernel mapper are reused. A disappearing unrelated PostgreSQL backend can invalidate the UID-specific `/proc` read. The executor retries only when that exact backend peer read failed and a fresh query proves the backend tuple set changed, or when the genuine session body's two queries prove churn. It checks the same writer, private inputs and source/READ authority before continuing. A permissions failure with unchanged tuples, a client-process failure, a changed actor or a changed source/READ binding refuses.

There are at most three observations within 90 seconds of each session capture, under the original 720-second whole-phase deadline. All successful and retried observations are retained privately. These retries never redispatch daemon reload, stop, SQL writes or another effect. The existing pre-stop session capture remains mandatory and its actual mapped owned tuples are checked after stop; other peers are not required to retain the same sessions.

## Review and one attempt

Run the new executor with `--input-sha` set to its fixed actual execution input. Default invocation without arguments is static and has no effects. A live review creates only an exclusive root-private observation in the executor's separate directory. It returns the stable `reviewHash` and private observation hash/path, without private values.

After reviewing that observation, use `--input-sha <actual input hash> --apply <stable review hash>`. The executor performs a full fresh review, compares its own action digest, and fsyncs an exclusive apply intent before invoking the original drain. The new result records the original owner, exact original operation hash and acknowledged drained receipt. The original operation retains its original producer; the executor never substitutes its hash for the old CLI's full-review hash.

A second apply attempt is forbidden after an intent exists, including a failed or lost acknowledgment. Do not delete either journal or manufacture the old review hash.

## Unknown acknowledgment and recovery

`--input-sha <actual input hash> --reconcile <apply-intent file hash>` is read-only with respect to the worker, database and original operation. It authenticates its own durable intent, the exact original operation and the original completed drain proof. It can write its own missing result after a lost acknowledgment, even without a `failed.json` marker. It cannot resend stop, complete an incomplete drain, adopt metadata or acknowledge an operation that has already advanced to a later phase.

If only a partial original drain exists, preserve both journals and inspect the original owner's existing reconciliation/inverse path. This executor refuses incomplete or later-phase state. Once a successful drain is acknowledged, pass its genuine original operation hash to the unchanged metadata owner's later phases. No new global lifecycle or rollback protocol is introduced.

## Local validation

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-metadata-drain-v1.test.py
```

The suite executes the exact frozen session/mapper and drain bodies with synthetic kernel facts and real private filesystem fixtures. It covers stable authority versus changed session inventories, source/actor/private drift, bounded churn and non-retryable failures, the single additional pre-effect fence, fresh pre-stop tuples, unchanged original operation identity, no repeated stop after unknown acknowledgment, intent-only reconciliation, and exclusive private journal handling. It does not claim a live drain or adoption.
