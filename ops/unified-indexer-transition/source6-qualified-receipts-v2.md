# Bounded receipt support with the acknowledged proxy replacement

Prepared for one reviewed operation; nothing has been started by this package.
The normal source remains PID 716994, invocation `c3463c9a…`, source008,
`unified_shadow_20261020_7e7375b0`, build `bf4939b3ff`.

The v2 owner calls the exact `source6-normal-proxy-requalification-v1.py`
(`8f95600d…`) `validate_current` with actual acknowledged result
`add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d`.
It retains the original runtime receipt `e0772a5a…` as historical identity,
without calling its obsolete whole-proxy equality validator or claiming that
validator passed. Current proxy tuples must still equal the acknowledgement
after all other review reads, and the original source process is checked again.

Only source authority and acknowledgement metadata differ from the original
receipt owner. Launch, restricted actor, manager reconciliation, inspection,
owned stop and inverse are unchanged. All old source/helper/receipt files stay
intact. The same existing support service, UID969/GID963, admitted database role,
v11 receipt overlay `01476919…`, runner `6b4770a3…` and loop `477376b0…` are used.
No canonical observer, log-range scanner, projector, grant, source restart,
public selection or paid permit is introduced.

## Actual eligibility

Read-only production observation at 10:51 UTC on 23 October found:

| Chain | Complete candidates | Existing evidence | Missing/due |
| --- | ---: | ---: | ---: |
| Ethereum | 2,705 | 87 | 2,618 |
| BNB | 0 | 0 | 0 |
| Polygon | 1,282 | 288 | 994 |
| Base | 6,326 | 562 | 5,764 |

These are source-matching candidate transactions at or below the retained
per-chain complete checkpoints and with matching canonical event identity.
All 9,376 missing receipts already have due jobs; active leases are zero.
The worker is inactive/dead/PID0, with no drop-ins, `Restart=no`, the original
one-hour fragment and no support database sessions. Its exact restricted grants
and installed v11 overlay passed read-only checks. BNB has not reached the
configured Seaport start 123,769,700; this operation cannot create a BNB witness.

The existing runner deliberately permits `receipts-once` before Ponder's
`frameworkReady` flag: it still requires the registered release/schema/build,
a running source with a fresh heartbeat and a complete per-chain checkpoint.
Queue and claim are bounded by that checkpoint. The receipt worker validates
chain ID, receipt/block/transaction identity, every indexed log and receipt bloom,
and Seaport runtime where relevant. Its commit rechecks the exact canonical
candidate and owned lease. It writes only operational receipt evidence/jobs and
discovery position. Consumer readiness and canonical head witnesses remain
separate and are not fabricated by storing receipts.

## Limits and priority

The unchanged loop rotates the four chains, with sequential batches and at most
one upstream request in flight. Each batch queues at most eight identified
candidates and claims at most two receipts. The loop is limited to 256 RPC calls
and 840 seconds; the existing service independently stops at 900 seconds and
never restarts automatically. Base capacity remains standalone2 + combined1 +
receipts1, below the unchanged eight-request proxy ceiling. The same free-only
profile expires 19 November. Both historical paid permits remain disabled and
expired, the original aggregate 20,000,000 CU ceiling is retained, and no paid
window or allowance is renewed.

## Commands after root review

Stage only the new public owner with `stage-source6-qualified-receipts-v2.py`.
Its default action is read-only; `--apply ACTUAL_STAGE_REVIEW_HASH` creates only
the new owner and refuses changed historical owner/loop/qualifier dependencies.
It cannot create a unit, SQL row, grant, provider call or credential.

Use the existing E0 root boundary for the owner:

```sh
/usr/bin/setpriv --bounding-set=-all,+setuid,+setgid,+kill \
  --inh-caps=-all,+setuid,+setgid,+kill \
  --ambient-caps=-all,+setuid,+setgid,+kill --no-new-privs \
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 TZ=UTC \
  /usr/bin/python3 -I -B \
  /opt/yunipals-unified/operations/free-replay-20261020/source6-qualified-receipts-v2.py
```

The default review is read-only. After checking its exact binding, repeat with
`--apply ACTUAL_OWNER_REVIEW_HASH` to start this single bounded operation.
Receipts are saved exclusively under
`/var/backups/yunipals-source6-qualified-receipts-v2-20261023/`. Only the owned
`/run/systemd/system/yunipals-unified-support-source6-v2.service.d/95-qualified-receipts-v2-15m.conf`
is installed. The existing fragment remains unchanged. No boot enablement occurs.

`--inspect` validates the qualification and exact owned peer identity, including
an uncertain start from its durable start intent. Never repeat an uncertain
start. `--restore` stops only that owned support invocation and removes only its
owned drop-in. It does not require the unrelated source to be healthy and does
not reset receipt rows, leases, native schema/cache or budget counters. Existing
lost-stop/reload acknowledgement handling is retained.

Before allowing further receipt work, observe live booster readiness and actual
indexed timestamp age every ten seconds for two minutes. Stop this probe via
`--restore` if readiness is false or age exceeds 30 seconds in two consecutive
samples. Save before/after receipt, job and RPC aggregates. Process liveness is
not successful receipt advancement. The bounded probe does not complete the
9,376-receipt backlog or satisfy the missing BNB preview witness by itself.

Local validation: 12 Python controls, including exact-source/ACK/proxy/ACL
negatives, actual filesystem no-overwrite staging and retained owned inverse;
four unchanged-loop Node controls cover sequential calls, budgets/deadline,
unavailable-source truthfulness and stop handling. No production writes or
provider calls were made while preparing this package.
