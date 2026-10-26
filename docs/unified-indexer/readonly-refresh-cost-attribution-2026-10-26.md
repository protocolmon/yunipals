# Read-only prerequisite cost attribution

The completed production benchmark `27af1b44` measured an explicit refresh at
5.464 seconds and prerequisites at 100.808 seconds. This exceeds the existing
90-second approval lifetime before allowing its five-second final reserve.
The benchmark is read-only evidence; it does not qualify a held transaction,
authorize a cache commit or establish a completed reader handover.

The [timing-gap projection](readonly-refresh-timing-gaps-production-2026-10-26.json)
uses the same saved 347 process-call records and two absolute measurement
windows. It does not execute another benchmark. Every call belongs to exactly
one window, and the intervening wall and parent-CPU intervals reconcile exactly
to each window's totals. No commands, input, environment, SQL, results or
ownership records are exported.

Prerequisites used 45.591 seconds of parent CPU. Observed `subprocess.run`
calls occupied 29.263 seconds of wall time. The remaining 71.545 seconds of
wall time includes CPU work, observer bookkeeping and work outside that
observer's coverage; it must not all be described as Python or SQL time.
Two observed `setpriv` calls took 9.076 and 8.963 seconds. Their exact callsites
were not retained by the category-only observer.

The largest intervening wall interval was 21.876 seconds after call 255
(`env`) and before call 256 (`setpriv`), with only 0.314 seconds of parent CPU.
Source inspection shows the genuine metadata publication path compiles its
official SQL through `subprocess.run`, then executes the full publication
query through a direct `Popen.communicate` peer. That peer is outside the
run observer's coverage. This is a source-backed explanation consistent with
the interval, not a measured identification of that callsite or query duration.
The two slow `setpriv` calls are similarly consistent with the source's
consecutive saved-capsule and live-state verification queries, but their
identities remain unproven.

The largest intervening CPU intervals are 5.463, 4.686 and 4.570 seconds,
each immediately before an observed Node command. The next combined read-only
measurement will distinguish standard-library parsing, copying, serialization
and SHA-256 construction costs, and label the exact authenticated
public capsule bridge command family. Its source and local overhead controls
must pass review first. No proof or live facts will be reused to bypass fresh
checks; the current source predicates and deadlines remain unchanged.

Review found that intercepting Python's built-in `compile` changes how it
inherits the caller's future flags. A real annotations fixture reproduced a
`NameError` under that draft observer while the original call succeeded.
That hook was rejected before staging. The revised observer leaves `compile`
untouched and explicitly excludes its cost from direct attribution.
