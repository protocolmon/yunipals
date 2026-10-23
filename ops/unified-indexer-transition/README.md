# Unified indexer rollout entry points

This directory retains the reviewed production operators and their historical predecessors. The [implementation plan](../../docs/unified-indexer-implementation-plan.md) defines the full objective; the [current checklist](../../docs/unified-indexer/CHECKLIST.md) records actual completion. Preparation, successful local tests and inactive installation do not establish a production cutover.

Collection and booster packs are already live on the single www app. The shared source is still replaying history; replacement collection readers remain gated on actual native readiness. Production Arena continues running its restored original workers. Its twelve operational migrations are already committed; do not rerun the owner migration or use the obsolete adopter/runtime to perform native cutover.

| Work | Current entry point | Production state |
| --- | --- | --- |
| Normal historical replay | [source6-normal-replay-successor-v2.py](source6-normal-replay-successor-v2.py) | Existing live free-only process. Its acknowledged receipt binds that invocation; a timeout observing it is not authority to restart it. |
| Shared source observation | [unified source runbook](../unified-indexer/README.md) | Current canonical witnesses and feature readiness must be verified after catch-up. Historical checkpoints alone do not qualify a reader switch. |
| Metadata, generation, cache, staking and API readers | [consumer-current-handover.md](consumer-current-handover.md) | Ordered production acceptance and switches remain pending. Recognize the already-live booster collector admission. |
| Booster API and artwork queue handover | [booster-feature-handover-v5.py](booster-feature-handover-v5.py), [current reader sequence](consumer-current-handover.md) | Seven-read production rollback rehearsal passed; committed admission, common-boundary parity, genuine later event and temporary-source retirement remain separate gates. |
| Final EVM/Solana supervision | [final-supervisor-handover-v2.py](final-supervisor-handover-v2.py) | Exact public artifacts are staged. Shared startup, scheduled Solana publication, restart, coordinated rollback and observation have not passed. |
| Arena dedicated role admission | [commit-admission.py](../arena-native-admission-20261022/commit-admission.py), [exact admission scope](../arena-native-admission-20261022/COMMIT-ADMISSION.md) | Production rollback rehearsal and read-only commit review passed. Actual nine-role/240-grant COMMIT awaits explicit approval after automatic review rejected execution. |
| Arena private connection setup | [arena-modern-role-credentials-v1.md](arena-modern-role-credentials-v1.md) | Prepared only. Requires the actual admitted-role receipt; no passwords, LOGIN changes or private overlays have been applied. |
| Arena direct native cutover | [arena-direct-native-cutover-v1.md](arena-direct-native-cutover-v1.md) | Initial cutover and explicit forward continuation passed local fault tests and independent review. Both source files are staged, without execution. Requires actual role authentication and current canonical source coverage. |
| Arena post-native public-source rollback | New isolated-public rollback owner and target admission | In development. Keep compatible native private workers and records; never restore an old private database or restart the pre-adoption runtime. |

The exact installed Arena package has [completed build and retained-context acceptance evidence](../../docs/unified-indexer/arena-modern-production-artifact-acceptance-2026-10-23.json). That inactive installation does not replace the live workers or select a native source.

Each owner requires its own exact current receipts, file hashes, source identity, role/catalog state and fresh review. Use the actual protected receipts on the production host. No future receipt hash, database OID, authentication success or canonical-ready floor may be invented to fill a plan. Existing private configuration and credentials stay on the host; public evidence contains only the reviewed summaries.

The paid replay window has expired. Its unused compute ceiling does not authorize a new time window; this rollout continues under the existing free-only profile unless the user explicitly authorizes another paid window. Existing normal production provider reserves remain separate.

The [20 October artifact2 notes](artifact2-transition-2026-10-20.md), older versioned helpers and old archives are retained as provenance and inverse inputs. Their bounded-sample limits and launch commands describe that historical operation. They are not the current launch or resume procedure. Do not delete or repin acknowledged historical inputs to make a later operation pass.
