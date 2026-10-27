# Explicit generation attempt using retained V5c recovery evidence

This is a new attempt, not a restart/resume of the failed transaction. Its input
and source are prepared separately; no worker, generation or publication is
accepted by this document. The failed V5c private journals remain immutable.

The V3 artifact is `a39b937dbe2278478ccbecb16af362707e9b8160092488c15e513a28e5a2878a`,
manifest `4ec5e6012b38bcad0a20816fd71c6eb54bd8137a4e477a396ce1149812109442`.
The original f81 install acknowledgement remains a separate retained input.
Root supplied the independently validated real V3 installation acknowledgement
`ee7ecf9551e11a7d66390a6904b4454b0cd744bd2ed28923b05425c3b9e6ed9d`.
Neither installation acknowledgement is a generation result.

The fixed operational identities are:

| Purpose | Exact identity |
| --- | --- |
| Owner | `ypal-ordinary-generation-attempt-v1.py` |
| Monitor | `ypal-ordinary-generation-attempt-watch-v1.py` |
| New journal | `/var/backups/yunipals-ypal-ordinary-generation-attempt-v1-20261025` |
| New private input | `/var/backups/yunipals-ypal-ordinary-generation-attempt-input-v1-20261025/input.json` |
| New unit | `yunipals-ypal-ordinary-generation-attempt-v1.service` |
| New runtime directory | `/run/yunipals-ypal-ordinary-generation-attempt-v1-20261025` |
| New PostgreSQL application | `yunipals_ypal_ordinary_generation_attempt_v1_20261025` |
| Actual retained capsule | `/var/backups/yunipals-ypal-ordinary-generation-v5c-20261025/capsule-result.json` |
| Actual original boot archive | `/var/backups/yunipals-ypal-ordinary-generation-v5c-20261025/original-boot-link` |

The owner exports a literal finite `SOURCE_PINS` mapping. Each listed public
file is authenticated before construction; the consumer binding authenticates
the same map plus the actual new owner before evaluation. This conservative
historical closure contains 161 files. The 4 MB maximum applies only to exact
names and SHA256 values, including one historical source over 200 KB. Direct
executable modules retain their tighter source limits.

The retained operation is `08c4510a38e48a835ba7097234f08a8b07e7f555c0dea6f08b4931f5c8778045`;
its capsule is `c5b485d7c28e650d70644effaa5b84c258d32cfc125bcd87876682c9010b9cdd`.
The owner authenticates the real drain/stop/boot records, the original private
inputs and consumer fence, 103/102 pointer and archive/stamp baseline, capsule
private catalog and contents, and the exact failed worker invocation and
termination receipts. It queries the actual V5c application name, not the
historical restored-worker literal. No old drain, capsule capture, boot move,
leaderboard restart or original start guard is executed or reset.

## Input and phase contract

All commands below run only after root has staged and checked the reviewed
public source closure in `/opt/yunipals-unified/operations/free-replay-20261020`.
No-argument owner and monitor commands are inert.

