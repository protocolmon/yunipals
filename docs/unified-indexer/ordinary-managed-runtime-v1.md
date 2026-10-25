# Ordinary managed runtime foundation

This source packet adds a concrete launcher and a read-only current-epoch
observer. It does not install or start the managed service. Actual legacy
retirement, coordinated consumers, a scheduled Solana publication and a
supervised restart require their own completed lifecycle proofs.

The public package is
`ops/unified-indexer-transition/ypal-ordinary-managed-indexer-v1`. Its `core.mjs`
is byte-identical to the reviewed d3 launcher. The new entry appends exactly
`ypal-alchemy-primary-queue-v1/source.ordinary.public.env` after the existing
three EVM environment files. Solana retains its separate source008 working
directory and private environment file. The parent never loads either child's
private values. The original process-group shutdown, sibling failure and exit75
behavior remains unchanged.

Only the four runtime files belong in the newly owned root0755 runtime directory:
`core.mjs`, `launcher.mjs`, `service.public.env` and the service template. They are
root0644. Tests and this document are source artifacts. Existing OPS/private
directories and files retain their permissions. The template retains the four
acknowledged literal Helius CIDRs and loopback restriction. Its three writable
bindings follow the read-only reset. Every actual typed binding and process
namespace inode is checked again; rendered unit text is insufficient.

`ypal-ordinary-managed-runtime-v1.py` authenticates the recorded ordinary3bf
result and input, then independently validates current89a financial authority.
Its four ordinary proxy epochs are checked against their own journals and
private inputs. The five retained proxies are a separate preserved component.
The old nine-free validator is not invoked. The same four permits, daily policy,
profile and expiry remain in force; this module cannot admit, renew, disable or
change financial policy.

The runtime input is a root0600 file at
`/var/backups/yunipals-ordinary-managed-runtime-input-v1-20261024/input.json`.
Its exact fields are `format` (value `yunipals-ordinary-managed-runtime-v1-input`),
`ordinaryResultSha256`, `ordinaryInputSha256`, `solanaAuthSha256` and
`observerResultSha256`. Every hash must identify a real completed receipt. No
example receipt value is accepted as authority.

The observer uses a new finite namespace containing ten unchanged read-only f5
methods, with the new public runtime path and acknowledged690 transport. The old
Host constructor and all service/financial mutation methods are absent. It checks
the actual parent and separate EVM/Solana children, ordered four EVM files,
zero-capability UID970 identity, typed parent command, original three RW plus
three RO bindings, all six actual namespace inodes, original private/program
files, native44/cache/build71e/pool5 and current registered data. Every other
known writer must be terminal. Source-role73004621 backends must be positively
owned by the actual managed EVM subtree, with no unattributed native writer.

The original restricted Solana authentication and thirteen source files remain
bound. A narrowly derived kernel join admits only existing shared role16388 in
database17584, with the prior managed bound of64 rows. Any current worker lock
must belong to the actual managed Solana child. The unchanged worker can release
all pooled connections while sleeping; zero sessions requires an actual future
schedule, no running scan and no worker lock. Current Solana state and ledger are
observations. They do not establish a new scheduled publication or financial
authority.

The CLI defaults to source-only inspection. `--sources` emits the exact finite
code manifest without constructing runtime objects. Once a separately reviewed
owner has actually installed and started the managed runtime:

1. `--input-sha ACTUAL_INPUT_SHA --begin` writes one exclusive root0700/600
   observation intent. It records the already-running tree, database clock and
   heartbeat. It issues no start.
2. `--input-sha ACTUAL_INPUT_SHA --finish` repeats the full proof and requires a
   heartbeat newer than the recorded clock and predecessor heartbeat. Its new
   result is an observed-epoch ACK. Lost ACK completion reads the same intent and
   result without restarting or overwriting anything.
3. `--input-sha ACTUAL_INPUT_SHA --current ACTUAL_RESULT_SHA` validates that same
   epoch. Safe/finalized floors from the actual first ACK remain protected while
   heartbeat/checkpoint/schedule observations can advance.

The in-process API is
`validate_current_source(result_sha, input_sha)`. It returns the actual
`currentManagedEpoch`, EVM `sourceKernelActors`, stable binding hash, independent
financial references and separate observations. It never returns a managed alias
for the standalone3bf/de4 PID. Canonical coverage, consumer mutation, installation,
legacy retirement, scheduled Solana publication, supervised restart and full
configured-source acceptance remain explicitly false. Same-OS-boot receipt
ancestry is required. A restart that changes the epoch needs a separate explicit
lifecycle acceptance; this observer does not silently adopt it.

Local validation: six Node controls passed, including real child processes with
four-file precedence, credential separation and fatal75 sibling cleanup. Seventeen
Python controls passed, including exact AST seams, typed-command/binding refusals,
positive EVM subtree composition, a real filesystem intent/result chain, lost ACK
completion, current-epoch changes and genuine frozen recovery-floor semantics.
These are source tests. No managed installation, live epoch or host qualification
is claimed.

Inactive staging can call `qualify_public_readability(command)` independently
of every runtime constructor and future receipt. It hashes only the four fixed
public runtime files under actual UID970/GID964, clear groups, zero capability
sets and no-new-privileges. It imports no application and opens no database or
provider connection. The runtime proof repeats this check.
