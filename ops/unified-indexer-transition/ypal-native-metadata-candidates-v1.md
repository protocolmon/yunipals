# Fresh combined release: metadata candidates

This prepares the metadata path for actual source release
`0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3`,
physical schema `unified_ypal_20261023_v1`, logical read schema
`yunipals_ownership_4e77f52b_v4`, read identity
`0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67`.
It neither adopts metadata nor selects a worker. The new combined source's
current framework readiness and Base metadata coverage still gate later work.

The prepared owner reuses the actual normalization artifact `cf333946…` and
its installed receipt `14ca61da…`. It authenticates the acknowledged existing
v4 candidate receipt `be0e6ec9…`, private `native-recovery.env` SHA
`bba7312f878d828df49d23b1bb8c5245fe196f477cd9cf8e05a953af01599cb0`,
and exact wrapper/candidate hashes. It does not call their obsolete whole
preparation/old source validators after source008 has been drained.

Only these six existing public environment values change:

| Key | Prior value | New value |
| --- | --- | --- |
| `DATABASE_SCHEMA` | `unified_shadow_20261020_7e7375b0` | `unified_ypal_20261023_v1` |
| `OWNERSHIP_READ_SCHEMA` | `yunipals_ownership_35cdcb32_v4` | `yunipals_ownership_4e77f52b_v4` |
| `READ_DATABASE_SCHEMA` | `yunipals_ownership_35cdcb32_v4` | `yunipals_ownership_4e77f52b_v4` |
| `OWNERSHIP_RELEASE_ID` | `0x35cdcb32…` | `0x4e77f52b…` |
| `UNIFIED_INDEXER_RELEASE_ID` | `0x35cdcb32…` | `0x4e77f52b…` |
| `PONDER_RPC_URL_8453` | `http://127.0.0.1:19202/` | `http://127.0.0.1:19222/` |

The existing `UNIFIED_INDEXER_RELEASE_ID` key already exists in bba; it is repinned rather than left as an old
release selector. `UNIFIED_INDEXER_DATABASE_URL` stays absent. The original
local `DATABASE_URL`, existing role `yunipals` OID16388, password, provider keys,
archive/projection/native modes, BNB confirmations and pool limits retain their
values. Both Node's `--env-file=` and the CLI's `--env-file` refer to the same
new private file, preserving the official runtime-environment equality guard.

The Base point-read URL becomes `http://127.0.0.1:19222/` on the new combined
proxy, using its existing ROOT route. Do not use `/unified`: official adoption
requires chainId, canonical header and EIP1967 storage reads, and restricted
source routes do not admit that complete method set. The root factory performs
no unified profile/manifest check for plain native requests. The one combined
Ponder poller keeps this proxy’s observed head fresh via its normal unified
latest-header reads. Numeric storage points must be within the existing recent
block window; the native canonical frame and unchanged10min adoption timeout
remain required. Numeric header reads alone do not seed an unknown head.

The sixth repin avoids a hidden dependency on old19202 continuing to refresh its
head after legacy clients are retired. It changes no financial policy, budget,
paid flag or endpoint provider list. All seven actual new-proxy paid flags remain
false under its acknowledged route receipt. This preparer makes no RPC requests.

## Root default review and dormant staging

The actual read-view owner `2e8e9747…` has completed its real protected
`created.json` receipt under
`/var/backups/yunipals-ypal-combined-readview-owner-v1-20261023`, canonical SHA
`17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3`,
schema OID75994954. The preparer accepts only this receipt. The default review checks actual
source c96d / PID2472127 / invocation9d9f, the immutable read-view object OIDs
and definitions, cf333 artifact, old candidates, existing DB/role and live old
metadata writer. It reads the legacy cursor/mode, current native approval,
publication counters and the actual Base probe. It exports only hashes,
public selectors, aggregate states/counts, actor metadata and missing reads.

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-native-metadata-candidates-v1.py \
  --readview-result-sha 17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3
