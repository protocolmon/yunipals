# Managed YPAL EVM and Solana launcher

This successor prepares the single indexing service for the actual fresh YPAL
source. It does not install a unit, stop a writer, change permissions, select a
reader, call a provider, or authorize a production switch. The historical
source008/PROTO supervisor and its receipts are unchanged.

The parent starts exactly two children:

- Ponder in the existing YPAL source directory, with the existing three ordered
  environment files, native schema `unified_ypal_20261023_v1`, loopback port9028,
  and the source's 4GiB heap setting.
- The unchanged Solana worker from the retained source008 runtime, using its
  separate existing child configuration and working directory.

Only Node reads the private environment files. The parent checks readability
without reading their contents. Each child starts with a clean environment;
parent credentials, another child's credentials and inherited replay permits
are not forwarded. The EVM files retain their original order: retained launch,
runtime, then the confirmed combined YPAL override. Both children are mandatory.

An unexpected child exit stops its sibling. Exit75 remains75 for the existing
restart-prevention policy; an unexpected clean exit becomes failure1. SIGTERM
is a clean explicit shutdown; SIGINT returns130. A bounded grace period ends in
SIGKILL for unresponsive owned process groups. Compiler descendants are also
terminated when their leaders exit. The service's control-group policy remains
the outer cleanup boundary.

## Local verification

```sh
node ops/unified-indexer-transition/ypal-managed-indexer-v1/launcher.test.mjs
node --check ops/unified-indexer-transition/ypal-managed-indexer-v1/launcher.mjs
```

Use the pinned Node24.18.1 runtime. Twelve local controls passed; independent
review reran all twelve and verified the current source bindings. These execute
real child processes with fake private files and substitute worker programs;
they verify file precedence, native arguments, working directories, heap,
credential separation, sibling failure, restart-prevention status, shutdown,
compiler cleanup and failures before either child starts. They do not import
Ponder or Solana, authenticate a production database, or prove live ingestion.

The service template passed the local systemd parser after copying it to a
`.service` filename and replacing only ExecStart with the locally available
`/bin/true`. That is a syntax check, not validation of production paths, mounts,
permissions, egress or runtime behavior. The actual launcher passed Node's
syntax check independently.

## Production work still required

The new unit must be installed through a separately reviewed owner that binds
the actual reader/cache, metadata, Arena and fresh YPAL handover receipts. That
owner must capture current actors and boot inodes, fence every old writer and
drain its database sessions before the shared start. It must preserve the new
native schema, build, cache directories, exact source overlays and free-only
RPC policy. It must also preserve the Solana published snapshot, staged rows,
budget ledger, next-run schedule, private settings and exclusive worker lock.

The template permits loopback only. The owner must attach the existing reviewed
literal-IP Helius egress after a fresh comparison with current configuration.
Do not copy credentials into the public service settings or grant broader
network access to make a failed check pass.

The sustained observer currently binds the separate combined-source unit.
Moving Ponder into this supervisor changes its process ancestry and invocation.
The final owner must stop/adopt that exact observer, retire or replace its owned
boot path, bind its dependency and source proof to this managed invocation, and
verify advancing observations. It must not start a duplicate observer or claim
the old source actor validator still passes.

Forward and inverse acceptance must cover the new managed source identity,
current policy-qualified coverage, unchanged public APIs, a normal scheduled
Solana publication, restart behavior and restoration of the owned old writers
without repeating external work. The exact executable owner, actual production
switch, coordinated rollback and 24-hour observation remain incomplete.
