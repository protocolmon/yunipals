# Booster v7 native read admission

The staged e283 current consumer entry and v7 feature handover are compatible with
the current 41fe/5ae HTTP API. The bounded production observation at
2026-10-23T14:21:49Z verified their exact hashes, the final-v4 hash and the exact
pre-admission catalog graph. Combined build `bf4939b3ff` was locked and unready at
Base 52950938; launch build `6d581272ce` was ready at 52987979. The collector keeps
its two native Ponder reads and ten launch reads. All eight proposed native reads
are absent. No v7 action directory or four final consumer install results exist.
The accompanying JSON contains the public observation and exact file/OID pins.

The concrete next operator action is the existing rollback rehearsal:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/booster-feature-handover-v7.py rehearse-grants
```

This command has **not** been run by this review. It creates the private v7
evidence directory and performs eight GRANTs inside a transaction ending in
ROLLBACK. It verifies the exact graph before and after rollback, and records the
actual guarded SQL, review hash and review-file hash. This phase does not require
native framework readiness or four final consumer installs. Its current-feature
check still requires the existing API, queue, private environment and launch graph.

Persistent admission uses `commit-grants`. The existing helper first requires
native framework ready=1, locked=1, version=6, dev=0, exact build `bf4939b3ff`,
complete Base block at least 52848542, and heartbeat/checkpoint ages at most
180 seconds. It then requires all four actual current-entry installs, their live
process/config verification and the final consumer artifact. The before graph
must still match the actual rollback review. No persistent admission is possible
through this helper while framework ready=0. Existing SQL intents require explicit
same-boot reconciliation and never reissue possibly committed SQL.

The eight SELECTs are for `yunipals_unified_collector` (OID 73187672) on
`unified_shadow_20261020_7e7375b0`:

| Relation | Existing OID |
| --- | ---: |
| booster_checkpoint | 73032644 |
| booster_engine_state | 73032614 |
| booster_event | 73032629 |
| booster_monster | 73032584 |
| booster_original | 73032554 |
| booster_refund | 73032599 |
| booster_request | 73032569 |
| booster_type | 73032539 |

The exact previously approved 86-grant document has SHA
`e3c3729257c2eb6685ec0aa930a910107839b1cbc2d82eb4a2b07e83b902e74c`.
Parsing all 86 statements finds zero of these eight grants and no booster
references. That cited approval does not cover this persistent delta. No broader
authorization is inferred by this review. The v7 grant transaction preserves role
LOGIN, six-slot connection limit, ownership, ten launch reads, two native Ponder
reads, every other ACL and all data/configuration.

After an actual rehearsal, separate authorization and the real readiness/install
gates, the existing command is:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/booster-feature-handover-v7.py commit-grants --apply <actual-review-hash> --artifact-file <actual-final-consumer-artifact> --artifact-sha <actual-artifact-sha256>
```

The placeholders deliberately have no future receipt values. Admission alone does
not switch the API or retire its temporary source. Fresh canonical v3 parity,
owned API/queue selector handover, a genuinely newer event and post-event parity
are still required by the unchanged operators.

The pending batch-engine upgrade changes implementation code behind the same
engine proxy. The reviewed change preserves storage, rules and event identities.
These handover helpers pin the engine proxy address, source build/systemd files,
HTTP API artifacts and database/read graphs; they do not pin the on-chain engine
implementation or runtime bytecode hash. An implementation-only upgrade therefore
requires no frozen helper edit. New batch openings must be included in the fresh
canonical parity boundary. The owner upgrade UI independently verifies its own
old/candidate implementation code and roles; this review makes no claim that the
upgrade has been signed or executed.

This review changed no production file, ACL, role, service, provider or frozen
operator. It did not inspect or alter the running receipt worker.
