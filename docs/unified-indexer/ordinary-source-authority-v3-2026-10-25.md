# Ordinary source authority v3

V1 and V2 remain immutable with their actual failed read-only qualifications.
V2 passed the typed-empty EnvironmentFiles correction, then refused the
incorrect assumption that every unit's cgroup sits directly in system.slice.

Root read-only evidence confirms11 typed Service.ControlGroup values equal
their manager and kernel values. Exactly three fixed path families exist:
the two source units and the retained YPAL proxy directly in system.slice;
four combined template instances in system-yunipals\x2dcombined\x2drpc.slice;
and four market template instances in
system-yunipals\x2dmarket\x2dproduction\x2drpc.slice. The backslashes are literal
filesystem characters and are never decoded. The actual13 processes comprise
two source processes per unit and one process per proxy, in two UID/GID groups.

V3 changes only its producer/capture domain and cgroup qualification. It
admits those exact11 units and three literal families, binds Source/FRESH
cgroups to their actual SDK ACK fields and proxy cgroups to their actual
recorded actor fields, then requires every capability-zero peer's live
/proc/PID/cgroup to equal the typed acknowledged unit cgroup. Positive PIDs,
start ticks, bounded complete process sets and all other guards remain. V2's
typed-empty EnvironmentFiles requirement is retained. No generic path
relaxation or fallback UID is introduced.

The same APIs/default behavior apply. Actual captures use
`ypal-ordinary-source-authority-v3.py --qualify NEW_ID ACTUAL_RESULT ACTUAL_INPUT`
and optional actual `--read-ref ACK PLAN INPUT`; the new root-private directory
is `/var/backups/yunipals-ypal-ordinary-source-authority-v3-20261025/captures/`.
Production qualification/timing is not claimed before root actually runs it.

Fifteen isolated controls pass, including a real local capability-zero UID65534
peer and live kernel cgroup equality/refusal. The literal family function was
also compared to all11 rows of root's actual private diagnostic without host
access. Genuine source proofs confirm both proxy actor variants contain the
recorded cgroup field. No host, service, SQL write, provider, permission or Git
action was performed by the author.

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-source-authority-v3.test.py
```
