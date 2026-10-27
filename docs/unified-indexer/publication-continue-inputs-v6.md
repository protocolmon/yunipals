# Reader6 immutable input assembler

`ypal-ordinary-publication-continue-inputs-v6.py` renders the original ten Reader references from an actual cache6 prepared acknowledgement. It requires the actual Reader6 manifest, native policy2 result, and Authority6 input. The default CLI is inert. It never writes an input, constructs a current Reader Context, checks a live actor, dispatches SQL, or runs a service.

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-publication-continue-inputs-v6.py \
  --prepared-sha ACTUAL_CACHE_PREPARED_SHA256 \
  --manifest-sha 524c45b6453c7eee4bfc876a47f1e93df49c59afc8be7a383ee068f177c799ca \
  --native-policy-result-sha ACTUAL_POLICY2_RESULT_SHA256 \
  --authority-input-sha ACTUAL_AUTHORITY6_INPUT_SHA256
```

The public API is `reader_inputs(prepared_sha, manifest_sha, native_policy_refs, authority_input_sha)`. All supplied hashes must refer to actual immutable records. No future acknowledgement is supplied by this packet.

The complete original renderer body is compiled with exactly two changed literals: Reader source format1→6 and cache provider filename1→6. Its source map, cache input/configuration, prepared/before/committed chain, recorded sustained observer, peer/wire qualification, installer receipts, canonical witness, and exact ten-field contract remain checked. The utility selects the actual Family6 provider and Authority6. Frozen ReaderBinding supplies the complete cold Reader core and real phase provider. The added check constructs the genuine policy-aware immutable metadata Epoch and requires its binding to equal the epoch recorded in the cache `before` receipt. No old Reader5 or current actor success is asserted.

The owned manifest authenticates 342 actual source rows. Four local control groups execute the real cold Reader core, real phase provider, original renderer, and immutable Epoch relation against explicit private receipt I/O. Generated installer and input receipt hashes are relocated at the I/O boundary; these fixtures do not claim actual installation, cache commit, current source, or completed Reader publication. Refusal cases cover prepared flags/operator, observer, wire peer set, recorded metadata epoch, and manifest identity.

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-publication-continue-inputs-v6.test.py
```

Producing these references does not qualify or execute a Reader transition. The ordinary Reader6 current/source/actor/catalog/lock/transport/ACK checks still run in their actual phase.
