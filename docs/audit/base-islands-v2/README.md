# Replacement release verification

Completed on 14 October 2026. The user authorized replacing the old Base airdrop,
selected current Base owners at a fixed finalized snapshot, and funded the existing
signer. All 898 token IDs and their previously published reveal assignments were preserved.

- New contract: `0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168`.
- Old contract: `0x1058f1a6fedcaec94e488d6ec3c639e541faf066`.
- Snapshot: Base block 52587044; 23 recipients differ from the original airdrop.
- Deployment: block 52587956; minting finished at block 52588159.
- Finalization: block 52588667; owner is the zero address.
- Backend: `base-islands-v2-20261014-318a865c2513`.
- Frontend: `dpl_Ggwis76vUgExBmcC6zQovUoQwEAp`.

Verification covered all 898 mint recipients, per-token metadata URLs and public
metadata hashes; all 1,796 active Ethereum/Base identities and counterpart links;
desktop/mobile browsing, actual image loading, revealed traits, filters and legacy
redirects. Base ownership verification also reconciled post-mint transfers of IDs
294, 320 and 365. Contract tests, backend tests and frontend checks passed.

The old collection remains on-chain, but is superseded in the website. Its worker
is stopped, its records remain archived, and old API routes return HTTP 410.
Browsing reads PostgreSQL only. The replacement worker uses the existing RPC budget
gateway, ten-block log requests, periodic owner verification, and daily metadata
audits. No CU allocation changes were made for this replacement.

The recovery archive includes both Base schemas, Ethereum state, all 2,694
metadata publications, provenance, deployment source/proofs and replacement metadata.
Storage Box upload/download checks passed, followed by a clean disposable PostgreSQL
restore with no missing source blobs. See `storage-box-verification.json` and
`database-restore-verification.json`. Artwork was unchanged and retains its existing
artwork release backup.

Rollback: restore the saved API override and nginx snippet described in
`api-deployment.json`, re-enable the old Base worker and restore the previous health
script; promote the previous frontend recorded in `frontend-deployment.json`.
Rollback of the website does not undo on-chain mints. Retain both schemas and all proofs.
