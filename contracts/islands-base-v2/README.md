# Base Islands replacement

Deployed and finalized on Base (chain 8453):
`0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168`.

898 tokens, IDs 1–525 and 1001–1373. The Merkle root fixes each ID's recipient
from the old Base collection at finalized block 52587044. The published arena
assignments are preserved. Token URIs include the individual token ID:
`https://islands-meta.yunipals.com/v2/base-islands/{tokenId}`.

The source is verified on BaseScan. Finalization removed the minting owner;
this deployed contract cannot mint further tokens or change its URI prefix.
Metadata and artwork remain hosted on the Yunipals server with Storage Box backups.

## Reproduce locally

Use Node 24, `npm ci`, then `npm test` and `npm run typecheck`.
The six contract tests include a complete 898-token mint and finalization rehearsal.
`npm run prepare:plan` checks the frozen snapshot and produces the distribution proofs.

Public deployment records are in `deployments/replacement-v2/`. The reconciliation
report distinguishes mint recipients from three verified post-mint transfers.
The server's read-only reconciliation uses `ops/base-islands-v2/reconcile.mjs`.
The deployment scripts persist exact signed transaction bytes before broadcasting;
those private recovery files and all credential files are excluded from Git.
Do not reuse this finalized release's preflight to deploy another collection.

The active website/indexer identity is `base-islands-v2`. The old `base-islands`
API returns HTTP 410 with the successor identity; legacy website links redirect.
The old collection and its database history are retained for provenance.
