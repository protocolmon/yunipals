#!/usr/bin/env python3
"""Exact phase proofs for the coordinated native publication and three readers.

No grants, LOGIN changes, service actions, publication or provider calls are
performed by this module. Actual fixed receipts and an external exact source
manifest authenticate the invoking owner; no historical whole-validator is
reported passed after an acknowledged actor or catalog transition.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import types
from urllib.parse import unquote, urlencode, urlsplit

FORMAT = 'yunipals-ypal-native-cutover-proof-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-native-cutover-v1-20261024')
SOURCE_MANIFEST = OPS / 'ypal-native-cutover-v1.manifest.json'
CODE = ('ypal-native-cutover-v1.py', 'ypal-native-cutover-v1.mjs',
        'ypal-native-cutover-proof-v1.py', 'ypal-cache-finish-v2.py', 'ypal-native-cutover-v1.action.sql',
        'ypal-native-reader-probe-v1.mjs')
DEPENDENCIES = {
    'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c',
    'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633',
    'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6',
    'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416',
    'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21',
    'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2',
    'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6',
    'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920',
    'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e',
    'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c',
    'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53',
    'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e',
    'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777'
}
METADATA_FIXED_PRODUCER = 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53'
METADATA_FIXED_SHA = 'cd6161534f54c0d8f5856a1aba05dd29846c6f35652a98d017093d8ccdf87779'
METADATA_FIXED = Path('/var/backups/yunipals-metadata-fixed-parity-v4-20261024/result.json')
CACHE_FILE = 'ypal-cache-guard-owner-v1.py'
CACHE_SHA = 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba'
PUBLISHER_INSTALL_SHA = '5bf65d3b95877dc6094862968f21533df7902a4f2998b36ea076e606c04221aa'
PUBLISHER_DIGEST = '2b104015af8aa0fd6f4710c07bcc73125819e663a3d2f15de8d31443e587cefe'
MAIN_DIGEST = '40e35c622534b9030622759116cf3b85361ad914211a76a7fd47ee06b60968f9'
MAIN_INSTALL_SHA = 'a0ab86feca35317119153ce16fef19150e1087001d80887c5fb74afa138a7aa4'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
IDENTITY = '0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'
PHYSICAL = 'unified_ypal_20261023_v1'
READ = 'yunipals_ownership_4e77f52b_v4'
NODE = '/opt/node-v24.18.1/bin/node'
ACCEPTED_SOURCE_MANIFEST_SHA = '6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801'
PEERS = {
    'main': {'unit': 'yunipals-api.service', 'role': 'yunipals_unified_api', 'oid': '73187671', 'port': 9011, 'previewPort': 9101,
             'entry': 'apps/yunipals-indexer/lib/api/server.ts'},
    'collector': {'unit': 'yunipals-collector-api.service', 'role': 'yunipals_unified_collector', 'oid': '73187672', 'port': 9012, 'previewPort': 9112,
                  'entry': 'apps/yunipals-indexer/lib/api/collector-server.ts'},
    'islands': {'unit': 'yunipals-islands-api.service', 'role': 'yunipals_unified_islands_api', 'oid': '73187674', 'port': 9015, 'previewPort': 9115,
                'entry': 'apps/yunipals-indexer/lib/api/islands-server.ts'}
}
LOGIN_ROLES = {PEERS[name]['role']: PEERS[name]['oid'] for name in ('main', 'islands')}
CACHE_TABLES = {'read_epoch', 'read_guard', 'read_set', 'read_member'}
STATE_PROPERTIES = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'InvocationID', 'ControlGroup',
    'FragmentPath', 'DropInPaths', 'ExecStart', 'WorkingDirectory', 'User', 'Group', 'EnvironmentFiles', 'Job', 'NRestarts',
    'Restart', 'UnitFileState', 'WantedBy', 'RequiredBy', 'TriggeredBy', 'Triggers', 'PartOf', 'UpheldBy', 'KillMode',
    'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecReload')


def need(value, code):
    if not value: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def is_pin(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value)


def protected(path, cap=3000000):
    path = Path(path)
    for p in [*path.parents, path]:
        st = p.lstat()
        need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_cutover_input_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= cap, 'bounded_single_link_cutover_input_required')
    raw = path.read_bytes(); after = path.lstat()
    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    need(all(getattr(before, k) == getattr(after, k) for k in fields), 'cutover_input_changed_during_read')
    return raw


def document(path, pin=None):
    raw = protected(path)
    need(pin is None or is_pin(pin) and sha(raw) == pin, 'exact_actual_cutover_record_required')
    return json.loads(raw)


def source_manifest(pin):
    value = document(SOURCE_MANIFEST, pin)
    need(value.get('format') == 'yunipals-ypal-native-cutover-source-v1' and
         set(value) == {'format', 'files', 'dependencies'} and set(value['files']) == set(CODE) and
         value['dependencies'] == DEPENDENCIES and CACHE_FILE is not None and is_pin(CACHE_SHA), 'finite_frozen_cutover_source_contract_required')
    for name, digest in {**value['files'], **value['dependencies'], CACHE_FILE: CACHE_SHA}.items():
        need(is_pin(digest) and sha(protected(OPS / name)) == digest, 'exact_public_cutover_source_and_dependency_required')
    return value


def module(name, digest):
    need(isinstance(name, str) and '/' not in name and is_pin(digest), 'fixed_cutover_module_required')
    path = OPS / name; raw = protected(path, 150000)
    need(sha(raw) == digest, 'exact_cutover_module_required')
    result = types.ModuleType('native_cutover_' + name.replace('-', '_').replace('.', '_')); result.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), result.__dict__)
    return result


def role_login_delta(before):
    rows = {row['name']: row for row in before['roles']}
    need(set(LOGIN_ROLES) <= set(rows), 'both_existing_reader_roles_required')
    result = []
    for role, oid in LOGIN_ROLES.items():
        row = rows[role]
        need(str(row['oid']) == oid and row['login'] is False, 'only_exact_existing_NOLOGIN_reader_roles_may_be_admitted')
        result.append({'role': role, 'oid': oid, 'before': False, 'after': True})
    collector = rows[PEERS['collector']['role']]
    need(str(collector['oid']) == PEERS['collector']['oid'] and collector['login'] is True, 'collector_original_LOGIN_true_must_be_retained')
    return result


def login_postcatalog(before):
    delta = role_login_delta(before); result = copy.deepcopy(before)
    for row in result['roles']:
        if row['name'] in LOGIN_ROLES: row['login'] = True
    return result, delta


def exact_login_catalog(before, current, enabled):
    expected, delta = login_postcatalog(before)
    need(current == (expected if enabled else before), 'only_two_owned_reader_LOGIN_bits_may_differ_from_acknowledged_cache_postcatalog')
    return delta


def complete_cache_acl_baseline(acknowledged, actual):
    # Bind full ACL strings, including unmanaged grantees. Managed-role edge
    # subsets alone cannot establish the absence of an unrelated ACL grant.
    select = lambda v: sorted([copy.deepcopy(row) for row in v['relations']
        if row['schema'] == 'metadata_projection' and row['name'] in CACHE_TABLES], key=lambda row: row['name'])
    old, new = select(acknowledged), select(actual)
    need(len(old) == len(new) == 4 and {r['name'] for r in old} == {r['name'] for r in new} == CACHE_TABLES and old == new,
         'all_four_acknowledged_cache_relation_OIDs_full_ACLs_and_column_ACLs_must_remain_exact')


def semantic_guard(expected, actual):
    a, b = copy.deepcopy(expected), copy.deepcopy(actual)
    need(set(a) == set(b) and len(a['epochs']) == len(b['epochs']) == 4 and
         {r['collection'] for r in a['epochs']} == {r['collection'] for r in b['epochs']} == {'ethereum', 'base', 'polygon', 'bnb'},
         'same_exact_four_guard_epochs_required')
    prior = {r['collection']: r for r in a['epochs']}
    for row in b['epochs']:
        need(re.fullmatch('[0-9]+', str(row['revision'])) and int(row['revision']) >= int(prior[row['collection']]['revision']), 'guard_epoch_must_not_decrease_or_reset')
    for value in (a, b):
        value['epochs'] = sorted([{k: v for k, v in r.items() if k != 'revision'} for r in value['epochs']], key=lambda r: r['collection'])
    need(a == b, 'all_guard_OIDs_definitions_full_ACLs_column_ACLs_and_triggers_must_remain_exact')
    return sha(encoded(b))


LEAF_ROLES = {**{row['role']: row['oid'] for row in PEERS.values()}, 'yunipals': '16388'}
FEATURE_EIGHT = ('booster_type', 'booster_original', 'booster_request', 'booster_monster', 'booster_refund', 'booster_engine_state', 'booster_event', 'booster_checkpoint')


def reader_role_slice(expected, current, feature=False):
    """Four owned role identities/rights, not global ACL authority.

    Unrelated grantees are the later managed owner's explicit full graph scope.
    Its owned feature receipt is required before allowing the exact eight reads.
    """
    wanted = copy.deepcopy(expected)
    if feature:
        collector = next(r for r in wanted['effective'] if r['role'] == PEERS['collector']['role'])
        for name in FEATURE_EIGHT:
            path = PHYSICAL + '.' + name
            relation = next(row for row in wanted['relations'] if row['schema'] == PHYSICAL and row['name'] == name)
            need(collector['relations'][path]['select'] is False, 'feature_eight_must_be_a_distinct_later_owned_delta')
            collector['relations'][path]['select'] = True
            wanted['directRoleEdges'].append({'kind': 'relation', 'object': relation['oid'], 'object_name': path,
                'grantee': int(PEERS['collector']['oid']), 'grantor': 73004621, 'privilege': 'SELECT', 'grantable': False, 'column_number': None})
    def rows(value, field, key):
        return sorted([row for row in value[field] if str(row[key]) in (set(LEAF_ROLES) if key in {'name', 'role'} else set(LEAF_ROLES.values()))], key=encoded)
    for field, key in [('roles', 'name'), ('effective', 'role'), ('directRoleEdges', 'grantee')]:
        need(rows(current, field, key) == rows(wanted, field, key), 'exact_current_owned_reader_and_metadata_role_slice_required')
    actual_roles = {row['name']: str(row['oid']) for row in current['roles'] if row['name'] in LEAF_ROLES}
    need(actual_roles == LEAF_ROLES, 'all_four_exact_reader_and_metadata_role_OIDs_required')
    for field, key in [('schemas', lambda v: v['name']), ('relations', lambda v: v['schema'] + '.' + v['name']),
                       ('functions', lambda v: v['schema'] + '.' + v['name'] + '(' + v['arguments'] + ')')]:
        indexed = {key(row): {k: v for k, v in row.items() if k != 'acl'} for row in current[field]}
        for row in expected[field]:
            need(indexed.get(key(row)) == {k: v for k, v in row.items() if k != 'acl'}, 'all_recorded_reader_dependency_OIDs_owners_and_definitions_must_remain_exact')
    return {'fourOwnedRoleSlicesQualified': True, 'metadataRoleOid': '16388', 'featureEightComposed': feature,
            'actualCatalogSha256': sha(encoded(current)), 'recordedAfterLOGINCatalogSha256': sha(encoded(expected)),
            'fullGlobalRoleGraphQualified': False, 'sourceActorQualified': False, 'observerAuthorityQualified': False,
            'financialAuthorityQualified': False}


def column_authority_sql(role_oids=None):
    ids = [73187671, 73187672, 73187673, 73187674, 73765879, 16388, 73036832] if role_oids is None else role_oids
    need(1 <= len(ids) <= 7 and all(type(v) is int and 0 < v < 1 << 32 for v in ids), 'bounded_exact_role_OIDs_for_column_inspection_required')
    extra = 'OR'.join("(NOT has_table_privilege(r.oid,c.oid,'" + privilege + "')AND has_any_column_privilege(r.oid,c.oid,'" + privilege + "'))" for privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES'))
    return ("SELECT count(*)FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.oid=ANY(ARRAY[" + ','.join(map(str, ids)) +
        "]::oid[])AND c.relkind IN('r','p','v','m','f')AND n.nspname=ANY(ARRAY['" + PHYSICAL + "','" + READ +
        "','metadata','metadata_projection','metadata_source','yunipals_indexer_control','yunipals_boosters_ypal_v1','yunipals_boosters_launch_v1'])AND(" + extra + ")")


def validate_metadata_fixed(value, producer):
    need(value['format'] == producer.FORMAT == 'yunipals-metadata-fixed-parity-v4' and value['completed'] is True and value['exactDataParity'] is True and
         value['context'] == producer.CONTEXT and value['producerSha256'] == METADATA_FIXED_PRODUCER and
         value['executionSqlSha256'] == sha(producer.EXECUTION_SQL.encode()) and value['sqlSha256'] == sha(producer.SQL.encode()) and
         value['canonicalAcceptance'] is False and value['sourceSelected'] is False and
         value['databaseWrites'] == value['providerCalls'] == value['serviceJobs'] == 0, 'exact_metadata_fixed_data_only_capture_required')
    result = value['comparison']; parts = result['partitions']
    need(result['boundary'] == 52870977 and tuple(row['partition'] for row in parts) == producer.PARTITIONS and
         result['invalidKeys'] == {'legacy': 0, 'native': 0} and all(type(v) is int for v in result['invalidKeys'].values()), 'all_sixteen_metadata_partitions_and_valid_keys_required')
    scan = result['legacyScan']
    need(scan['chainId'] == 8453 and scan['contract'] == '0x98433df878e8c898cb907345c3a7756e5f72240f' and
         scan['deploymentBlock'] == '22224075' and int(scan['nextBlock']) > 52870977 and
         all(row['legacyScan'] == scan for row in parts), 'fixed_metadata_boundary_complete_legacy_scan_required')
    totals = {}
    for side in ('legacy', 'native'):
        fields = ['rows', 'unique_keys', 'mints', 'updates'] + (['unexpected_identities'] if side == 'native' else [])
        need(all(type(row[side][name]) is int and row[side][name] >= 0 for row in parts for name in fields) and
             all(is_pin(row[side]['payload_sha256']) for row in parts), 'actual_partition_counts_and_hashes_required')
        total = {name: sum(row[side][name] for row in parts) for name in fields}
        total['partition_digest_sha256'] = sha(''.join(row[side]['payload_sha256'] for row in parts).encode())
        need(total == result[side] and total['rows'] > 0 and total['rows'] == total['unique_keys'] and
             total['mints'] + total['updates'] == total['rows'], 'recomputed_full_metadata_partition_aggregate_required')
        totals[side] = total
    differences = {name: sum(row['comparison'][name] for row in parts) for name in ('missing_legacy', 'missing_native', 'changed_payloads')}
    need(all(type(row['comparison'][name]) is int and row['comparison'][name] == 0 for row in parts for name in differences) and
         differences == result['comparison'] and totals['native']['unexpected_identities'] == 0 and
         totals['legacy']['rows'] == totals['native']['rows'] == 440194 and
         totals['legacy']['partition_digest_sha256'] == totals['native']['partition_digest_sha256'],
         'all_fixed_metadata_rows_and_payloads_must_match_without_missing_or_extra_identities')
    return {'validated': True, 'dataParityAtCapture': True, 'canonicalAcceptance': False, 'currentReadinessQualified': False,
            'receiptSha256': METADATA_FIXED_SHA, 'producerSha256': METADATA_FIXED_PRODUCER, 'boundary': 52870977}


def process(pid):
    raw = (Path('/proc') / str(pid) / 'stat').read_bytes()
    fields = raw[raw.rfind(b')') + 2:].split()
    return {'pid': int(pid), 'startTicks': int(fields[19]), 'parentPid': int(fields[1]), 'bootId': boot()}


def terminal(unit, original_processes=()):
    # The invoking context supplies the bounded systemd reader. No manager
    # actions or blind stop retries belong to a proof function.
    need(unit['ActiveState'] in {'inactive', 'failed'} and unit['SubState'] in {'dead', 'failed'} and
         unit['MainPID'] == unit['ControlPID'] == '0' and unit['Job'] == '', 'owned_reader_or_worker_must_be_terminal')
    name = unit['Id']; need(re.fullmatch(r'[a-zA-Z0-9@_.-]+\.service', name), 'literal_owned_service_required')
    group = Path('/sys/fs/cgroup/system.slice') / name / 'cgroup.procs'
    need(not group.exists() or not group.read_text().split(), 'terminal_owned_cgroup_must_be_empty')
    for old in original_processes:
        try: now = process(old['pid'])
        except (FileNotFoundError, ProcessLookupError): continue
        need((now['pid'], now['startTicks']) != (old['pid'], old['startTicks']), 'owned_prior_process_must_be_gone')
    return {'terminal': True, 'unit': name, 'bootId': boot()}


def residual_client_pids(unix_raw, tcp_raw, backend_fds, rows, peers):
    """Select only actual socket owners capable of matching these PG backends."""
    need(len(unix_raw) <= 2000000 and len(tcp_raw) <= 2000000 and len(rows) <= 64, 'bounded_terminal_socket_observation_required')
    client_inodes = {peers[inode] for entry in backend_fds.values() for inode in entry['socketInodes'] if inode in peers}
    ports = {str(row['clientPort']) for row in rows if row['clientAddress'] is not None}
    selected = set()
    for raw, unix in [(unix_raw, True), (tcp_raw, False)]:
        for line in raw.decode().splitlines():
            cols = line.split()
            relevant = (len(cols) >= 8 and cols[5].isdigit() and int(cols[5]) in client_inodes) if unix else (len(cols) >= 5 and cols[3].rsplit(':', 1)[-1] in ports)
            if relevant: selected.update(int(value) for value in re.findall(r'pid=([1-9][0-9]*)', line))
    need(len(selected) <= 64, 'bounded_live_terminal_residual_peer_set_required')
    return sorted(selected)


class Context:
    """Actual receipt/catalog/source context, independently scoped after LOGIN.

    Reader actor phases are supplied by this same source manifest's controller;
    their exact fixed journals never stand in for the retained source proof.
    """
    def __init__(self, inputs):
        self.inputs = inputs
        self.manifest = source_manifest(inputs['sourceManifestSha256'])
        self.cache = module(CACHE_FILE, CACHE_SHA)
        self.cache.inputs()
        self.prepared = document(self.cache.BASE / 'prepared.json', inputs['cachePreparedSha256'])
        need(self.prepared['prepared'] is True and self.prepared['operatorSha256'] == CACHE_SHA and
             self.prepared['nativeGenerationPublished'] is False and self.prepared['nativeWorkerStarted'] is False,
             'actual_unpublished_cache_preparation_ack_required')
        outer = self
        class PhaseCacheContext(self.cache.Host):
            def refresh(self): return outer.scope()
        self.host = PhaseCacheContext(self.prepared['config'])
        self.before, self.rehearsal = self.cache.owned(self.host)
        self.sql_ack = document(self.cache.BASE / 'sql-committed.json')
        need(self.prepared['additionalReadAcknowledgementSha256'] == sha(protected(self.cache.BASE / 'sql-committed.json')),
             'prepared_cache_must_bind_actual_four_read_commit_ack')
        self.publisher = module('ypal-generation-publisher-install-v1.py', DEPENDENCIES['ypal-generation-publisher-install-v1.py'])
        self.publisher_receipt = self.publisher.installed(self.host.m, inputs['publisherInstallSha256'])
        need(inputs['publisherInstallSha256'] == PUBLISHER_INSTALL_SHA and self.publisher_receipt['artifactDigest'] == PUBLISHER_DIGEST,
             'exact_actual_publisher_install_required')
        self.main = module('ypal-main-api-install-v1.py', DEPENDENCIES['ypal-main-api-install-v1.py'])
        self.main_receipt = self.main.installed(self.host.m, inputs['mainInstallSha256'])
        need(inputs['mainInstallSha256'] == MAIN_INSTALL_SHA and self.main_receipt['artifactDigest'] == MAIN_DIGEST, 'exact_installed_main_successor_required')
    def query(self, sql): return self.host.query(sql)
    def catalog(self): return self.host.view.query(self.host.h, self.host.catalog_sql)[0]
    def guard_scope(self, cache_reads=True):
        observed = self.cache.sql_child(self.host, 'inspect')
        expected = self.sql_ack['result']['after' if cache_reads else 'before']
        digest = semantic_guard(expected, observed['state'])
        return {'semanticCatalogSha256': digest, 'epochsMonotonic': True, 'allColumnACLsQualified': True}
    def columns_current(self):
        need(self.query(column_authority_sql()) == 0, 'no_untracked_PUBLIC_or_foreign_column_authority_for_managed_roles_allowed')
        return True
    def leaf_scope(self, feature_refs=None):
        need(self.logins_enabled() is True and not (BASE / 'inverse-intent.json').exists(), 'completed_uninversed_reader_LOGIN_phase_required_for_leaf')
        feature = False
        if feature_refs is not None:
            need(set(feature_refs) == {'retirementSha256', 'manifestSha256', 'inputSha256'} and all(is_pin(v) for v in feature_refs.values()),
                 'actual_exact_optional_feature_receipt_triple_required')
            owner = module('ypal-feature-handover-v1.py', DEPENDENCIES['ypal-feature-handover-v1.py'])
            result = owner.validate_feature_leaf(feature_refs['retirementSha256'], feature_refs['manifestSha256'], feature_refs['inputSha256'])
            need(result['validated'] is True and result['collectorOnlyCurrentGraphQualified'] is True and
                 all(result[k] is False for k in ('sourceActorQualified', 'financialAuthorityQualified', 'independentPeerLifecyclesQualified',
                     'allConfiguredSourcesQualified', 'originalWholeValidatorsPassed', 'current143WholeGraphQualified')),
                 'explicit_collector_only_feature_eight_leaf_without_source_authority_required')
            feature = True
        expected, _ = login_postcatalog(self.sql_ack['postProof']['catalog'])
        current = self.catalog(); proof = reader_role_slice(expected, current, feature)
        # PUBLIC column writes/reads can grant authority without a managed
        # direct edge or table-level privilege; explicitly refuse that gap.
        need(self.query(column_authority_sql([int(v) for v in LEAF_ROLES.values()])) == 0,
             'no_untracked_PUBLIC_or_foreign_column_authority_for_owned_roles_allowed')
        proof['cacheGuard'] = self.guard_scope(True)
        proof['databaseWrites'] = proof['serviceActions'] = 0
        proof['sourceReadinessQualified'] = False
        return proof
    def accepted_source_closure(self):
        m = self.host.m; manifest = m.document(m.ROOT / 'RELEASE-MANIFEST.json', ACCEPTED_SOURCE_MANIFEST_SHA)
        need(len(manifest['files']) == 1751, 'exact_acknowledged_reader_source_manifest_required')
        for row in manifest['files']:
            name = row['path']; need(not Path(name).is_absolute() and '..' not in Path(name).parts, 'finite_accepted_reader_source_path_required')
            raw = m.protected(m.ROOT / name, max(4000000, row['bytes'] + 1))
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'accepted_collector_Islands_source_closure_changed')
        return {'sourceDigest': m.SOURCE, 'sourceManifestSha256': ACCEPTED_SOURCE_MANIFEST_SHA, 'sourceFilesVerified': 1751,
                'mainArtifactDigest': MAIN_DIGEST, 'mainInstallSha256': MAIN_INSTALL_SHA}
    def logins_enabled(self):
        path = BASE / 'roles-admitted.json'
        if not path.exists(): return False
        ack = document(path); op = document(BASE / 'operation.json', ack['operationSha256'])
        intent = document(BASE / 'roles-intent.json', ack['intentSha256'])
        prepared = document(BASE / 'roles-prepared.json', ack['preparedSha256'])
        expected, delta = login_postcatalog(self.sql_ack['postProof']['catalog'])
        need(op['binding']['format'] == 'yunipals-ypal-native-cutover-v1' and
             op['binding']['sourceManifestSha256'] == self.inputs['sourceManifestSha256'] and
             op['reviewHash'] == sha(encoded(op['binding'])) and ack['format'] == 'yunipals-ypal-native-reader-LOGIN-v1' and
             ack['operatorSha256'] == self.manifest['files']['ypal-native-cutover-v1.py'] and
             ack['bootId'] == op['binding']['bootId'] == boot() and ack['committed'] is True and
             intent['format'] == ack['format'] and intent['reviewHash'] == op['reviewHash'] and
             intent['authorizationSha256'] == sha(encoded(delta)) and
             intent['operationSha256'] == ack['operationSha256'] and prepared['mode'] == 'roles' and
             prepared['xid'] == ack['xid'] and prepared['before'] == self.sql_ack['postProof']['catalog'] and
             prepared['after'] == expected and ack['afterCatalogSha256'] == sha(encoded(expected)),
             'actual_separate_owned_two_reader_LOGIN_acknowledgement_required')
        inverse = BASE / 'roles-restored.json'
        if not inverse.exists(): return True
        restored = document(inverse)
        restore_intent = document(BASE / 'roles-inverse-intent.json', restored['intentSha256'])
        restore_prepared = document(BASE / 'roles-inverse-prepared.json', restored['preparedSha256'])
        need(restored['format'] == 'yunipals-ypal-native-reader-LOGIN-inverse-v1' and restored['restored'] is True and
             restored['operationSha256'] == ack['operationSha256'] and restored['admissionSha256'] == sha(protected(path)) and
             restored['operatorSha256'] == ack['operatorSha256'] and restored['bootId'] == boot() and
             restored['beforeCatalogSha256'] == ack['afterCatalogSha256'] and
             restored['afterCatalogSha256'] == sha(encoded(self.sql_ack['postProof']['catalog'])) and
             restore_intent['format'] == restored['format'] and restore_intent['bootId'] == boot() and
             restore_intent['operationSha256'] == ack['operationSha256'] and restore_intent['admissionSha256'] == sha(protected(path)) and
             restore_intent['inverseIntentSha256'] == sha(protected(BASE / 'inverse-intent.json')) and
             restore_prepared['mode'] == 'roles-inverse' and restore_prepared['xid'] == restored['xid'] and
             restore_prepared['before'] == expected and restore_prepared['after'] == self.sql_ack['postProof']['catalog'],
             'exact_owned_reader_LOGIN_inverse_acknowledgement_required')
        return False
    def scope(self, enabled=None):
        host = self.host; saved = self.sql_ack; before = self.before
        actual_enabled = self.logins_enabled()
        need(enabled is None or enabled is actual_enabled, 'reader_LOGIN_phase_must_match_actual_owned_acknowledgements')
        enabled = actual_enabled
        # Validate the entire original transaction/receipt chain, independently
        # of the old whole-graph validator's intentionally stale LOGIN flags.
        need(saved['operatorSha256'] == CACHE_SHA and saved['bootId'] == boot() and saved['reviewHash'] == before['reviewHash'] and
             saved['commitIntentSha256'] == sha(protected(self.cache.BASE / 'sql-intent.json')) and
             saved['preparedSha256'] == sha(protected(self.cache.BASE / 'sql-prepared.json')) and
             saved['xid'] == document(self.cache.BASE / 'sql-prepared.json')['xid'] and
             saved['readAdmissionSha256'] == self.prepared['config']['readAdmissionSha256'], 'exact_owned_four_cache_READ_commit_chain_required')
        current = self.catalog(); acknowledged = saved['postProof']['catalog']
        exact_login_catalog(acknowledged, current, enabled)
        complete_cache_acl_baseline(acknowledged, current)
        guard = self.guard_scope(True)
        self.columns_current()
        current_reader, _ = host.read.reader_catalog(host.h)
        need(current_reader == saved['postProof']['reader'], 'collector_full_acknowledged_graph_must_stay_exact_through_reader_LOGIN')
        combined = self.cache.extended_plan(host.plan, saved['result'])
        derived = {**host.read_rehearsal, 'readerAfter': current_reader}
        binding, preservation = host.read.acknowledged_source_binding(host.r, host.s, host.h, host.source_op,
            host.source_ack, combined, host.read_before, derived)
        need(binding == host.read_before['sourceBinding'], 'same_accepted_source_profile_actors_native_OIDs_build_and_YPAL_required')
        return {'format': FORMAT, 'validated': True, 'sourceManifestSha256': self.inputs['sourceManifestSha256'],
                'readAdmissionSha256': self.prepared['config']['readAdmissionSha256'],
                'cachePreparedSha256': self.inputs['cachePreparedSha256'], 'catalogSha256': sha(encoded(current)),
                'readerCatalogSha256': sha(encoded(current_reader)), 'sourceBinding': binding, 'preservation': preservation,
                'apiLoginsEnabled': enabled, 'cacheGuard': guard, 'original143WholeValidatorPassed': False, 'originalCacheWholeValidatorPassed': False,
                'databaseWrites': 0, 'serviceActions': 0}
    def inverse_scope(self, cache_reads=True):
        """Inverse authority only: exact static/actor/OID proofs, no readiness.

        No source state is normalized or substituted into a forward binding.
        This remains usable if precisely the acknowledged combined actor died.
        """
        host = self.host; read = host.read; enabled = self.logins_enabled()
        expected = self.sql_ack['postProof']['catalog'] if cache_reads else host.read_rehearsal['after']
        actual = self.catalog()
        expected = copy.deepcopy(expected)
        if enabled:
            expected, _ = login_postcatalog(expected)
        need(read.acl_catalog(actual) == read.acl_catalog(expected), 'exact_inverse_phase_full_role_relation_column_and_foreign_ACL_graph_required')
        guard = self.guard_scope(cache_reads)
        self.columns_current()
        reader, _ = read.reader_catalog(host.h)
        expected_reader = self.sql_ack['postProof']['reader'] if cache_reads else host.read_rehearsal['readerAfter']
        need(reader == expected_reader, 'same_exact_inverse_phase_collector_graph_required')
        plan = self.cache.extended_plan(host.plan, self.sql_ack['result']) if cache_reads else host.plan
        namespace = read.retained_namespace(host.h, plan, host.read_before['readerBefore'], reader)
        retained = namespace['retained'](host.h.m)
        read.compare_retained(retained, host.source_op['retained'], sha(encoded(host.read_before['readerBefore'])), sha(encoded(reader)))
        s, h, op, ack = host.s, host.h, host.source_op, host.source_ack
        need(not (s.BASE / 'inverse-intent.json').exists(), 'combined_source_inverse_must_follow_reader_global_inverse')
        s.static_inputs(h); s.old_private_inputs(op)
        need(s.base_code() == op['sourceCode'] and h.role() == op['sourceRole'], 'same_source_code_profile_writer_role_and_private_inputs_required')
        h.old_terminal(op); h.preserved_old_native(op); s.exact_link(s.NEW_LINK, ack['newBoot'])
        native = h.native()
        need(native['schemaOid'] == ack['native']['schemaOid'] and native['tables'] == ack['native']['tables'] and
             native['app']['build_id'] == s.BUILD and str(native['app']['is_dev']) == '0', 'same_actual_native_build_and_all_table_OIDs_for_inverse_required')
        state = h.state(s.NEW)
        need(state['FragmentPath'] == str(s.UNIT) and not state['DropInPaths'] and h.files(state) == {str(s.UNIT): s.TEMPLATE_SHA} and
             state['MemoryMax'] == '6442450944' and state['RuntimeMaxUSec'] == 'infinity', 'same_owned_combined_source_loaded_definition_required')
        if state['MainPID'] == '0':
            need(state['ControlPID'] == '0' and state['Job'] in {'', '0'} and state['ActiveState'] in {'inactive', 'failed'}, 'exact_terminal_combined_source_state_required')
            group = Path('/sys/fs/cgroup/system.slice') / s.NEW / 'cgroup.procs'
            need(not group.exists() or not group.read_text().split(), 'terminal_combined_source_cgroup_must_be_empty')
            for old in ack['source']['processes']:
                try: now = process(old['pid'])
                except (FileNotFoundError, ProcessLookupError): continue
                need(now['startTicks'] != old['startTicks'], 'acknowledged_terminal_combined_source_process_still_exists')
            source_state = 'acknowledged_actor_terminal'
        else:
            need(s.new_owned(h, op) == ack['source'], 'same_owned_combined_source_actor_without_replacement_required_for_inverse')
            source_state = 'same_acknowledged_actor'
        # Inverse needs owned proxy identity, not a successful HTTP/RPC gate.
        a = h.m.route_owner; before = h.m.load('before.json'); b = before['binding']
        need(b['inputs'] == h.rpc.inputs(h.m, a) and before['reviewHash'] == sha(encoded({'binding': b, 'catalog': before['catalog']})),
             'same_acknowledged_free_proxy_inputs_and_review_required')
        a.exact_catalog(h.m, a.catalog(h.m), before['catalog'], True)
        routes = document(a.BASE / 'result.json', ack['rpcResultSha256'])
        need(routes['completed'] is True and routes['operatorSha256'] == sha(protected(a.__file__)) and routes['bootId'] == boot() and
             not (a.BASE / 'restore-intent.json').exists(), 'same_unrestored_free_proxy_receipt_required')
        for chain in a.CHAINS:
            now = h.rpc.owned_stop_identity(h.m, a, chain, before)
            need(now['actor'] == routes['routes'][chain]['actor'], 'same_owned_free_proxy_actor_required_for_inverse')
            h.m.check_published(chain + '-boot')
        return {'format': FORMAT, 'validated': True, 'inverseOnly': True, 'ready': False, 'sourceState': source_state,
            'sourceManifestSha256': self.inputs['sourceManifestSha256'], 'catalogSha256': sha(encoded(actual)),
            'readAdmissionSha256': self.prepared['config']['readAdmissionSha256'], 'ownedCacheReadsPresent': cache_reads,
            'apiLoginsEnabled': enabled, 'sourceCoverageQualified': False, 'original143WholeValidatorPassed': False,
            'cacheGuard': guard,
            'databaseWrites': 0, 'serviceActions': 0}
    def generation(self):
        generation = module('ypal-native-generation-v1.py', DEPENDENCIES['ypal-native-generation-v1.py'])
        candidate = document(generation.BASE / 'candidate-result.json', self.prepared['config']['generationSha256'])
        need(candidate['operatorSha256'] == DEPENDENCIES['ypal-native-generation-v1.py'] and candidate['completed'] is True and
             candidate['built'] is True and candidate['validated'] is True and candidate['published'] is False and
             candidate['sourceRelease'] == RELEASE and candidate['readIdentity'] == IDENTITY and
             candidate['predecessorGenerationId'] == '103', 'exact_built_unpublished_generation_lineage_required')
        op = document(generation.BASE / 'operation.json', candidate['operationSha256'])
        need(op['format'] == generation.FORMAT and op['operatorSha256'] == candidate['operatorSha256'] and
             op['bootId'] == boot() and op['candidateSha256'] == self.cache.CANDIDATE_SHA and
             op['readAdmissionSha256'] == self.prepared['config']['readAdmissionSha256'], 'same_owned_generation_operation_required')
        capsule = document(generation.BASE / 'capsule-result.json', candidate['capsuleResultSha256'])
        return generation, candidate, op, capsule
    def metadata(self):
        _, candidate, _, _ = self.generation()
        selection = document(self.cache.META / 'selected.json', self.prepared['config']['metadataSelectionSha256'])
        return self.host.metadata_current(candidate, selection)
    def metadata_inverse_context(self):
        owner = module(self.cache.META_OWNER.name, self.cache.META_OWNER_SHA); outer = self
        _, candidate, _, _ = self.generation()
        class InverseMetadataContext(owner.Host):
            def __init__(self):
                self.meta = module(owner.META_FILE.name, owner.META_SHA)
                self.s, self.h, self.m, self.installer, self.reader, self.source_op, self.source, self.created = self.meta.load(self.meta.READ_RESULT_SHA)
                self.admission_pin = outer.prepared['config']['readAdmissionSha256']
                self.candidate = document(owner.CANDIDATES / 'result.json', owner.CANDIDATE_SHA)
                need(self.candidate['staged'] is True and self.candidate['selected'] is False and self.candidate['adopted'] is False and
                     self.candidate['readviewResultSha256'] == self.meta.READ_RESULT_SHA, 'same_fixed_staged_metadata_context_for_inverse_required')
            def refresh(self):
                proof = outer.inverse_scope(False)
                for name, pin in self.candidate['files'].items():
                    need(sha(protected(owner.CANDIDATES / name)) == pin, 'same_original_native_metadata_candidate_and_private_files_required')
                return proof
            def terminal(self, op, actor, sessions=None):
                # Other clients may legitimately reconnect to role16388. The
                # inverse owns only fresh kernel-attributed metadata backends.
                value = owner.state(self.m)
                if sessions is None:
                    native = os.path.lexists(owner.DROP)
                    if native:
                        selected = document(owner.BASE / 'selected.json', outer.prepared['config']['metadataSelectionSha256'])
                        actor = selected['nativeActor']
                        need(owner.file_identity(owner.DROP) == document(owner.BASE / 'native-drop-created.json') and
                             sha(protected(owner.DROP)) == op['candidateDropSha256'], 'same_owned_failed_native_metadata_overlay_required')
                    else: actor = op['oldActor']
                    need(value['InvocationID'] == actor['unit']['InvocationID'] and owner.loaded(self, op, native, False),
                         'same_acknowledged_terminal_metadata_invocation_and_configuration_required')
                    sessions = outer.terminal_sessions(actor, '16388')
                need('owned' in sessions, 'fresh_owned_metadata_session_subset_before_inverse_required')
                need(value['MainPID'] == value['ControlPID'] == '0' and value['Job'] == '' and value['ActiveState'] in {'inactive', 'failed'},
                     'metadata_unit_must_be_terminal_for_inverse')
                group = Path('/sys/fs/cgroup/system.slice') / owner.UNIT / 'cgroup.procs'
                need(not group.exists() or not group.read_text().split(), 'metadata_inverse_cgroup_must_be_empty')
                need(not any(owner.identity_alive(self.m, p) for p in actor['processes']), 'all_owned_metadata_processes_must_be_gone')
                rows = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16388 AND datid=17584")
                need(not any(v['pid'] == old['pid'] and v['backendStart'] == old['backendStart'] for v in rows for old in sessions['owned']),
                     'fresh_owned_metadata_backend_subset_must_be_drained')
                self.private(op['oldWriter']); self.refresh(); return value
        context = InverseMetadataContext(); operation = owner.operation(context, candidate['metadataOperationSha256'])
        need(operation['admissionSha256'] == self.prepared['config']['readAdmissionSha256'], 'same_metadata_operation_and_actual_READ_ACK_required')
        return owner, context, operation
    def metadata_comparison(self):
        producer = module('metadata-fixed-parity-v4.py', METADATA_FIXED_PRODUCER)
        value = document(METADATA_FIXED, METADATA_FIXED_SHA)
        return validate_metadata_fixed(value, producer)
    def unpublished_candidate(self):
        generation, candidate, _, _ = self.generation()
        value = generation.validate_candidate_database_current(self.prepared['config']['generationSha256'])
        need(value['validated'] is True and value['receiptSha256'] == self.prepared['config']['generationSha256'] and
             value['generationId'] == candidate['generationId'] and value['globalContextUnchanged'] is True and value['published'] is False and
             all(value[key] is False for key in ('sourceReadinessQualified', 'metadataCurrentReadinessQualified', 'readAdmissionGraphQualified', 'cacheActorQualified')),
             'actual_unpublished_candidate_leaf_only_not_runtime_readiness_required')
        return value
    def native_ready(self):
        rows = self.query("SELECT jsonb_agg(jsonb_build_object('collection',c,'ready',coalesce((" + READ + ".source_probe(c)->>'ready')::boolean,false))ORDER BY c)FROM unnest(ARRAY['ethereum','base','polygon','bnb'])c")
        need(rows == [{'collection': c, 'ready': True} for c in ['base', 'bnb', 'ethereum', 'polygon']], 'actual_all_four_native_source_witnesses_required')
        return {'allFourNativeWitnessesReady': True, 'sourceSelectionWritten': False}
    def generation_terminal(self):
        generation, candidate, op, _ = self.generation(); m = self.host.m
        rows = {}
        for name in (generation.LEADER, generation.UNIT):
            keys = ('Id', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'Job')
            raw = m.run(['/usr/bin/systemctl', 'show', '--all', name, *['--property=' + k for k in keys]])
            state = dict(line.split('=', 1) for line in raw.decode().splitlines())
            need(set(state) == set(keys) and state['Id'] == name, 'complete_owned_generation_terminal_state_required')
            rows[name] = terminal(state, op['oldActor']['processes'] if name == generation.LEADER else ())
        # Use the accepted metadata helper's exact inode representation without
        # invoking its now-stale whole consumer observation.
        metadata_owner = module(self.cache.META_OWNER.name, self.cache.META_OWNER_SHA)
        need(not os.path.lexists(generation.BOOT) and metadata_owner.link(generation.BASE / 'original-boot-link') == op['oldBoot'],
             'recurring_generation_boot_must_stay_owned_and_disabled')
        return {'candidateOperationSha256': candidate['operationSha256'], 'units': rows, 'recurringGenerationStarted': False}
    def business_environment(self, recorded_public_inline=None):
        generation, _, op, _ = self.generation(); old = op['oldActor']['writer']; m = self.host.m
        inline = m.service_property(generation.LEADER, 'Environment') if recorded_public_inline is None else recorded_public_inline
        if recorded_public_inline is None:
            need(sha(encoded(inline)) == old['inlineEnvironmentSha256'] and
                 not any(m.service_property(generation.LEADER, key) for key in ('PassEnvironment', 'UnsetEnvironment')),
                 'retained_generation_inline_private_context_required')
        else:
            need(isinstance(inline, list) and all(isinstance(v, str) and not re.search('PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL', v.partition('=')[0]) and
                 '://' not in v for v in inline), 'only_authenticated_recorded_public_inline_assignments_may_survive_unit_retirement')
        env = {}
        for assignment in inline:
            key, sep, value = assignment.partition('='); need(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key), 'literal_generation_environment_required')
            env[key] = value
        selectors = m.ordered_files(old['state']['EnvironmentFiles'])
        need(selectors == [(p, False) for p in m.ENV_FILES[generation.LEADER]], 'same_retained_generation_private_file_order_required')
        for name, _ in selectors:
            raw = m.protected(name); need(sha(raw) == old['environmentFileHashes'][name], 'same_retained_generation_private_input_required')
            env.update(m.parse_env(raw))
        # The original effective environment hash proves omitted sensitive
        # inline keys were overwritten by retained private files; no credential
        # is copied into the new operation record or public source.
        need(sha(encoded(env)) == old['configuredEnvironmentSha256'], 'same_original_generation_private_configuration_required')
        url = urlsplit(env['DATABASE_URL'])
        need(url.scheme in {'postgres', 'postgresql'} and unquote(url.username or '') == 'yunipals' and
             url.hostname in {'localhost', '127.0.0.1', '::1'} and (url.port or 5432) == 5432 and unquote(url.path[1:]) == 'yunipals_backfill',
             'unchanged_local_snapshot_database_role_and_endpoint_required')
        name = 'yunipals-leaderboard.selectors.env'; raw = m.protected(self.cache.CANDIDATES / name)
        need(sha(raw) == self.host.candidate['files'][name], 'same_reviewed_native_generation_public_selectors_required')
        selectors = m.parse_env(raw)
        need(selectors['OWNERSHIP_RELEASE_ID'] == RELEASE and selectors['OWNERSHIP_READ_SCHEMA'] == READ and
             selectors['DATABASE_SCHEMA'] == PHYSICAL and 'DATABASE_URL' not in selectors, 'public_native_selector_identity_without_credentials_required')
        return {'DATABASE_URL': env['DATABASE_URL'], **selectors, 'OFFCHAIN_DB_POOL_MAX': '1', 'API_DB_POOL_MAX': '1',
                'PROJECTION_STORAGE_PATH': '/', 'PROJECTION_MIN_FREE_BYTES': '25000000000', 'PROJECTION_BACKUP_PEAK_BYTES': '0'}
    def state(self, unit):
        need(unit in {p['unit'] for p in PEERS.values()} or unit in {preview_unit(name) for name in PEERS}, 'fixed_coordinated_reader_unit_required')
        raw = self.host.m.run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in STATE_PROPERTIES]])
        result = {}
        for line in raw.decode().splitlines():
            key, sep, value = line.partition('='); need(sep and key in STATE_PROPERTIES, 'fixed_reader_manager_property_required')
            if key == 'EnvironmentFiles': result.setdefault(key, []).append(value)
            else: need(key not in result, 'unique_reader_manager_property_required'); result[key] = value
        absent = unit in {preview_unit(name) for name in PEERS} and all(result.get(k) == v for k, v in {
            'Id': unit, 'LoadState': 'not-found', 'ActiveState': 'inactive', 'SubState': 'dead', 'MainPID': '0', 'ControlPID': '0',
            'Job': '', 'FragmentPath': '', 'DropInPaths': ''}.items())
        # systemctl omits empty execution arrays for an unloaded unit. Never
        # normalize a loaded service or a missing identity/state property.
        if absent:
            for key in ('ExecStart', 'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecReload'):
                result.setdefault(key, '')
            result.setdefault('EnvironmentFiles', [])
        need(set(result) == set(STATE_PROPERTIES) and result['Id'] == unit, 'complete_reader_manager_state_required')
        return result
    def reader(self, name, expected=None, preview=False):
        peer = PEERS[name]; unit = preview_unit(name) if preview else peer['unit']; m = self.host.m
        first = self.state(unit)
        need(first['LoadState'] == 'loaded' and first['ActiveState'] == 'active' and first['SubState'] == 'running' and
             first['ControlPID'] == '0' and first['Job'] == '' and first['ControlGroup'] == '/system.slice/' + unit and
             re.fullmatch('[1-9][0-9]*', first['MainPID']) and re.fullmatch('[0-9a-f]{32}', first['InvocationID']), 'actual_stable_reader_actor_required')
        pid = int(first['MainPID']); main = process(pid)
        definitions = {p: sha(m.protected(p)) for p in [first['FragmentPath'], *first['DropInPaths'].split()]}
        names = m.ordered_files(first['EnvironmentFiles']); merged = {}
        inline = m.service_property(unit, 'Environment')
        need(not any(m.service_property(unit, key) for key in ('PassEnvironment', 'UnsetEnvironment')), 'explicit_reader_environment_only_required')
        for item in inline:
            key, sep, value = item.partition('='); need(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key), 'literal_reader_inline_assignment_required'); merged[key] = value
        private = {}
        for path, optional in names:
            if optional and not os.path.lexists(path): private[path] = None; continue
            raw = m.protected(path); private[path] = sha(raw); merged.update(m.parse_env(raw))
        actual = m.process_env(str(pid))
        need(all(actual.get(key) == merged.get(key) for key in set(merged) | set(m.RECOVERY_KEYS)), 'reader_actual_environment_must_match_effective_private_and_public_files')
        argv_raw = (Path('/proc') / str(pid) / 'cmdline').read_bytes(); argv = argv_raw.rstrip(b'\0').decode().split('\0')
        if expected is None:
            suffix = peer['entry'].removeprefix('apps/yunipals-indexer/')
            need(len(argv) == 4 and argv[:3] == [NODE, '--import', 'tsx'] and
                 argv[3].startswith('/opt/') and argv[3].endswith('/' + suffix) and
                 re.fullmatch('/[A-Za-z0-9_./-]+', argv[3]), 'known_original_reader_command_without_private_arguments_required')
        group = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.procs'
        pids = sorted(int(v) for v in group.read_text().split()); need(pid in pids and 1 <= len(pids) <= 8, 'bounded_owned_reader_cgroup_required')
        children = []
        for member in pids:
            actor = process(member); status = proc_status(member)
            children.append({**actor, 'uid': status['uid'], 'gid': status['gid'], 'groups': status['groups'],
                'capabilities': status['capabilities'], 'noNewPrivileges': status['noNewPrivileges'],
                'commandSha256': sha((Path('/proc') / str(member) / 'cmdline').read_bytes()),
                'executable': os.readlink('/proc/' + str(member) + '/exe')})
        result = {'unit': first, 'main': main, 'processes': children, 'definitions': definitions, 'privateInputHashes': private,
                  'inlineEnvironmentSha256': sha(encoded(inline)), 'effectiveEnvironmentSha256': sha(encoded(merged)),
                  'argv': argv, 'argvSha256': sha(argv_raw)}
        if expected is not None:
            need(definitions == expected['definitions'] and private == expected['privateInputHashes'] and
                 result['inlineEnvironmentSha256'] == expected['inlineEnvironmentSha256'] and argv == expected['argv'] and
                 first['WorkingDirectory'] == expected['cwd'] and first['User'] == first['Group'] == peer['role'] and first['NRestarts'] == '0' and
                 names == [(p['path'], p['optional']) for p in expected['selectors']], 'exact_owned_reader_artifact_static_and_private_graph_required')
            need(result['effectiveEnvironmentSha256'] == expected['effectiveEnvironmentSha256'] and
                 first['Restart'] == 'no' and first['KillMode'] == 'control-group' and
                 not any(first[k] for k in ('ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecReload')),
                 'exact_no_restart_reader_configuration_and_effective_environment_required')
            user = pwd.getpwnam(peer['role'])
            need(user.pw_uid == expected['uid'] and user.pw_gid == expected['gid'] and user.pw_shell in {'/usr/sbin/nologin', '/sbin/nologin', '/bin/false'}, 'same_restricted_reader_OS_peer_identity_required')
            for actor in children:
                need(actor['uid'] == [user.pw_uid] * 4 and actor['gid'] == [user.pw_gid] * 4 and set(actor['groups']) <= {user.pw_gid} and
                     actor['capabilities'] == ['0000000000000000'] * 5 and actor['noNewPrivileges'] is True,
                     'actual_reader_peer_must_have_no_capabilities_or_extra_groups')
                if actor['pid'] != pid:
                    need(actor['parentPid'] == pid and actor['executable'] == expected['esbuildExecutable'] and
                         actor['commandSha256'] == expected['esbuildCommandSha256'], 'only_exact_owned_compiler_child_may_share_reader_cgroup')
        need(self.state(unit) == first and process(pid) == main and
             sha(encoded(m.process_env(str(pid)))) == sha(encoded(actual)), 'reader_actor_or_environment_changed_during_capture')
        return result

    def sessions(self, actor, role_oid=None):
        # Shared roles are not drained globally. Only exact kernel socket peers
        # of this acknowledged cgroup are retained, never age or appname guesses.
        need(role_oid is None or role_oid in {p['oid'] for p in PEERS.values()}, 'only_fixed_owned_reader_role_filter_allowed')
        sql = "SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE datid=17584 AND pid<>pg_backend_pid()" + ("AND usesysid=" + role_oid if role_oid else '')
        rows = self.query(sql); need(len(rows) <= 64, 'bounded_existing_reader_backend_inventory_required')
        observer = self.host.h.observer
        uids = {tuple(p['uid']) for p in actor['processes']}; gids = {tuple(p['gid']) for p in actor['processes']}
        need(len(uids) == len(gids) == 1 and all(len(set(v)) == 1 for v in uids | gids), 'one_exact_reader_cgroup_OS_identity_required')
        uid, gid = next(iter(uids))[0], next(iter(gids))[0]
        clients = observer.peer_fds([p['pid'] for p in actor['processes']], uid, gid)
        servers = observer.peer_fds([v['pid'] for v in rows], 111, 113)
        peers = observer.unix_peers(observer.run(['/usr/bin/ss', '-xHn']))
        tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()), **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
        owned = observer.map_owned_backends(clients, servers, rows, peers, tcp)
        need(self.query(sql) == rows and all(process(p['pid']) == {k: p[k] for k in ('pid', 'startTicks', 'parentPid', 'bootId')} for p in actor['processes']),
             'reader_kernel_peer_observation_changed_requires_fresh_review')
        return {'owned': owned, 'kernelPeerAttribution': True, 'globalRoleZeroRequired': False}

    def terminal_sessions(self, actor, role_oid):
        """An already-dead owned actor has no clients; refuse orphan backends.

        Every remaining role backend must have positive current kernel ownership
        by another live process. Neither role-wide zero nor an old/age-based
        backend snapshot is substituted for this proof.
        """
        need(role_oid in {'10', '16388', *[peer['oid'] for peer in PEERS.values()]}, 'fixed_inverse_terminal_role_required')
        for old in actor['processes']:
            try: now = process(old['pid'])
            except (FileNotFoundError, ProcessLookupError): continue
            need(now['startTicks'] != old['startTicks'], 'owned_terminal_actor_process_must_remain_gone')
        sql = "SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE datid=17584 AND pid<>pg_backend_pid()AND usesysid=" + role_oid
        rows = self.query(sql); need(len(rows) <= 64, 'bounded_terminal_fixed_role_backend_set_required')
        observer = self.host.h.observer
        servers = observer.peer_fds([row['pid'] for row in rows], 111, 113)
        unix = observer.run(['/usr/bin/ss', '-xHnp']); tcp_raw = observer.run(['/usr/bin/ss', '-tHnp'])
        peers = observer.unix_peers(unix); pids = residual_client_pids(unix, tcp_raw, servers, rows, peers)
        identities = {pid: process(pid) for pid in pids}; grouped = {}
        for pid in pids:
            status = proc_status(pid)
            need(len(set(status['uid'])) == len(set(status['gid'])) == 1, 'stable_residual_client_OS_identity_required')
            grouped.setdefault((status['uid'][0], status['gid'][0]), []).append(pid)
        clients = {}
        for (uid, gid), members in grouped.items(): clients.update(observer.peer_fds(members, uid, gid))
        tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()), **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
        mapped = observer.map_owned_backends(clients, servers, rows, peers, tcp)
        need({(v['pid'], v['backendStart']) for v in mapped} == {(v['pid'], v['backendStart']) for v in rows},
             'unknown_or_orphan_terminal_role_backend_requires_explicit_readonly_reconciliation')
        need(self.query(sql) == rows and all(process(pid) == identity for pid, identity in identities.items()),
             'terminal_role_or_residual_peer_changed_during_kernel_observation')
        return {'owned': [], 'otherLiveKernelPeers': mapped, 'residualClientIdentities': list(identities.values()),
                'alreadyTerminal': True, 'kernelPeerAttribution': True, 'globalRoleZeroRequired': False}

    def drained(self, name, actor, sessions, preview=False):
        terminal(self.state(preview_unit(name) if preview else PEERS[name]['unit']), actor['processes'])
        rows = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE datid=17584 AND pid<>pg_backend_pid()")
        need(not any(r['pid'] == old['pid'] and r['backendStart'] == old['backendStart'] for r in rows for old in sessions['owned']),
             'only_exact_owned_reader_backend_PID_start_subset_must_be_drained')
        return {'terminal': True, 'ownedSessionsDrained': True, 'globalRoleZeroRequired': False}

    def capacity(self, name):
        oid = PEERS[name]['oid']
        row = self.query("SELECT jsonb_build_object('limit',rolconnlimit,'sessions',(SELECT count(*)FROM pg_stat_activity WHERE usesysid=" + oid + "),'max',current_setting('max_connections')::integer,'reserved',current_setting('superuser_reserved_connections')::integer,'total',(SELECT count(*)FROM pg_stat_activity))FROM pg_roles WHERE oid=" + oid)
        need(row['limit'] == 6 and row['sessions'] <= 3 and row['total'] + 3 <= row['max'] - row['reserved'],
             'fresh_role_and_global_headroom_for_one_pool_two_plus_probe_required')
        return {'roleOid': oid, 'observedSessions': row['sessions'], 'roleLimit': 6, 'candidatePoolMaximum': 2, 'inspectionMaximum': 1,
                'globalFreeObserved': row['max'] - row['reserved'] - row['total']}

    def loaded_descriptor(self, descriptor):
        state = self.state(descriptor['unit']); expected = descriptor['expected']; m = self.host.m
        need(state['LoadState'] == 'loaded' and state['Job'] == '' and state['ControlPID'] == '0' and
             {path: sha(m.protected(path)) for path in [state['FragmentPath'], *state['DropInPaths'].split()]} == expected['definitions'] and
             m.ordered_files(state['EnvironmentFiles']) == [(r['path'], r['optional']) for r in expected['selectors']] and
             state['WorkingDirectory'] == expected['cwd'] and state['User'] == state['Group'] == PEERS[descriptor['name']]['role'] and
             re.findall(r'argv\[\]=(.*?)\s+;', state['ExecStart']) == [' '.join(expected['argv'])] and
             state['Restart'] == 'no' and state['KillMode'] == 'control-group' and
             not any(state[k] for k in ('ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecReload', 'RequiredBy', 'TriggeredBy', 'Triggers', 'PartOf', 'UpheldBy')),
             'exact_owned_loaded_reader_definition_and_activation_graph_required')
        need(sha(encoded(m.service_property(descriptor['unit'], 'Environment'))) == expected['inlineEnvironmentSha256'] and
             not any(m.service_property(descriptor['unit'], k) for k in ('PassEnvironment', 'UnsetEnvironment')),
             'same_owned_reader_inline_environment_required')
        for path, pin in expected['privateInputHashes'].items():
            need(not os.path.lexists(path) if pin is None else sha(m.protected(path)) == pin, 'owned_reader_private_input_drift')
        return state

    def listener(self, descriptor, actor):
        raw = self.host.m.run(['/usr/bin/ss', '-Hlnpt', 'sport = :' + str(descriptor['port'])])
        lines = raw.decode().splitlines(); need(len(lines) == 1, 'exact_one_owned_loopback_reader_listener_required')
        columns = lines[0].split(); pids = {int(v) for v in re.findall(r'pid=([1-9][0-9]*)', lines[0])}
        need(len(columns) >= 5 and columns[3] in {'127.0.0.1:' + str(descriptor['port']), '[::1]:' + str(descriptor['port'])} and
             pids == {actor['main']['pid']}, 'reader_HTTP_listener_must_belong_to_the_acknowledged_main_PID_only')
        return True


def preview_unit(name):
    need(name in PEERS, 'one_of_three_reader_names_required')
    return 'yunipals-ypal-native-preview-v1-' + name + '.service'


def systemd_word(value):
    need(isinstance(value, str) and not any(ord(c) < 32 for c in value), 'single_line_systemd_literal_required')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def render_reader(context, name, original, preview=False):
    """New exact scope: retained private inputs, native selectors and same APIs.

    Preview networking is local-only; final units retain their existing network
    sandbox. No private value is copied to a new public definition.
    """
    peer = PEERS[name]; m = context.host.m; original_unit = peer['unit']
    unit = preview_unit(name) if preview else original_unit
    paths = [original['unit']['FragmentPath'], *original['unit']['DropInPaths'].split()]
    need(original['definitions'] == {p: sha(m.protected(p)) for p in paths} and
         not any(original['unit'][k] for k in ('ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecReload')),
         'reader_base_definitions_must_be_exact_and_have_no_auxiliary_commands')
    directory = Path('/etc/yunipals-unified/consumers')
    prefix = 'ypal-native-cutover-v1-' + name + ('-preview' if preview else '')
    database_path, public_path = directory / (prefix + '.database.env'), directory / (prefix + '.selectors.env')
    unit_path = Path('/run/systemd/system') / (unit if preview else original_unit + '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-native-v1.conf')
    if not preview:
        unit_path = Path('/etc/systemd/system') / (original_unit + '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-native-v1.conf')
        need(all(Path(p).parent == unit_path.parent and Path(p).name < unit_path.name for p in paths[1:]),
             'owned_final_dropin_must_follow_all_retained_dropins')
    names = m.ordered_files(original['unit']['EnvironmentFiles'])
    merged = {}; inline = m.service_property(original_unit, 'Environment')
    need(sha(encoded(inline)) == original['inlineEnvironmentSha256'], 'same_original_inline_environment_required')
    for item in inline:
        key, sep, value = item.partition('=')
        need(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key) and
             not re.search('PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL', key) and '://' not in value,
             'only_existing_public_inline_assignments_may_be_copied_to_preview_unit')
        merged[key] = value
    for path, optional in names:
        need(re.fullmatch('/[A-Za-z0-9_./-]+', path) and '..' not in Path(path).parts, 'literal_private_selector_path_required')
        if optional and original['privateInputHashes'][path] is None:
            need(not os.path.lexists(path), 'absent_optional_private_input_must_remain_absent'); continue
        raw = m.protected(path); need(sha(raw) == original['privateInputHashes'][path], 'original_private_input_changed')
        merged.update(m.parse_env(raw))
    need(sha(encoded(merged)) == original['effectiveEnvironmentSha256'], 'same_original_effective_reader_environment_required')
    selectors = {'DATABASE_SCHEMA': PHYSICAL, 'READ_DATABASE_SCHEMA': READ, 'OWNERSHIP_READ_MODE': 'unified',
        'OWNERSHIP_READ_SCHEMA': READ, 'OWNERSHIP_RELEASE_ID': RELEASE, 'UNIFIED_INDEXER_RELEASE_ID': RELEASE,
        'BASE_METADATA_INGESTION': 'native', 'METADATA_SOURCE_MODE': 'archive', 'YUNIPALS_PROJECTION_MODE': 'generation',
        # Two existing pool constructors, each max1. Collector therefore fits
        # retained feature API2 + artwork queue1 + candidate2 + inspection1=6.
        'OFFCHAIN_DB_POOL_MAX': '1', 'API_DB_POOL_MAX': '1', 'API_HOST': '127.0.0.1',
        'COLLECTOR_API_PORT' if name == 'collector' else 'API_PORT': str(peer['previewPort'] if preview else peer['port'])}
    if name == 'islands': need(merged.get('API_ISLAND_STAKING_ENABLED') == 'true', 'enabled_Islands_staking_must_be_retained')
    params = {'host': '/var/run/postgresql', 'port': '5432', 'user': peer['role']}
    if preview: params['options'] = '-c default_transaction_read_only=on'
    database = {'DATABASE_URL': 'postgresql:///yunipals_backfill?' + urlencode(params)}
    raw_database, raw_public = m.env_bytes(database), m.env_bytes(selectors)
    argv = [NODE, str(context.main.TARGET / 'dist/main-api.mjs')] if name == 'main' else [NODE, '--import', 'tsx', str(m.ROOT / peer['entry'])]
    user = pwd.getpwnam(peer['role'])
    need(user.pw_uid > 0 and user.pw_gid > 0 and os.getgrouplist(peer['role'], user.pw_gid) == [user.pw_gid] and
         user.pw_shell in {'/usr/sbin/nologin', '/sbin/nologin', '/bin/false'}, 'restricted_existing_matching_OS_peer_required')
    new_names = [*names, (str(database_path), False), (str(public_path), False)]
    common = ('[Service]\nUser=' + peer['role'] + '\nGroup=' + peer['role'] + '\nSupplementaryGroups=\n'
        'WorkingDirectory=' + str(m.PROJECT) + '\nEnvironmentFile=\n' +
        ''.join('EnvironmentFile=' + ('-' if optional else '') + path + '\n' for path, optional in new_names) +
        'PassEnvironment=\nUnsetEnvironment=\nExecStart=\nExecStart=' + ' '.join(argv) + '\n'
        'ExecStartPre=\nExecStartPost=\nExecStop=\nExecStopPost=\nExecReload=\nRestart=no\n'
        'NoNewPrivileges=yes\nCapabilityBoundingSet=\nAmbientCapabilities=\nKillMode=control-group\nTimeoutStopSec=45\nUMask=0077\n')
    if preview:
        common = ('[Unit]\nDescription=Owned native reader preview v1 ' + name + '\n' + common +
            'Type=simple\nRuntimeMaxSec=120\nMemoryMax=805306368\nMemorySwapMax=0\nCPUQuota=100%\nTasksMax=64\n'
            'ProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nRestrictSUIDSGID=yes\n'
            'IPAddressDeny=any\nIPAddressAllow=127.0.0.0/8 ::1\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n' +
            ''.join('Environment=' + systemd_word(value) + '\n' for value in inline))
    merged.update(database); merged.update(selectors)
    files = {str(database_path): {'text': raw_database.decode(), 'mode': 0o600},
             str(public_path): {'text': raw_public.decode(), 'mode': 0o644}, str(unit_path): {'text': common, 'mode': 0o644}}
    expected_defs = {str(unit_path): sha(common.encode())} if preview else {**original['definitions'], str(unit_path): sha(common.encode())}
    esbuild = m.PROJECT / 'node_modules/@esbuild/linux-x64/bin/esbuild'
    # Exact optional tsx compiler process, never a generic same-UID allowance.
    executable = str(esbuild.resolve(strict=True))
    command = [executable, '--service=0.25.12', '--ping']
    esbuild_version = json.loads(m.protected(m.PROJECT / 'node_modules/esbuild/package.json'))['version']
    command[1] = '--service=' + esbuild_version
    return {'name': name, 'unit': unit, 'preview': preview, 'port': peer['previewPort'] if preview else peer['port'], 'files': files,
        'expected': {'definitions': expected_defs, 'privateInputHashes': {**original['privateInputHashes'],
            str(database_path): sha(raw_database), str(public_path): sha(raw_public)}, 'inlineEnvironmentSha256': original['inlineEnvironmentSha256'],
            'effectiveEnvironmentSha256': sha(encoded(merged)), 'argv': argv, 'cwd': str(m.PROJECT), 'uid': user.pw_uid, 'gid': user.pw_gid,
            'selectors': [{'path': path, 'optional': optional} for path, optional in new_names],
            'esbuildExecutable': executable, 'esbuildCommandSha256': sha(b'\0'.join(s.encode() for s in command) + b'\0')}}


def proc_status(pid):
    rows = dict(line.split(':', 1) for line in (Path('/proc') / str(pid) / 'status').read_text().splitlines() if ':' in line)
    return {'uid': [int(v) for v in rows['Uid'].split()], 'gid': [int(v) for v in rows['Gid'].split()],
            'groups': [int(v) for v in rows['Groups'].split()],
            'capabilities': [rows[k].strip() for k in ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb')],
            'noNewPrivileges': rows['NoNewPrivs'].strip() == '1'}
