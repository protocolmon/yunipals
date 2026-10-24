# Restricted reader public-file transport

The frozen coordinator `ypal-native-cutover-v1.py` (344f7d0e…) launches the
publication child (950b18cf…) as PostgreSQL UID 111/GID 113 for roles and recovery,
and the action probe (4dadc7ad…) as the existing `yunipals_unified_api` OS user.
Both children read a fixed source manifest and their own source under the
private operations directory. Recovery imports two further operations modules;
the root witness imports another three. Root-owned mode 0600 staging alone does
not make these paths readable by the restricted peers.

This new helper transports exactly eight public files through sealed memfds.
The Node24 preload authenticates their fixed names/hashes, reads them with
explicit descriptor positions, closes the child descriptors, and provides the
same logical `file:///opt/yunipals-unified/operations/free-replay-20261020/…`
URLs through synchronous resolve/load hooks. A narrowly scoped `readFileSync`
view supplies the same pinned bytes for the frozen self/manifest checks. It
returns copies. Unlisted operations paths and URL suffixes refuse with EACCES.
Normal files outside that directory retain their existing filesystem access.
No private file descriptor, environment value or directory permission is added.

The existing files, source manifest, SQL, private inputs, database privileges,
process authentication and frozen wire protocol remain unchanged. This helper
does not authenticate a source runtime, acknowledge a database phase, publish a
generation, enable a role or prove the actual application action.

## Qualification

The default command verifies only the fixed public inputs and loader. It
creates no child or persistent output:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-reader-peer-runtime-v1.py
```

After exact source-only staging, root may separately review and invoke either
bounded qualification. These commands import the seven frozen public modules
without invoking their main functions, deny all network transports, and import
the installed `pg` library without constructing a client/pool. The main peer
also reads/hashes the exact installed main manifest and main bundle. Its UID/GID
comes from the actual existing OS account; PostgreSQL remains fixed 111/113.
No private configuration is read, and the child receives only a clean PATH and
the public descriptor number. Both commands have a 30-second bound and write
only their sanitized stdout result:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-reader-peer-runtime-v1.py --qualify postgres
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-reader-peer-runtime-v1.py --qualify main
```

The installed main application is deliberately not imported by this no-DB
qualification. The original action probe still needs its actual authenticated
read-only database session, configured application import and full receipt
assertions at the appropriate coordinator phase. An absent/inaccessible
installed dependency or mismatched installed bundle is a qualification failure,
not permission to copy private files or broaden the operations directory.

## Required explicit successor integration

The frozen 344 coordinator does **not** consume this helper. A separately reviewed
coordinator successor must pin this producer/loader and use the following small
launch seam around each existing child lifecycle:

```python
with public_transport() as transport:
    # Retain the existing fixed setpriv identity, caps, no-new-privileges,
    # pdeathsig, cwd, clean/business environment and protocol monitor.
    node_arguments = transport.node_arguments("postgres")  # or "main"
    # Popen: existing_setpriv_prefix + node_arguments
    # env: existing_environment | transport.environment
    # pass_fds: transport.pass_fds
    # Retain the context until the existing child lifecycle finishes.
```

The parent must preserve actual process/session attribution, durable XID/ACK
ordering, deadline, termination/reconciliation and child record checks. The
logical entry argument remains the original frozen filename, so its main guard
and self-hash still execute. The added public preload argument must be bound by
that successor's own source/runtime evidence. This is not an alias claiming
that an unmodified344 launch passed.

This transport requires no persistent installer, shared-directory chmod,
symlink, mount, database operation or service change. Closing the parent
context releases its descriptors; the preload already closes the child copies.
It cannot make a historically stored process/role/source receipt current.

## Local evidence and remaining host gates

```sh
python3 -I -B ops/unified-indexer-transition/ypal-reader-peer-runtime-v1.test.py -v
```

Twelve local controls use actual `setpriv` transitions and Node24 under numeric
UID 111/GID 113 and UID 967/GID 961. The latter is a synthetic transport fixture;
the future host qualification resolves the real API account. They import the
actual eight-file closure from descriptors while the backing fixture directory
stays 0700 and its files 0600, reject private/unlisted paths, modified source and
forged descriptor content, and prove stable self hashes after a caller mutates a
returned buffer. The actual logical child entry reaches its unchanged witness
UID guard after manifest/self reads, with zero attempted connections. Kernel
supplementary groups are empty; Node may report the primary GID in getgroups.

These tests perform no host access, provider/DB connections, signing, SQL,
service actions or permission changes outside disposable local fixtures. No
actual installed dependency/application or host restricted-peer qualification
is claimed. Actual source-only staging, both host qualification results and the
explicit coordinator successor remain separate gates.
