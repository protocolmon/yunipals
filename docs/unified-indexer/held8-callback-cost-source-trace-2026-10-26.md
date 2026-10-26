# HELD8 callback cost: source trace and measured limits

HELD8 returned no qualification. Its actual root result is `28d884331e5dbfe5cf5387c2f3af8e7bdbfcc25cdedd31729a57ded8b281bab7`. Witness2 retained `actual_approval_deadline_before_literal_COMMIT_ACK_requires_rollback`. The six physical capture files include the genuine prepared observation, explicitly marked `neverProductionPreparedACK`, and omit the complete-callback receipt. This establishes that the original prepared checks reached their observation save and the subsequent approval-deadline check refused. It does not establish a completed callback, accepted literal ACK, COMMIT or restored catalog.

Root's numeric projection places the first cache-Epoch actor capture at 50.123097105 seconds after the late approval gate, lasting 14.776908094 seconds. The second starts at 92.921741229 seconds and lasts 15.398686103 seconds. Both succeed on their first attempt. Their combined 30.175594197 seconds are actual actor-capture time; the approximately 28.021736030-second interval between them and the time before the first capture have no finer measured attribution. The earlier two discarded captures belong to the Session Epoch before this gate. The initial gate had 78.967413361 seconds remaining. The 118.412109423-second root qualifier phase includes work outside the measured held callback and is not a successful callback budget.

The existing passive `2e40` observer records command counts, result sizes and failures, without durations. Root reported 1,629 calls over the whole attempt: 945 busctl, 303 systemctl, 286 setpriv, 64 Node, 24 ss and seven other calls. These are whole-attempt counts. They cannot identify callback command durations or establish that a particular command family caused the overrun.

## Complete prepared path

The retained `commit.prepared` body in `ypal-cache-guard-owner-v1.py` checks the packet's mode and rehearsal plan, runs the complete `read_extension`, then calls `stopped`, `host.refresh`, and `host.prerequisites` before saving the prepared packet. C413's rollback compiler redirects only that save to the actual observation. The provider's guarded callback then calls `before_literal_ack`; the genuine `check_deadline` refused before it could save a complete-callback receipt or return the retained ACK.

`Host.prerequisites` retains the complete generation candidate validation and current generation/base-frame query, followed by `metadata_current`. The actual caller binds a `PreparedMetadata` slot before the held child. Its `invoke` still authenticates the immutable constructor files and current target-object identities, then executes the complete metadata body with the exact preconstructed Host and callback.

The callback passed to metadata is the same cache Host's `refresh`. There are four fresh cache READ/Source refreshes in this prepared path:

1. The direct `host.refresh` before `host.prerequisites`.
2. `PreparedMetadata.invoke`'s constructor seam calls the retained metadata Host's `refresh`.
3. The retained metadata `operation` calls that Host's `refresh`.
4. The retained metadata body's final `h.refresh` occurs after the native DB and full canonical publication checks, before its second actor bookend.

Each invokes the complete current catalog/column graph and the bound Source current check. They occur at different barriers. Reusing an earlier source or metadata result, or deleting one of these refreshes, would change the proof and is not proposed here.

Inside metadata, the first fresh actor capture precedes `database` and `publication_proof`; its second follows those queries and the final refresh. Therefore the measured gap between the two captures contains native DB, full publication, and the final READ/Source refresh. Source ordering alone cannot apportion their costs.

## Repeated static work and fresh dynamic work

Each observed actor capture invokes the genuine observer, which authenticates its public source closure and constructs a fresh Owner3 namespace. Its genuine `actor_current` authenticates immutable ACKs, constructs a fresh Owner3 Context, calls `read_operation` twice, captures positive owned kernel sessions, checks the actor twice and checks previous epochs terminal. The Context constructor runs the actual new installer check once. Each `read_operation` calls `inputs`, which repeats that installed-artifact check. `metadata_primitives` also checks the predecessor installer during construction.

The source therefore contains three new-installer checks and one predecessor-only check per actor capture. A new-installer check verifies both the new artifact and its predecessor, giving seven dependency/artifact checks across those calls. This is a source count, not a production duration measurement. `metadata-normalization-runtime-install-v1.py:dependencies` freshly verifies artifact receipts, Node bytes, actual external module resolution and selected entry bytes. It and `consumer-final-runtime-v1.py:accepted` parse the acknowledged 60,918-entry inventory. They do not rehash all 60,918 runtime files; their return explicitly says `fullDependencyTreeRehashed: false`. The separate genuine dependency preauthorization tree walk is outside this attribution.

The bound Source current object is already retained across calls. Its complete current body still performs two manager/private/process frames, original input checks, two native/heartbeat checks, registration, finance and positive kernel attribution. Each manager frame obtains fresh typed Unit/Service properties for the eleven units, checks the selected full property set, process/mount identities, private files, activation and retired units. These fresh facts must not become cached successful observations.

## Local measurement and next evidence

A local public-source-only benchmark ran the genuine `17a` observer's `owner_module` twice. Only protected canonical source I/O was relocated to the actual repository bytes. It constructed no Context and called no actor-current, query, SQL or service function. Each construction read 791 public source instances totalling 16,808,151 bytes and made 24 compile/AST-parse calls. The two wall times were 0.374 and 0.422 seconds; summed compile CPU was 0.059 and 0.056 seconds. Fresh namespace, Context class and function-global isolation were checked. This narrow compilation cost is small on the local machine and does not explain the production overrun. The temporary reproducible harness is `/tmp/ypal-held8-static-owner-construction-benchmark.py`.

A separate local parse of an 18.1-MB historical 60,918-entry inventory took approximately 64–76 milliseconds. Its source digest differs from the production accepted inventory, and the result is only a scale measurement. It is not a production timing or evidence that inventory parsing dominates.

The next discriminating measurement would retain original `subprocess.run` arguments, environment, timeouts, returned objects and exceptions while privately measuring call durations in a new passive observer. A genuine read-only `Host.refresh` plus `Host.prerequisites` benchmark could then distinguish command and non-command cost without a SQL mutation or qualifier. Such a benchmark would confer no held timing authority and would not replace another actual qualification. No new observer, benchmark driver, code cache or runtime change is included here.

Caching compiled code remains only a candidate after measurement. It would have to preserve every original fresh protected read/hash and execute into fresh isolated namespaces, with keys covering actual bytes, filename, mode, effective flags, optimization and all transformed AST/identity inputs. A raw module hash cannot key a differently transformed namespace. Source, actor, private, catalog, kernel, readiness, approval and dependency proof results must remain fresh. No approval lifetime, reserve, dependency deadline or complete predicate is relaxed.