The following command is read-only. It verifies the actual V3 installation and
renders the finite input from the authenticated original V5c operation:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-generation-attempt-v1.py --prepare-input --install-sha ee7ecf9551e11a7d66390a6904b4454b0cd744bd2ed28923b05425c3b9e6ed9d --maximum-seconds 2400
```

Root saves that returned JSON exclusively as the fixed input file, under a real
root-owned 0700 parent and with mode 0600, then hashes the actual saved bytes.
The duration must be an integer from 1470 through 2400 seconds. No default or
elapsed time supplies permission to extend the window. Input rendering does not
need a build window; adoption and build reviews require the full current window
before the next backup. Backup timers remain unchanged.

Each phase below receives `--input-sha` with the actual saved input digest.
Review hashes and operation hashes come only from real preceding phase output.
Do not insert guessed values or reuse an unknown action acknowledgement.

1. No `--phase`: read-only adoption review. This checks current full source,
   metadata, original consumer fence, retained recovery evidence, capacity and
   backup exclusion. No new journal is created.
2. `--phase adopt --ack`: requires that review hash, creates only the new private
   operation journal and operation record, and returns its actual SHA256.
3. `--phase build-review --operation-sha`: read-only fresh review of that exact
   new operation, current source/fence/capsule and complete backup/capacity window.
4. `--phase build --operation-sha --ack`: requires the new build review hash,
   writes exclusive new build/file/start intents, installs one new unit and
   starts it once. It never repeats an existing build prefix.
5. `--phase reconcile --operation-sha`: read-only observation of the actual
   running, failed, successful-but-unaccepted or unknown prefix. It does not
   create a started/candidate success receipt or repeat a manager command.
6. `--phase accept-review --operation-sha`: requires actual successful monitor
   and Node output, exact new invocation/start boundary, gone child process epoch,
   no matching application backends, and a real new ready unpublished generation
   with equal GEN validation and fresh persisted source snapshot.
7. `--phase accept --operation-sha --ack`: requires that acceptance review hash,
   saves an exclusive acceptance intent and new candidate receipt. It does not
   publish a pointer, mutate wallets/stamps, start a cache or switch a reader.

The review binds stable source/input/recovery identities and safety policy.
Actual available bytes and relation estimates are measured again at each effect
boundary; changing incidental free-space observations does not make a reviewed
hash impossible to use. The measurements and full exclusion predicates remain
mandatory before the single start.

## Monitor and acceptance

The worker keeps pool 4, a 25 GB reserve, a 30 GB abort threshold, the retained
3/2 capacity estimate, backup/restore exclusion and exact owned application plus
backend-start cancellation predicates. `RuntimeMaxSec` is the actual chosen
monitor maximum plus 30 seconds; `TimeoutStopSec=20`, `Restart=no`, empty
capability sets and the retained restrictions remain. The new unit has no boot
activation link.

Every ten seconds the monitor saves a bounded root-private statement observation
for its exact application, same database/role and start boundary. Only PID,
backend/query start, SHA256 and byte length of SQL, state and wait fields are
returned by PostgreSQL. SQL text and user rows are never exported. At most four
worker backends and 242 sample slots are allowed. An explicit child PID/start
 tick/process-group record binds the new artifact command and proves the owned
child epoch gone at acceptance. Monitor failures remain failures even if a
transaction committed before a later Node failure; reconciliation reports
observations and never fabricates a ready candidate.

The candidate format is `yunipals-ypal-ordinary-generation-attempt-candidate-v1`.
It names the new owner and operation, actual V3 artifact/install, genuine worker
records and GEN/source snapshot, while `capsuleResultFile`,
`capsuleResultSha256` and `retainedOperationSha256` point to the real V5c recovery
lineage. No capsule is copied or relabelled into the new journal.

## Read-only consumer interfaces and limits

`namespace(metadata_input_sha, selector_candidate_sha)` returns the new real
identities. `validate_candidate_database_current(candidate_sha)` authenticates
the candidate/worker/installation/database validation and unchanged original
global capsule context. Its caller owns current source, READ, cache and consumer
phase checks; this leaf does not demand an old cache actor after its owned drain.

`validate_retained_current(candidate_sha)` is narrower. It authenticates the
immutable acceptance/worker/installation lineage, retained original drain,
private inputs, boot inode and private recovery capsule, and both exact old/new
worker process/backend terminal states. It remains valid after a separately
owned publication changes the global pointer/wallets/stamps. It confers no
current unpublished-candidate, whole READ graph, source or global-pointer
readiness authority. Its explicit static constructor never calls the old
metadata refresh, and a refresh attempted on it fails rather than supplying a
fake successful callback. Forward execution still constructs and runs the real
original current-source/READ qualification.

All current evidence is same-boot. Both failed and new worker evidence live in
real `/run` directories, so acceptance after a full host reboot requires a
separate truthful durable archival/recovery policy. No `/run` records are
invented or reconstructed here. This attempt does not satisfy later full reboot
acceptance, recurring generation, publication or managed EVM/Solana adoption.

Twenty source/fixture controls pass, including the actual compiled metadata
candidate RELEASE/IDENTITY namespace and the exact frozen unit compiler. These
are source tests, not an actual new generation, candidate or publication receipt.
