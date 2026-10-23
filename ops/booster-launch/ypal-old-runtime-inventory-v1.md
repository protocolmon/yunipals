# Old booster runtime inventory

This fixed read-only observer supplies the fresh YPAL host owner with actual old
source/API/queue definitions, process identities, public argv, sandbox settings,
private file paths and hashes, old schema/read OIDs, dependency links, ports and
the independently qualified combined source and OG API. It performs no writes,
service actions or upstream provider requests. It does not authorize a cutover.

Run `python3 -I -B ypal-old-runtime-inventory-v1.py` on the production host only
after its public source/dependencies have been reviewed. Default execution calls
`capture()` and prints the sanitized packet. It neither writes an acknowledgement
nor installs itself. Preparatory execution in a sealed memory FD is explicitly
reported as uninstalled; it is not a staging receipt.

The old launch and combined source share `yunipals_unified_shadow`. Their source
processes are distinguished by exact unit/cgroup/PID/start/invocation and pinned
Node/esbuild identities. `attribute_old_sessions(old_actor,source_rows,
combined_actor=...)` maps only their actual owned client socket FDs to PostgreSQL
backend socket FDs through Unix peer inodes or matching TCP client endpoints.
Backend PID and `backend_start` form the returned identity. No application-name,
connection-age or role-count inference is used. An ambiguous or changing cohort
is refused; `capture()` may disclose the fixed observation-race code with
`complete:false` and `stopAuthorized:false` while preserving useful static data.
Such an incomplete attribution must never authorize a stop.

`independent()` can be repeated after the old booster stops: it observes the
qualified combined source/proxies and fixed OG main API only. It preserves the
explicit 8f/add6 qualification and never claims the historical whole normal
validator passed. `current_source_backends()` returns the bounded source-role
backend identities for a later owner-controlled drain check. These functions do
not require the old launch process to stay active.

Before stopping an old source, the owner must freshly qualify its exact actor and
complete attribution, bind that evidence in its protected intent, then stop only
that actor/cgroup and remove only its owned activation paths. Drain must prove
the captured old backend identities gone and account for all remaining shared
writer backends as the unchanged combined source before starting the fresh
five-slot source. Requiring the shared role's total session count to be zero
would incorrectly affect the BNB replay. Fresh-source attribution belongs to its
own reviewed unit/artifact owner; this observer accepts no arbitrary unit or PID
from a CLI.

The actual old launch uses `unifiedRpcTransport(8453)` with the normal d059
profile and a bounded transport, plus a five-connection Ponder pool. Its reviewed
old manifest/profile does not admit the newly deployed YPAL contracts. A fresh
explicit free-only policy is a separate prerequisite; no profile file, proxy,
allowlist, financial authority or source environment is changed here.

Validation: six local pure controls cover actual `ss` column shape, Unix peer
ownership, TCP/IPv6 byte order, no name/age inference, and ambiguous/duplicate
backend refusal. Actual bounded production observation independently established
two old launch PostgreSQL backends disjoint from three combined backends, with
all five source-role connections accounted for. Process/session tuples are live
observations, not reusable future stop authority.
