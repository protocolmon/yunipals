# Bounded V6 publication protocol

This is source preparation and local test evidence. It is not a production
callback timing receipt, grant/COMMIT acknowledgement, reader LOGIN approval,
generation publication receipt or transport qualification receipt.

The observed full metadata comparison alone took 20.779 seconds. It exceeds the
V5 cache child's 15-second PostgreSQL idle allowance and the V5 reader gate's
20-second callback remainder after its 70-second effect reserve. Neither old
timing gate passed.

| Bound | V5 | Explicit V6 |
| --- | ---: | ---: |
| Cache PostgreSQL idle transaction | 15 s | 240 s |
| Cache parent protocol | 100 s | 360 s |
| Reader PostgreSQL idle transaction | 90 s | 240 s |
| Reader parent, modes other than publish | 120 s | 360 s |
| Reader parent, publish mode | 1,200 s | 1,200 s |
| Reader owned-effect reserve | 70 s | 70 s |

The complete actual callback must be measured afresh in its authenticated caller,
operation, source and catalog context. Cache callback time must be strictly below
240 seconds. Reader callback time plus the exact 70-second owned-effect reserve
must be strictly below 240 seconds. The 20.779-second comparison is evidence of
the V5 incompatibility; it is not a measurement of the complete callback. The
V6 arithmetic helper checks integer types and bounds only; the caller first
authenticates the protected measurement receipt and its binding, context and mode.

The SQL successors retain the actual V5 physical/read schemas, read identity,
cache driver/transition, metadata SQL hashes, generation recovery component,
publisher library authentication, candidate tuple, boundary coverage, retained
session handle, held XID, literal ACKs and final source/pointer CAS. V6 reader SQL
also corrects both capsule hash checks to the actual unchanged V5 recovery file
`a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df`.
The V6 probe changes only its wire manifest filename and own manifest key.

The V6 peers pin new SQL/probe bytes and a new V6 wire manifest. The manifest
retains the V5 data identity and dependency bytes. Original V5 files, receipts
and frozen template namespaces are not edited or relabeled.

`ypal-ordinary-publication-protocol-v6.py` supplies two exact constructor seams:

- `cache_parent_window(function)` consumes the original authenticated V5
  `sql_child` AST after its existing public-FD transport transformation and before
  it is renamed `_sql_child`.
- `reader_parent_window(function)` consumes the original authenticated `child`
  AST after the existing V5 launch transformation. The coordinator separately
  binds the V6 wire manifest hash, V6 SQL entry and V6 public transport.

Each seam changes one verified absolute-deadline expression and inserts a fresh
deadline check immediately before the two existing literal ACK sends. The
original callback, held-XID, actor, session, durable-intent, result and cleanup
checks remain. Every other AST statement compares exactly with its authenticated
predecessor. The invoking owner must also choose a coherent outer process bound;
the historical cache CLI's 300-second alarm cannot bound a 360-second child.

Local verification:

- Seven source/AST/policy tests verify immutable templates, exact successor
  seams, every wire hash, V5 schema/identity preservation, strict boundary/type
  refusal and refusal to send an ACK after a callback exceeds the parent bound.
- Twelve reader FD tests execute real UID111/967 children with all capabilities
  removed, empty supplementary groups, no-new-privileges and denied network.
  They check all twelve exact public files, sealed descriptor integrity,
  tamper/unknown-path rejection and actual entrypoint/self-hash/UID gates.
- Four cache FD tests execute the real UID111 import of the exact three public
  modules, sealed descriptor cleanup, tamper/symlink/hardlink/writable-file refusal
  and denied private paths/network.
- Deterministic SQL-client tests exercise exact catalog/XID/literal-ACK checks
  for both reader LOGIN and publication. False/missing/object acknowledgements
  refuse; publication retains the same private handle, two acknowledgements and
  immediate final source/CAS-to-COMMIT ordering. No database is contacted.

The FD suites require a user namespace that maps UID111/967 and GID113/961. The
managed sandbox mapped only UID/GID0; the successful runs used approved local
execution outside that sandbox. They confer no production runtime qualification.
