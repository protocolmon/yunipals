# Acceptance of the actual completed V2 worker

This successor accepts an existing completed worker. It has no build, adoption,
installation, restore, source-start or publication command. The V2 producer
`4f0a3e35…`, its input, operation, runtime directory, unit and worker records stay
in their original namespaces. The new acceptance producer never claims that
the original V2 candidate CLI passed.

The actual successful worker's inactive `Type=exec`, `CollectMode=inactive`
unit cleared its InvocationID, execution PID and all three execution timestamps.
The original strict terminal predicate therefore cannot pass. The separate
`ypal-ordinary-generation-terminal-v1.py` proves the actual cleared state using
all bounded journal records for that unit in the current boot. It requires
trusted root PID1 systemd journal fields, exactly one matching start, started
and successful-stop event, no later foreign invocation, the owned start intent,
the acknowledged real main PID/ticks/boot, matching worker/result invocation and
consistent wall/monotonic duration. It neither fills nor changes unit properties.
The journal command uses the normalized 32-hex boot descriptor, without a tail
or time-window truncation; oversized/incomplete evidence refuses.

The new caller changes exactly two predicates in the actual original terminal
body: retained InvocationID and retained start timestamp. The new journal proof
replaces those assumptions explicitly. Unit bytes/inode, terminal state/cgroup,
known main/child process epochs, application backend emptiness and artifact
command checks remain in that complete body. The original failed V5c worker
uses its unchanged strict branch. Unit/file/current-boot/journal captures
bookend this body and repeat after the candidate write.

The complete original acceptance review, successful-worker/database validation,
source snapshot, source/READ/current catalog, original 103/102 context, 35 guard,
retained drain/boot and semantic capsule checks remain required. The genuine
V2 Host constructor is used for forward acceptance. Later candidate leaves use
the original explicit static Host route and do not invent current source or
unpublished authority after publication.

The new receipt base is
`/var/backups/yunipals-ypal-ordinary-generation-accept-v1-20261025`. It contains
new `accept-intent.json` and `candidate-result.json` only. No operation is
copied into that directory. The candidate has the new producer/domain plus
`operationFile` pointing to the actual original V2 operation and
`buildOperatorSha256` naming the genuine V2 build producer. All metadata, READ,
artifact, worker, source-snapshot and retained semantic-recovery ancestry remains
explicit. The strict original terminal and capsule success flags remain false.

Root supplies the actual already-existing V2 input and operation SHA values.
The explicit `--phase review` performs the complete current acceptance review;
`--phase accept --ack` requires that exact fresh hash and repeats the full body
under the original real lock. Import and no-argument CLI are inert. There is a
900-second caller limit. An existing acceptance prefix is never overwritten or
automatically retried; an unknown outcome requires read-only inspection. No
candidate effect is authorized by the pure terminal qualification alone.

Consumer APIs are `candidate_context(sha,current=True)`,
`validate_candidate_database_current(sha)` and `validate_retained_current(sha)`.
The module's BASE/FORMAT/CANDIDATE_FORMAT identify the new acceptance producer.
Unchanged uppercase worker/artifact/recovery constants are delegated to the
authenticated V2 entry. `composition()` exposes only genuine pure V2 config
helpers and their explicit old build domain. `namespace(metadata,selectors)`
retains the real original generation/DB namespace, including its old BASE and
FORMAT. Consumers must use the candidate's explicit operationFile and
buildOperatorSha256; they must not infer a new operation path or equate the old
build producer with this new acceptance producer.

Local validation: eight pure proof controls and ten actual-source composition
controls. Boundary fixtures supply synthetic files/processes/DB results only
where identified. The root-provided safe terminal scalars also pass the pure
function locally; that is separate from root's actual read-only qualification.
These source tests do not claim full Host qualification or candidate acceptance.
