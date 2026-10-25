# Ordinary source authority v2

V1 `730d678a` remains published and staged with its actual failed read-only
qualification preserved. The complete source intake passed; the batched
manager check refused because `systemctl show --all` omitted only
`EnvironmentFiles` for SOURCE and FRESH. All11 services had positive PIDs,
running state, matching invocations, empty jobs and ControlPID0. Root then
confirmed each omitted property as exactly typed `a(sb)` with `data: []`.

V2 preserves the complete v1 body with only new FORMAT/capture directory and
that bounded normalization. Only the two source units may receive the missing
field, and only after actual Service.GetAll proves its exact typed empty array.
Nonempty, wrong-type, unknown, or any other missing property refuses. No
environment, actor, native44, route, finance, role, registration, kernel, READ,
private-file or deadline check is removed. V1 receipts are not rewritten.

The APIs and forward-only limits match v1. Use
`ypal-ordinary-source-authority-v2.py --qualify NEW_ID ACTUAL_RESULT ACTUAL_INPUT`
with optional actual `--read-ref ACK PLAN INPUT`. Captures are exclusive under
`/var/backups/yunipals-ypal-ordinary-source-authority-v2-20261025/captures/`;
raw data remains root-private and stdout contains only aggregate facts.

Fourteen isolated controls pass, including the real capability-zero UID65534
peer and the observed two-unit manager shape. Sandbox UID transition refusal
is separate from the authorized local PASS. Actual v2 production qualification
and callback timing remain unperformed by the author. No host, SQL write,
service, provider, permission, or Git action was performed.

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-source-authority-v2.test.py
```
