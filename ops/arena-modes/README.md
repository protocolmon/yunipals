# Shared Arena v2 operations

Video and anime use the existing `YunipalsArenaV2` contract
`0xf34fb0a9ecf31bf7516098105036aba7ed4adda9`, deployed at Base block 53,261,777.
Keep the fighter registry `0xdbcab53a8e32d43997de252fd49c43ab8df290bf` and its
four approved fighters. The previous video and standalone Anime tournaments were
personal tests. Retire their gameplay, services and product history; the user
handles any old claims directly onchain. Do not submit claims, refunds or owner
transactions during this transition.

Use [the shared source transition guide](../unified-indexer/shared-transition.md)
and [implementation plan](../../docs/unified-indexer/shared-indexer-arena-v2-transition-plan-2026-11-02.md).
One canonical Ponder process serves the whole project, the registry and both v2
modes. Do not install an independent Arena indexer as a permanent dependency.
The main managed indexer retains its Solana child and all non-Arena sources.

Each operational deployment remains separate:

| Mode | Deployment key | API prefix | Private settings |
| --- | --- | --- | --- |
| Video | `8453:0xf34fb0a9ecf31bf7516098105036aba7ed4adda9:video` | `/api/arena-v2/video` | `/etc/yunipals-arena-modes/video` |
| Anime | `8453:0xf34fb0a9ecf31bf7516098105036aba7ed4adda9:anime` | `/api/arena-v2/anime` | `/etc/yunipals-arena-modes/anime` |

Preserve existing runtime artifacts, database identities, provider request IDs,
cost reservations, ciphertext, frozen inputs, signed transactions and ready
films. Migrating the public source does not recreate private work. Reconcile any
ambiguous provider result before resubmitting a request.

Generate the new public Arena source overlay from the same validated shared
deployment specification used by the main indexer and observer. Gate new work,
stop/drain each mode's workers and halt its operational deployment before using
`arena-source-switch` to review and apply the exact current source epoch and
accepted block/hash floor. Do not edit `source_selection` directly. Start reads
first, verify existing tournaments and films, then restore the previous reviewed
availability. Existing owner-wallet pause controls remain in force.

`render_units.py --output /tmp/FRESH_REVIEW_DIRECTORY` prepares the separate
application units; it installs nothing. Keep the restricted operational and
read-only source roles, pool/connection limits and credential allowlists. Shared
signing workers need three operational connections; other workers use two,
with source pools of two. No owner key belongs in a worker.

Only referee workers receive OpenAI access. Video media/capacity use Runware;
anime media/capacity use OpenRouter. Retain protected provider files and supply
provider settings before mode settings. Verify credential presence without
printing values. Retain the packaged engine, recipes, backgrounds, rules and
island profiles, including the existing shared background for the 898 islands.

The browser uses `VITE_SHARED_ARENA_API_URL=https://api.yunipals.com/api/arena-v2`
for both modes. Obsolete general Arena URLs redirect to v2; old tournament detail
URLs return to the hub. No previous-deployment history or claim interface is
required. The frozen deployment package remains available through `/arena/setup`
for explicit future admin deployments; this transition reuses the confirmed
contract above.

Keep encrypted backups of both modes, their private records, media, exact runtime
artifacts and the canonical source recovery configuration. Run isolated restore
tests without worker startup or provider access. Verify one steady-state Ponder
process, both managed ingestion children, current source observations, mode
source epochs, API health and absence of duplicate provider submissions after
restart. Record actual production acceptance and any pending replay/observation
window separately.
