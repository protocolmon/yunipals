# Current shared-reader handover

Prepared 23 October 2026. This is the current operator map for the four collection/cache consumers. Their production switches are still pending native source readiness. Public collection and booster purchases continue serving through their accepted launch path; none of these migration gates disables pack sales.

The production-qualified entry is `consumer-operational-marketplace-ack-v2.py`. Use its explicit `owner`, `preview` or `install` first argument. It binds the frozen owner-v6, preview-v6 and install-v7 implementations plus the exact already committed marketplace read history. Running the underlying older owner/preview/install directly omits that acknowledged history and can reject the real catalog. The marketplace history acknowledgement preserves existing permissions; it does not activate marketplace scanners or sales migration.

| Component | Exact SHA256 |
| --- | --- |
| Entry `consumer-operational-marketplace-ack-v2.py` | `9a5190ee5bbb74ea72bd128359e1c14ead3083148b430210515119d82851ef4d` |
| History `consumer-accepted-marketplace-acl-v2.py` | `4fa510efd86714404655403617d46cd597fb099b6ed3d9a003cf293269c34a36` |
| Owner core `consumer-operational-owner-v6.py` | `f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d` |
| Preview core `consumer-operational-preview-v6.py` | `447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777` |
| Install core `consumer-operational-install-v7.py` | `9a59728a3dbdac9c039d1bd1e0c35557a15ece2ec018c5b6bee25bcfcae7d078` |

Actual [19:27 production qualification](../../docs/unified-indexer/marketplace-history-production-qualification-v2-2026-10-22.json) passed the feature ACL history and two transaction-status reads with no service or database changes. The wrapper's install receipt identifies the entry SHA above while retaining format `yunipals-consumer-operational-install-v7`. The booster feature owner and final supervisor bind that exact producer; do not substitute a raw core receipt or normalize an unexpected current grant to pass validation.

The order remains:

1. Require complete historical and current canonical coverage, then capture the actual fresh fixed-boundary witness. Drain the exact legacy metadata/publication writers and perform the prepared native adoption, provenance and publication refresh. Verify actual native metadata readiness.
2. Drain the legacy generation writer and run the bounded official generation refresh with its capacity monitor. Publish a genuinely new generation carrying the selected ownership release and v4 read identity. Existing generation103 must not be relabeled.
3. Drain the old cache writer and commit the exact previously rehearsed native guard transition, retaining its actual commit and inverse. Require all35 native mappings, enabled triggers and current epochs. The guard's finite four collector reads are separate from the booster's seven combined-source reads.
4. Run `preview` sequentially for main, collector and Islands using fresh run IDs and the actual artifact/ACL/witness receipts. Main also requires the actual BNB transaction-evidence fixture. Successful receipts must prove selected serving and owned cleanup. Preserve the live collector's original LOGIN=true; restore each other role to its recorded prior state.
5. Run `owner` for the finite visibility and cache write slices using the successful main preview, chaining each actual ACL result into the next. Complete these before permanent reader installation.
6. Run `install` for cache first and prove the existing worker actually builds a fresh cache for the current accepted generation. Then admit main, collector and Islands one at a time. Preserve each exact installed invocation, definitions, selectors, private-input hashes and result. A failed or timed-out cache attempt requires inspection and its owned inverse; do not relax freshness or start another writer.
7. Compare actual public routes, filters, metadata, rarity, search, Solana, staking and transaction-status behavior. Finish native staking verification before enabling its five-minute timer. A separate booster handover must compare common-boundary rights/requests/NFTs/refunds, switch API and queue, observe a genuinely newer event, then retire its temporary scanner.
8. Only accepted consumer/booster receipts qualify the separate final EVM/Solana supervisor handover, coordinated rollback, restart and24-hour observation.

Every command defaults to read-only review and mutates only with its exact fresh `--apply` hash. The entry removes only the first mode argument; the remaining CLI arguments and owned rollback protocol are those of its frozen core. For example, `python3 consumer-operational-marketplace-ack-v2.py preview --help` shows the exact preview interface. No plan in this document supplies a future successful receipt or guessed source-ready witness.

The [v4 generation/cache procedure](consumer-v4-handover.md) retains the official refresh, no-backup monitoring, guard transition and capacity details. Its old owner-v4/preview-v4/install-v5 API commands are historical and superseded by the entry above. The original [owned-booster handover note](consumer-owned-booster-handover-v1.txt) similarly records the first successor; its versioned commands are not the final entry. Keep their acknowledged historical files and receipts unchanged.

Operational configuration stays on the production host. Public `.env` files in this directory contain only fixed generation/capacity settings; they are not database or API credential files. Existing production identity, funding and private configuration remain authoritative throughout handover.
