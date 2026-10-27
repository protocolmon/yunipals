# Ordinary V5 fixed-boundary witness

This is a new evidence capture for the actual V5 read schema. It uses the
reviewed latest-complete readiness implementation and the actual V5 creation
receipt `5acb7de8be040d76458d2a8e2c0792f33df89a9f790e94377c177cd4f75d7337`.
The schema is `yunipals_ownership_4e77f52b_v5`, OID `77370532`, with read identity
`0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab`.
Creation and the local controls do not constitute a successful witness capture.

## Implementation and scope

`ypal-alchemy-ordinary-witness-v5.py` executes the authenticated ordinary capture
driver in a new namespace. The original prepare, capture, exclusive intent,
process timeout, private logs and HTTP-attempt accounting remain intact. Its two
AST body changes select the new report format and run the new JavaScript helper
directly, without TSX. Additional explicit adapters authenticate the actual V5
creator's `data_current` result before and after each phase.

`fixed-boundary-witness-v5.mjs` reuses the frozen v3 canonical-header, fixed-point,
data-equality and cache-layout functions. The unchanged database snapshot body
executes in a new lexical scope with explicit V5 pins. Frozen module globals and
historical receipts are untouched. The separate retained-runtime plan qualifies
only the existing immutable 008 Ponder/PG runtime and historical parity input.

`ypal-v5-witness-official-v1.mjs` bundles the real official V5 release, bound
runtime and source-status functions. Its descriptor records the ten-file source
closure and two equal builds. Its sole external import is `node:crypto`.
It contains no application startup or database driver. PG is loaded separately
from the already authenticated retained runtime. The build inputs and build
script are included for review; production capture needs the pinned generated
bundle and descriptor.

The immutable `b04ff03d…` parity report remains evidence of exact historical
data equality in its original V4 context. New V5 readiness and canonical
qualification are explicit separate evidence. The four missing historical
legacy block hashes stay missing. Earlier `fc461eb6…` and `cb2fac1d…` witnesses
remain preserved and unqualified. Base metadata readiness is independent of
the six collection probes and is not promoted by this capture.

## Execution

Root stages only reviewed public sources into the existing protected operations
directory. No source selection, schema grants, service changes or financial
changes are part of this operator. Run from the fixed production host as root:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-ordinary-witness-v5.py --prepare v5-initial e352a81b4c706c46e2fb3239e37159388540946da99ab09cec24cbdad23040d8 16877730af574fb10e69759cbbfdfa093ab8d5a7bc90e0e91c98f25a35ca34cc
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-ordinary-witness-v5.py --capture v5-initial ACTUAL_PREPARE_REVIEW_HASH
```

The second argument is the exact review hash returned by the first command;
it is not an authorization or result fabricated in advance. Both phases
authenticate actual ordinary runtime and observer receipts, current source
proof, observer control rows and current V5 object identity. Evidence goes to
the exclusive, protected directory:

```text
/var/backups/yunipals-ypal-ordinary-v5-fixed-boundary-witness-v1-20261025/captures/v5-initial/
```

Capture performs the unchanged 21 permit-free RPC requests and 12 witness HTTP
requests, without retries. Context HTTP GET attempts are measured separately,
including failed attempts, with the existing 512-attempt cap per context frame.
The database work uses a bounded repeatable-read, read-only transaction. Detailed
driver output and control rows stay private; stdout contains aggregate results.

An existing capture intent prevents another dispatch, including after a lost
acknowledgement. Preserve failed or incomplete evidence. A later capture needs
a new bounded ID, a fresh review and an explicit invocation. No status rows are
seeded and no failed capture is promoted to success.

## Validation and downstream use

The JavaScript API is asynchronous:

```js
await validateWitnessReceipt(witness, historicalParityBytes, baselineBytes);
```

It checks the new producer, official closure, V5 identity, real historical
parity/baseline bytes and recomputed six-collection acceptance. A qualified
return is capture-time evidence; `currentReadinessQualified` remains false.
Callers must separately authenticate the protected wrapper result and witness
file hashes and supply their own fresh source, metadata and role authority.

Six Node controls cover the actual compiled V5 API, unchanged snapshot body,
negative readiness cases, original-marker refusal and complete witness path.
Six Python controls cover namespace seams, actual V5 leaf plumbing, direct
JavaScript execution, protected plans and lost-intent refusal. No production
capture or provider request was made during these tests.
