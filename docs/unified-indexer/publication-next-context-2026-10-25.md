# Remaining publication integration after metadata completion

This is a source-integration note, not a production acceptance receipt.

The metadata completion is real: original observed receipt
`6d8998f33db107a278097aff8b419cb0bea684151b2e73f7b72fc20a48906c1b`,
completion receipt
`2a297cba154b07e8a95138ed0395103abb22bc971463644034be5f09c8a135e4`.
All440,194 published archive records match. The final query took20.779seconds.
The original failed phase remains failed; its metadata command was not repeated.

The actual selector receipt is
`451c497495c138e887bd95acfa426f40f5bf7194369ca22df42c85f6611b579b`.
Generation is now routed to V5c, producer
`ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da`,
through the separate bounded phase entry
`79ef997f3553115fc648df18787e43b91d3617c4dccf56b92dae14833b72508e`.
Use the actual generation candidate receipt only after its build/acceptance.

The source guard V5 passed real qualification at10:00UTC. Its producer is
`052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0`;
qualification receipt is
`308559bffa280ce20782f527319cadeaca2ed506687805eb4e7a6c13f0a062ec`.
Its callback took6.879seconds. This does not qualify an entire publication callback.

The remaining consumer composition must explicitly address these dependencies:

- The prepared read/cache provider387c6a16 still pins unused generation V5b1ae13089.
  Route a new provider/proof dependency graph to the actual V5c producer and its
  actual candidate format/path. Do not relabel a V5c candidate as V5b output.
- Bind publication-query adapter V2deeaead4 at the new metadata constructor seam.
  The original full-publication body and SQL compiler remain authenticated.
  Only that exact read gets60seconds; ordinary queries keep their limits.
- Use the qualified source guard V5. Whole-host mount hashes from V4 refuse on
  unrelated host mount churn; V5 retains the six required mounts, relevant
  ancestors/descendants, namespace identity and backing inode checks.
- The prepared cache child has15seconds of PostgreSQL idle allowance and100seconds
  total parent protocol allowance. The current full comparison alone took20.779
  seconds. It cannot honestly qualify for that15-second window. Any successor
  must explicitly reconcile the SQL idle bound, parent deadline and timing gate,
  while retaining held-XID, literal ACK, current-source and catalog predicates.
- The prepared reader child uses90-second idle windows and the timing gate reserves
 70seconds for effects, leaving20seconds for the callback. The measured comparison
  alone exceeds that remainder. Qualify an explicit successor window or a separately
  justified comparison design; do not report the existing gate as passed.
- Repin sealed public SQL entries, transports, proof/context manifests and explicit
  caller dependencies consistently. Preserve the actual V5 data schema and identity;
  a new producer version does not create a new database schema.

No cache grant/COMMIT, reader LOGIN/publication, API switch, Arena adoption,
feature retirement or managed EVM/Solana adoption is authorized by this note alone.
Those operations keep their actual reviewed inputs, fresh checks, exclusive intents,
acknowledgements and rollback. Existing user authorizations remain in force; this
note does not add a new user-approval requirement.
