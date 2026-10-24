# Arena native adoption on the restored source

This successor preserves the reviewed Arena worker, private-record adoption,
source-selection, commit reconciliation, continuation and recovery algorithms.
It binds them to the actual restored combined source instead of the old source
process. It performs no database migrations, role admission, credential setup,
provider requests or signing operation. The twelve schema migrations are already
committed and must not be repeated.

## What changes

The owner uses a new format, backup directory, source helper and code manifest.
Its common function changes are limited to the finite manifest validator,
`Host.normal`, the phase-leaf result domain and the default CLI behavior. The
original v2 owner, source helper, receipt namespaces and all worker/SQL programs
remain unchanged. The new phase-leaf domain is
`yunipals-arena-ypal-restored-phase-leaf-v1`.

The source helper authenticates the actual restored source receipt, all44 native
table identities and the nine Arena source table OIDs. Forward use calls the
strict current restored-source validator. The inverse-only mode uses the
separate active-or-terminal source proof, including the acknowledged source
configuration, boot, mounts and recovery floors. A terminal result can never
admit forward adoption.

Both modes separately qualify the nine current RPC proxies using their actual
acknowledgement and component digest. That producer checks the full retained
profile catalog, expiry, empty permits, financial capacity, private inputs and
boot ownership. No paid allowance is renewed. The helper's result proves source
identity and existing free policy; it does not prove Arena coverage, source
readiness, current writer exclusivity or Ethereum finality. The real native
Arena reader continues to validate current coverage and canonical headers in
the sealed child, using the agreed latest Ponder state with no extra application
block buffer.

The original current-eight-actor context, admission helper, credential helper,
source proposal, adoption adapter and sealed child stay pinned. Those contexts
read source catalog/ambient authority without an obsolete source process guard.
The operational role/credential approval is still required separately. Prepared
source or a static constructor does not constitute that approval or its actual
receipt.

## Required actual inputs

The explicit plan retains the existing fields: `roleAuth`, `currentActorsAck`,
`admissionProposal`, `floor` and `manifestSha256`, with this new owner's format.
Every receipt must refer to a real protected file with its actual digest. The
floor must be a genuinely covered canonical Base block/hash. The existing actual
eight-actor acknowledgement stays mandatory; a changed actor requires its own
new qualification. No example acknowledgement or guessed future OID is accepted.

Stage the exact manifest, new owner and helper only after source publication,
with their original pinned dependencies. Qualify the actual host paths and
current actors. Then default execution with `--plan` and `--plan-sha256` performs
online read-only review. Without a plan, the default is only a static summary
and performs no host, database, credential or service work.

An actual apply still requires the exact fresh review hash. Original service
stops, unit/boot publications, private backup, record adoption, source selection,
worker starts and unhalt remain explicit owned phases. A lost acknowledgement
requires the original read-only reconciliation/continuation path; it never
licenses repeating a transaction or manager command. The existing pre-adoption
inverse refuses any adopted/committed private state it cannot safely reverse.
Post-adoption recovery still requires the separately reviewed fallback path.

The exported `validate_phase_leaf` authenticates the accepted new owner result,
role/credential graph, owned selection/ledger and current native workers. It
keeps source actor, financial and canonical authority false, so a later managed
source transition can supply those proofs independently. It does not invoke
the forward source helper as a hidden constructor gate.

## Verification and current limits

Run `python3 -I -B ops/unified-indexer-transition/arena-ypal-restored-v1.test.py`.
The 39 controls include 27 retained transaction/lifecycle/terminal-inverse tests
and 12 new source, identity, authority, manifest and static-default tests. The
cross-account sealed-descriptor test needs the ability to switch to its local
test UID. It passes outside the executor's restricted UID mapping; no production
host is involved. Independent review repeated all39 controls and authenticated
all12 manifest entries. Unchanged application/PostgreSQL matrices are retained
as earlier evidence rather than relabelled as new runtime adoption.

No new Arena runtime, role, credential, source selector or private record has
been changed by this preparation. Actual production staging, current coverage,
role authentication and live adoption remain acceptance steps. Existing Arena
workers and production configuration continue to serve.
