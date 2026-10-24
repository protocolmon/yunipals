This small producer acknowledges current original Arena worker actors after a normal `Restart=on-failure` lifecycle. It does not run a rehearsal, create a role, read a database, change a service, select a source or expose a private configuration/key value. The frozen22-file v1 package and its failed default review remain unchanged.

The helper imports exact v1 rehearsal2eb8c842 only for its protected-reader and immutable restore module loading leaves. It never calls or patches that module's historical `context()` predicate. Restore505a authenticates committed owner11/0410, owner COMMIT84db, canonical restored resultb110 and proposalca56. The original eight definition/environment/credential mapping graph and original private input hashes are checked before and after each observation. `m.process_identity()` is the actual retained official owner11 function.

Two observations one second apart must agree byte-for-byte on all8 current process/invocation tuples, restart metadata and static/private hashes, with no Arena manager jobs. A current tuple can either be exactly retained, or differ only in PID/startTicks and invocation. A replacement needs the old PID absent, strictly newer kernel startTicks, a positive manager `NRestarts`, healthy running manager state, and the same `on-failure`/`control-group` policy. Kernel start and manager monotonic start must align within2 seconds; active-enter follows start. At least one exact retained cryptographic invocation anchors the historical actor frame to this boot. All-eight replacements without that anchor refuse for separate review.

Stage the exact reviewed helper at `/opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-native-v1.actors.py`, root-owned and not writable by other users. Its dependencies already belong to the staged/published immutable v1 closure. No private file contents belong in the staging/publication packet.

Default command is read-only and prints only the fresh review hash, producer hash and retained/restarted actor counts:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-native-v1.actors.py
```

Root may explicitly capture the exact fresh reviewed observation:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/arena-ypal-native-v1.actors.py --capture ACTUAL_REVIEW_SHA256
```

Capture repeats the read-only review before checking the supplied hash, then exclusively creates `/var/backups/yunipals-arena-ypal-actor-ack-v1-20261024` root0700 and `{review,result}.json` root0600 with fsync. The full actor/private-hash snapshot stays there; stdout contains counts and the actual result SHA only. Existing directories/files are never overwritten or retried. A partial audit-file prefix is retained for manual inspection; no process or database effect needs inversion.

The acknowledgement uses format `yunipals-arena-ypal-current-actors-v1`, `acknowledged:true`, `reviewHash`, producer hash and `binding`. Current actors are `binding.snapshot.actors`; the old restore acknowledgement is separately bound by its historical hash and is never rewritten. `oldWholeInvocationGatePassed:false` remains explicit.

`acknowledgement(actual_result_sha)` authenticates only the protected acknowledgement/current boot/producer/review. `validate_current(actual_result_sha)` additionally repeats the strict current8-actor/static/private observation. A future explicit v2 consumer can use these distinct leaves: fresh validation before an owned stop, immutable acknowledgement plus that operation's own drain/start records after the stop. It must never substitute new tuples into an old receipt or claim the old invocation validator passed. No dependent producer or future receipt hash is invented here.

Local tests:

```sh
python3 -I -B ops/unified-indexer-transition/arena-ypal-native-v1.actors.test.py
```

Ten controls pass, including two actual snapshot calls, official process identity over synthetic procfs, start alignment, old-PID reuse, private/definition/job drift, missing retained anchor, exclusive0700/0600 capture, same-boot ACK authentication and post-ACK drift refusal. The author performed no host or provider call. An actual production ACK does not exist until root captures one.