```

After root reviews the returned exact binding, repeat once with
`--stage "$ACTUAL_METADATA_CANDIDATE_REVIEW_HASH"`. This exclusively creates
four dormant files under
`/var/backups/yunipals-ypal-native-metadata-candidates-v1-20261023`:

- `native-recovery.env` (0600, existing private configuration with six repins)
- `native-recovery.sh` (0700, unchanged official three-command wrapper)
- `yunipals-metadata.selectors.env` (0600, public selectors)
- `yunipals-metadata.service.drop-in.candidate` (0600, existing cf333 worker)

The original candidates and all live definitions remain unchanged. The source,
read catalog/ACL snapshot, role and old writer are rechecked before the stage
is acknowledged. A partial/existing directory is refused; do not overwrite or
automatically retry it. There is no service stop/start, grant or adoption mode.

The immutable source/read object identities and the current full ACL snapshot
are distinct checks. `currentReadCatalogSha256` binds all actual current ACLs
through review/stage. This candidate receipt does not acknowledge a future
permission-admission receipt or prove that a grant came from an owned operation.
`permissionAdmissionAcknowledged:false` and `adoptionAccepted:false` remain
explicit even if current effective reads are present.

The source guard intentionally still authenticates the accepted pre-grant role
graph. The forthcoming read admission changes that graph, including collector
edges used transitively by the source/RPC/read-view owners. After grants, this
preparer must use a separately reviewed acknowledgement-aware preservation
successor; it must not call the old guard and pretend it passed. No such future
grant receipt or preservation-successor hash is invented here.

The actual read-only context and subsequent dormant staging were verified.
Detailed process, configuration and publication receipts are retained locally.
The legacy worker remains active. Staging is preparation ancestry, not an
adoption or public-native provenance claim.

## Remaining adoption and publication steps

These are later, separately owned actions. This package does not run them.

1. Admit the exact reviewed missing reads for existing role16388. The minimum
   native-adopt/refresh/provenance closure is three schema USAGEs, eight SELECTs
   and two invoker EXECUTEs; the full worker additionally needs its eight other
   view SELECTs plus source_probe/base_metadata_probe. Preserve all existing
   operational ownership/DML, DBURL and RPC authority. Bind the actual grant
   receipt and effective negative checks before final worker selection.
2. Require real fresh canonical Base coverage beyond the captured exclusive
   legacy cursor. The official frame/marker must bind4e77/cac869; neither a raw
   checkpoint suffix nor standalone YPAL readiness substitutes for it.
3. Capture the then-current old metadata/scanner/publication invocation and
   all restart paths. Drain only those owned writers and prove cgroups/sessions
   terminal before any native adoption; retain their exact inverse. The stage's
   old-writer snapshot is preparation ancestry, not a future stop authorization.
4. Execute the same official `native-adopt` command with the new two-consumer
   environment file. It takes the existing advisory lock, compares all decoded
   legacy/native tuples through the frozen cursor in16 partitions, performs
   real canonical header/implementation checks and only then commits native
   scan mode and approval. No cursor, event or checkpoint is manufactured.
5. Use official bounded `native-provenance` (at most5000 records per call,
   refresh first) and `native-refresh`. Preserve actual outcomes; do not loop
   blindly or interpret a zero batch as complete publication acceptance.
6. Select the acknowledged cf333 native metadata worker only through its owned
   handover, after grant/readiness/publication acceptance. It maintains the
   deliberately short-lived native approval on its ordinary loop. Keep genuine
   later generation/cache publication and guard transition separate; old
   generation103 is not relabelled as fresh native output.

No synthetic point RPC or fabricated witness is introduced. No successful
adoption, publication refresh or worker selection is claimed by staging.

## Local controls

```sh
python3 -I -B ops/unified-indexer-transition/ypal-native-metadata-candidates-v1.test.py
```

Thirteen synthetic Python controls exercise the exact created-read-view pin,
the six public selectors, retention of private values and refusal of private
changes, original role/DBURL scope and absent new source credentials,
both runtime/CLI file selectors, unchanged official bundles, refusal of the
restricted `/unified` point route, wrong wrapper occurrences, separate immutable
object identity/current ACL hashes, exact source actor, read-only SQL and the
absence of adoption/service/provider execution phases. The separate exact
compiled-artifact factory test injects one synthetic accepted poller header and
then the four native ROOT calls: no root unified-profile validation, no paid
reservation, and no real sockets, database or provider. It also refuses root
requests carrying unified headers. No production action is performed by these
controls.

```sh
node ops/unified-indexer-transition/ypal-native-metadata-root-route-v1.test.mjs ops/unified-indexer-transition/ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs
```
