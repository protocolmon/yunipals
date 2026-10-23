# Receipt worker v3: use the existing systemd identity

This is a fresh, review-first correction of the terminal v2 attempt. It has not
been installed or started. The original v2 owner, its failed invocation
`d4c52a1889ed45b8aa99493f2ee41b33`, its receipts and its completed restore remain
unchanged. The observed startup error was `setpriv: setresuid failed: Operation
not permitted`; the retained `RestrictSUIDSGID=yes` applies before that child
tries to change its identity.

The original fragment already assigns `yunipals_unified_support` UID969/GID963.
V3 inherits those names and the original empty capability sets, no-new-privileges,
seccomp, filesystem and network restrictions. Its drop-in contains only the
source008 working directory, a direct `/usr/bin/env -i` executable and the same
900-second bound. There is no root worker, post-exec UID switch, capability grant,
seccomp change or boot enablement. The exact original fragment hash is retained.

Read-only NSS inspection found UID969/GID963, group IDs `[963]`, no other group.
Systemd may therefore expose the primary group in `/proc/self/status`. The new
`support-probe-runner-v6.mjs` differs from immutable v5 by exactly one predicate:
empty groups or the existing primary963 are accepted; any additional group is
refused. Existing UID/GID, no-new-privileges and capability checks remain. The
owner independently checks exact four UID/GID values, cgroup membership and the
same group condition. The original runtime actor/probe logic otherwise remains.

A small new entry imports the unchanged `runReceiptLoop` from
`source6-normal-receipt-loop.mjs` and v6's `runProbe`. The original loop bytes,
receipt overlay v11, canonical receipt validation, restricted database role,
profile and support grants remain unchanged. The limits remain one upstream
request at a time, 256 logical RPC calls, 840 loop seconds and 900 systemd seconds.
No observer, getLogs scanner, projection, source restart, public selection,
paid allowance or profile renewal is introduced. Exact source qualification
continues to use 8f95600d/add6d4fb and does not claim the old whole-runtime
validator passed.

## Public staging

`stage-source6-qualified-receipts-v3.py` stages five new public files only:

- `source6-qualified-receipts-v3.py`
- `support-probe-runner-v6.mjs`
- `source6-qualified-receipt-entry-v3.mjs`
- `source6-qualified-receipt-probe-v3.mjs`
- `source6-qualified-receipt-probe-v3.py`

It rechecks exact immutable v2 owner, v5 runner, old loop and source qualifier.
Its default action is read-only; `--apply ACTUAL_STAGE_REVIEW_HASH` uses exclusive
no-follow writes and never changes a unit, database, provider, key or old file.

## Synthetic namespace qualification before a real attempt

`source6-qualified-receipt-probe-v3.py` is a read-only renderer. Its `render()`
returns the exact retained original fragment followed only by synthetic
ExecStart, working directory and a 30-second runtime override. It refuses
credential-loading directives. Its default CLI prints public hashes only and
performs no manager action or file write.

The root operator must inspect the rendered definition and first establish that
`yunipals-qualified-receipt-v3-identity-probe.service` is absent/quiet, with no old
probe intent. Install that one definition exclusively under `/run/systemd/system`,
reload the manager, and start it once. No automatic retry is authorized by this
package. All original hardening is inherited. The probe executable uses only
public module bytes and `/proc/self/{status,cgroup}`; it does not invoke
`runProbe` or `runReceiptLoop`, open a credential, query PostgreSQL or dispatch
an HTTP/RPC request. Importing the new entry is guarded and does not run it.
It prints one allowlisted JSON success result after verifying UID969/GID963,
empty-or-primary963 groups, empty effective/permitted/inheritable/ambient/bounding
capabilities, no-new-privileges, exact probe cgroup, safe imports and loop limits.
Bind the actual terminal invocation, exit status, definition and success result
before the real v3 worker. Preserve the synthetic receipt and remove only the
owned terminal probe unit; no worker/source/proxy stop or restart is needed.

This actual hardened probe has not been executed during package preparation.
A successful local test is not a substitute for it.

## One finite real attempt after review

Use the existing E0 root operator boundary with the new v3 owner. Its default
review must pass after the v2 restore, and the real inherited hardening/NSS values
must match. After root review only:

```sh
/usr/bin/setpriv --bounding-set=-all,+setuid,+setgid,+kill \
  --inh-caps=-all,+setuid,+setgid,+kill \
  --ambient-caps=-all,+setuid,+setgid,+kill --no-new-privs \
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 TZ=UTC \
  /usr/bin/python3 -I -B \
  /opt/yunipals-unified/operations/free-replay-20261020/source6-qualified-receipts-v3.py
```

Then use `--apply ACTUAL_FRESH_OWNER_REVIEW_HASH` once. The root operator boundary
is distinct from the service: the service executes directly as the original
unprivileged account and uses no setpriv command. Operation evidence is fresh
under `/var/backups/yunipals-source6-qualified-receipts-v3-20261023`; the only drop
is `95-qualified-receipts-v3-15m.conf` under the existing support unit's `/run`
directory. `--inspect` handles acknowledgement uncertainty; never repeat START.
`--restore` retains its existing source-independent, exact-owned stop/removal
behavior, including lost-stop and lost-reload acknowledgement handling.

Capture receipt/job/discovery and four cached proxy counters before and after.
After confirming the actual worker PID/invocation, monitor local/public booster
readiness and indexed timestamp age every ten seconds for two minutes. Root
should invoke the owned restore if readiness is false or age exceeds 30 seconds
in two consecutive samples. Source/native actors, checkpoint progress, resources
and financial authority must remain unchanged. A live PID is not receipt success;
record actual stored/retry outcomes. No BNB positive witness or complete receipt
history is claimed while the configured BNB publication start remains unreached.

Local checks pass: 16 Python controls; 13 actual Node runner controls; four
unchanged-loop controls. These include real no-overwrite staging/inverse fixtures,
original owner/function equality, one-predicate runner equality, inherited
identity/security and extra-group refusals, unchanged finite budgets and synthetic
renderer preservation. No production service, SQL or provider action was performed
by the package author.
