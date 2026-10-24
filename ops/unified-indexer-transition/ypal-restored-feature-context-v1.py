#!/usr/bin/env python3
"""Explicit restored feature construction and temporary-writer lifecycle leaves.

Construction proves immutable ancestry and query primitives only. Source checks
belong to combined(); feature leaves never recursively validate the reader leaf.
"""
import copy
import json
import os
from pathlib import Path
import re
import shlex
import stat
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
DEPENDENCIES = {
 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4',
 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932',
 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4',
 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9',
 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003',
 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28',
 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb'
}
CONFIG = {'readAdmissionSha256', 'readPlanSha256', 'readContextInputSha256', 'cachePreparedSha256',
          'cacheInputsSha256', 'readerResultSha256', 'readerManifestSha256'}
READER_BASE = Path('/var/backups/yunipals-ypal-native-cutover-v2-20261024')
SOURCE_BASE = Path('/var/backups/yunipals-ypal-source-start-v1-20261023')
SOURCE_UNIT_SHA = 'f8feeea70910943737605a88a06534993e82f5a92bec1b9fbe5188f8f65eae7e'
RPC_ACK = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'


def need(value, code):
    if not value: raise RuntimeError(code)


def signature(row):
    return {k: row[k] for k in ['argv', 'cwd', 'executable', 'uid', 'gid', 'groups', 'noNewPrivileges',
                               'capabilitySetSha256', 'startupInjectionAbsent', 'parentPrivateValuesAbsent', 'cgroup']}


def peer_program(sdk):
    end = 'print(json.dumps(row,sort_keys=True))'
    need(sdk.PEER.count(end) == 1, 'single_authenticated_SDK_peer_output_required')
    # These two systemd-generated values change at a legitimate owned restart.
    # All other values (including private values) remain compared as a hash.
    extra = """row['normalizedEnvironmentSha256']=hashlib.sha256(json.dumps(sorted((k.hex(),val.hex())for k,val in env.items()if k not in {b'INVOCATION_ID',b'JOURNAL_STREAM'}),separators=(',',':')).encode()).hexdigest()
row['invocationEnvironmentMatched']=env.get(b'INVOCATION_ID') in {None,v['invocation'].encode()}
assert b'JOURNAL_STREAM'not in env or __import__('re').fullmatch(rb'[0-9]+:[0-9]+',env[b'JOURNAL_STREAM'])
"""
    return sdk.PEER.replace(end, extra + end)


def source_actor_checks(actor, original, expected=None):
    """Same programs/privileges; an owned restart has its own PID/invocation."""
    main, rows = actor['parent'], actor['processes']; old = original['sdkActor'] if 'sdkActor' in original else original
    need(len(rows) == len(old['processes']) == 2 and main['pid'] == int(actor['unit']['MainPID']) and
         len({r['pid'] for r in rows}) == 2, 'one_Node_and_direct_original_esbuild_required')
    other = next(r for r in rows if r['pid'] != main['pid']); compiler = next(r for r in old['processes'] if r['pid'] != old['parent']['pid'])
    need(other['parentPid'] == main['pid'] and signature(main) == signature(old['parent']) and signature(other) == signature(compiler),
         'exact_retained_fresh_programs_groups_capabilities_and_direct_child_required')
    need(all(r['uid'] == 970 and r['gid'] == 964 and r['groups'] == [964] and r['noNewPrivileges'] is True and
             r['invocationEnvironmentMatched'] is True for r in rows), 'same_private_fresh_worker_identity_required')
    if 'sdkActor' in original:
        for current, prior in [(main, old['parent']), (other, compiler)]:
            need(current['normalizedEnvironmentSha256'] == prior['normalizedEnvironmentSha256'], 'unchanged_private_environment_across_owned_fresh_restart_required')
    if expected is not None:
        need(actor == expected, 'same_exact_acknowledged_temporary_source_epoch_required')
    return actor


def initialize(h, b, manifest_pin, input_pin, canonical_ref, capture_id):
    h.b = b; h.manifest = b.document(b.MANIFEST, manifest_pin)
    files = {'ypal-restored-feature-handover-v1.py', 'ypal-restored-feature-context-v1.py'}
    need(set(h.manifest) == {'format', 'files', 'dependencies'} and h.manifest['format'] == 'yunipals-ypal-restored-feature-code-v1' and
         set(h.manifest['files']) == files and h.manifest['dependencies'] == {**DEPENDENCIES, 'ypal-feature-handover-v1.py':
             'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e'} and
         h.manifest['files']['ypal-restored-feature-handover-v1.py'] == b.sha(b.protected(Path(b.__file__).absolute())) and
         h.manifest['files']['ypal-restored-feature-context-v1.py'] == b.sha(b.protected(Path(__file__).absolute())),
         'exact_finite_restored_feature_manifest_required')
    h.config = b.document(b.INPUT, input_pin)
    need(set(h.config) == CONFIG and all(b.pin(v) for v in h.config.values()), 'actual_new_READ_cache_and_reader_ACK_references_required')
    h.static = b.module(OPS / 'ypal-restored-metadata-context-v1.py', DEPENDENCIES['ypal-restored-metadata-context-v1.py'])
    h.parts = h.static.query_components(); h.p = h.parts['privilegedSourcePrimitives']; h.sdk = h.p['sdk']; h.raw = h.p['host'].raw
    h.active = b.module(OPS / 'ypal-restored-read-current-context-v1.py', DEPENDENCIES['ypal-restored-read-current-context-v1.py'])
    h.provider = b.module(OPS / 'ypal-restored-read-cache-provider-v1.py', DEPENDENCIES['ypal-restored-read-cache-provider-v1.py'])
    h.read, _, h.read_host, h.read_receipt, h.read_before, h.read_rehearsal = h.provider.static_read_host(h.config)
    h.cache = h.provider.cache_runtime(); h.reader = b.load_fixed('ypal-reader-cutover-v1.py')
    h.parity = b.module(OPS / 'ypal-booster-source-parity-v1.py', DEPENDENCIES['ypal-booster-source-parity-v1.py'])
    h.h = types.SimpleNamespace(m=types.SimpleNamespace(run=h.sdk.command, protected=h.sdk.protected))
    h.old = types.SimpleNamespace(h=types.SimpleNamespace(observer=h.raw.observer))
    h.old.core = types.SimpleNamespace(run=lambda argv, timeout=30: h.sdk.command(argv, timeout=timeout).decode(),
                                      sql=lambda text: h.read_host.query(text, False))
    h.old.query = lambda text: query_one(h.read_host, text)
    h.old.request = lambda path, public=False: h.reader.Host.request(h.old, path, public)
    h.old.actor = lambda unit, values: api_actor(h, unit, values)
    h.manifest_pin, h.input_pin = manifest_pin, input_pin
    h.canonical_ref, h.capture_id = canonical_ref, capture_id
    h.inverse_mode = False; h.first_effect_deadline = None


def query_one(host, sql):
    value = host.query(sql)
    need(isinstance(value, list) and len(value) == 1, 'one_bounded_feature_SQL_value_required')
    return value[0]


def reader_ancestry(h):
    b = h.b; result = b.document(READER_BASE / 'result.json', h.config['readerResultSha256'])
    coordinator = b.module(OPS / 'ypal-native-cutover-v2.py', DEPENDENCIES['ypal-native-cutover-v2.py'])
    controller = coordinator.core(h.config['readerManifestSha256'])
    proof = controller.load_proof(h.config['readerManifestSha256'])
    # core/Proof construct only the authenticated source namespace; published()
    # authenticates immutable operation/intent/XID/packet receipts. Neither makes
    # Context, recurses into a feature leaf, opens a Pool, or checks old actors.
    op, publication, packet = controller.published(proof, result['publicationSha256'])
    need(result['format'] == 'yunipals-ypal-native-cutover-v2' and result['completed'] is result['readersCutOver'] is result['nativeGenerationPublished'] is True and
         result['operatorSha256'] == op['binding']['operatorSha256'] == DEPENDENCIES['ypal-native-cutover-v2.py'] and
         result['bootId'] == op['binding']['bootId'] == b.boot() and result['sourceManifestSha256'] == h.config['readerManifestSha256'] and
         result['operationSha256'] == b.sha(b.protected(READER_BASE / 'operation.json')) and
         op['binding']['sourceManifestSha256'] == op['binding']['inputs']['sourceManifestSha256'] == h.config['readerManifestSha256'] and
         op['reviewHash'] == b.sha(b.encoded(op['binding'])) and result['cachePreparedSha256'] == h.config['cachePreparedSha256'] and
         op['binding']['inputs']['cachePreparedSha256'] == h.config['cachePreparedSha256'] and
         op['binding']['inputs']['readPlanSha256'] == h.config['readPlanSha256'] and
         op['binding']['inputs']['readContextInputSha256'] == h.config['readContextInputSha256'] and
         op['binding']['inputs']['cacheInputsSha256'] == h.config['cacheInputsSha256'] and
         result['sourceRelease'] == proof.RELEASE and result['readIdentity'] == proof.IDENTITY and publication['published'] is True and
         result['publicationSha256'] == b.sha(b.protected(READER_BASE / 'publication/published.json')),
         'actual_new_reader_operation_publication_and_same_READ_cache_chain_required')
    return result


def cache_receipts(h):
    """Immutable143+4 collector projection, never an obsolete whole validator."""
    b = h.b; cache = h.cache
    prepared = b.document(cache.BASE / 'prepared.json', h.config['cachePreparedSha256'])
    config = b.document(h.provider.INPUT, h.config['cacheInputsSha256'])
    need(prepared['format'] == h.provider.FORMAT and prepared['operatorSha256'] == b.sha(b.protected(OPS / 'ypal-restored-read-cache-provider-v1.py')) and
         prepared['prepared'] is True and prepared['config'] == config and
         all(config[k] == h.config[k] for k in ['readAdmissionSha256', 'readPlanSha256', 'readContextInputSha256']),
         'same_actual_new_cache_prepared_and143_references_required')
    # This constructor is the NEW provider's static receipt constructor. No old
    # c9.load, current source or active-candidate validation is called here.
    host = cache.Host(config); before, rehearsal = cache.owned(host)
    saved = b.document(cache.BASE / 'sql-committed.json', prepared['additionalReadAcknowledgementSha256'])
    intent = b.document(cache.BASE / 'sql-intent.json'); pending = b.document(cache.BASE / 'sql-prepared.json')
    authorization = b.document(cache.BASE / 'authorization.json')
    need(saved['operatorSha256'] == prepared['operatorSha256'] == before['binding']['operatorSha256'] and
         prepared['beforeSha256'] == b.sha(b.protected(cache.BASE / 'before.json')) and prepared['reviewHash'] == before['reviewHash'] and
         saved['bootId'] == prepared['bootId'] == b.boot() and saved['reviewHash'] == before['reviewHash'] and
         saved['readAdmissionSha256'] == h.config['readAdmissionSha256'] and saved['mode'] == 'apply' and saved['result']['committed'] is True and
         saved['commitIntentSha256'] == b.sha(b.protected(cache.BASE / 'sql-intent.json')) and
         saved['preparedSha256'] == b.sha(b.protected(cache.BASE / 'sql-prepared.json')) and saved['xid'] == pending['xid'] and
         authorization['format'] == intent['format'] == h.provider.FORMAT and authorization['reviewHash'] == intent['reviewHash'] == before['reviewHash'] and
         intent['bootId'] == b.boot() and pending['mode'] == 'apply' and pending['planSha256'] == b.sha(rehearsal['sql']['resultJson'].encode()) and
         authorization['additionalReadCount'] == 4 and authorization['additionalReadDeltaSha256'] == rehearsal['additionalReadDeltaSha256'] and
         authorization['readAdmissionSha256'] == h.config['readAdmissionSha256'] and
         saved['additionalReadAuthorizationSha256'] == intent['authorizationSha256'] == b.sha(b.protected(cache.BASE / 'authorization.json')) and
         intent['rehearsalSha256'] == b.sha(b.protected(cache.BASE / 'rehearsed.json')) and
         pending['postProof'] == saved['postProof'] and saved['postProof']['allColumnAcl'] == h.read_rehearsal['after']['allColumnAcl'],
         'actual_new_four_READ_authorization_XID_and_complete_column_chain_required')
    cache.read_extension(h.read_rehearsal['after']['read'], saved['postProof']['catalog'], saved['result'], saved['postProof']['catalog'])
    need(h.read.acl_catalog(before['catalog']['postProof']['catalog']) == h.read.acl_catalog(h.read_rehearsal['after']['read']) and
         before['catalog']['postProof']['allColumnAcl'] == h.read_rehearsal['after']['allColumnAcl'],
         'actual_cache_before_must_be_same_admitted143_and_complete_column_catalog')
    reader_ancestry(h)
    return before, saved


def cache_baseline(h): return cache_receipts(h)[1]['postProof']['reader']


def restored_collector_baseline(b, original, recorded_before, recorded_after, cache_plan, cache, helpers):
    """Choose the authenticated pre-cache collector; prove the exact owned delta."""
    need(original['baseline'] == recorded_after, 'feature_before_must_equal_acknowledged_cache_after_collector')
    cache.exact_four(cache_plan)
    permissions = []
    for grant in cache_plan['addedSelects']:
        table = next(row for row in cache_plan['after']['tables'] if row['name'] == grant['name'])
        need(grant['grantee'] == b.ROLE_OID, 'only_same_actual_collector_cache_reads_may_reverse')
        permissions.append({'role': grant['role'], 'kind': 'relation', 'object': table['oid'],
                            'grantor': grant['grantor'], 'privilege': 'SELECT'})
    # Reused pure reader-delta validator compares every other collector field and
    # requires exactly these four OID/grantor edges, without deleting arbitrary
    # newly observed edges. The returned baseline is the ACK's actual before.
    helpers.validate_reader_delta({'missingPermissions': permissions}, recorded_before, recorded_after)
    expected = copy.deepcopy(original); expected['baseline'] = copy.deepcopy(recorded_before)
    return expected


def inverse_catalog_phase(h, op, reader_inverse_refs):
    b = h.b; before, saved = cache_receipts(h)
    need(op['catalogBefore']['baseline'] == saved['postProof']['reader'], 'same_feature_operation_and_original143_plus4_collector_required')
    if reader_inverse_refs is None:
        expected = op['catalogBefore']; phase = {'phase': 'before-reader-inverse-143-plus-cache4', 'readerInverseQualified': False}
    else:
        need(isinstance(reader_inverse_refs, dict) and set(reader_inverse_refs) == {'result_sha', 'manifest_sha'} and
             all(b.pin(v) for v in reader_inverse_refs.values()) and reader_inverse_refs['manifest_sha'] == h.config['readerManifestSha256'],
             'explicit_same_reader_completed_inverse_refs_required')
        module = b.module(OPS / 'ypal-native-inverse-leaf-v1.py', DEPENDENCIES['ypal-native-inverse-leaf-v1.py'])
        proof = module.validate_inverse_leaf(**reader_inverse_refs); binding = proof['binding']; catalog = binding['catalog']
        result = b.document(READER_BASE / 'result.json', h.config['readerResultSha256'])
        need(proof['format'] == module.FORMAT and proof['validated'] is True and
             proof['bindingSha256'] == b.sha(b.encoded(binding)) and binding['operatorSha256'] == DEPENDENCIES['ypal-native-inverse-leaf-v1.py'] and
             binding['coordinatorOperatorSha256'] == DEPENDENCIES['ypal-native-cutover-v2.py'] and
             binding['manifestSha256'] == reader_inverse_refs['manifest_sha'] and binding['inverseResultSha256'] == reader_inverse_refs['result_sha'] and
             binding['records']['operation.json'] == result['operationSha256'] and
             all(catalog[k] == h.config[k] for k in ['readAdmissionSha256', 'readPlanSha256', 'readContextInputSha256']) and
             catalog['validated'] is catalog['read143Preserved'] is catalog['cache4Reversed'] is catalog['twoLOGINReversed'] is True and
             catalog['catalogSha256'] == b.sha(b.encoded(h.read.acl_catalog(h.read_rehearsal['after']['read']))) and
             catalog['allColumnAclSha256'] == b.sha(b.encoded(h.read_rehearsal['after']['allColumnAcl'])) and
             all(proof[k] is False for k in ['sourceActorQualified', 'currentWriterQualified', 'financialAuthorityQualified', 'currentReadinessQualified']) and
             proof['databaseWrites'] == proof['serviceActions'] == proof['providerCalls'] == 0,
             'same_actual_completed_reader_inverse_full143_column_and_operation_binding_required')
        expected = restored_collector_baseline(b, op['catalogBefore'], before['catalog']['postProof']['reader'],
                                              saved['postProof']['reader'], saved['result'], h.cache, h.parts['historicalReadHelpers'])
        phase = {'phase': 'after-completed-reader-inverse-restored143', 'readerInverseQualified': True,
                 'readerInverseRefs': copy.deepcopy(reader_inverse_refs), 'readerInverseBindingSha256': proof['bindingSha256'],
                 'full143CatalogSha256': catalog['catalogSha256'], 'allColumnAclSha256': catalog['allColumnAclSha256']}
    need(h.catalog() == expected, 'exact_owned_feature_inverse_collector_catalog_for_explicit_reader_phase_required')
    return expected, phase


def api_actor(h, unit, values):
    b = h.b; need(unit == b.API, 'fixed_feature_API_actor_required')
    state = h.state(unit); pid = int(state['MainPID'])
    need(state['ActiveState'] == 'active' and state['SubState'] == 'running' and state['Job'] in {'', '0'} and
         re.fullmatch('[a-f0-9]{32}', state['InvocationID']), 'running_feature_API_required')
    group = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.procs'
    need(group.read_text().split() == [str(pid)], 'one_exact_API_Node_required')
    row = peer(h, pid, 967, 961, values)
    args = re.findall(r'argv\[\]=(.*?)\s+;', state['ExecStart'])
    need(row['capabilitiesZero'] is row['noNewPrivileges'] is row['startupInjectionAbsent'] is True and row['groups'] == [961] and
         row['executable'] == '/opt/node-v24.18.1/bin/node' and row['cgroup'] == '0::/system.slice/' + unit and
         len(args) == 1 and row['argv'] == shlex.split(args[0]) and row['cwd'] == state['WorkingDirectory'] and
         h.state(unit) == state, 'same_restricted_API_program_private_context_and_public_selector_required')
    return {k: state[k] for k in ['Id', 'MainPID', 'InvocationID', 'ExecMainStartTimestampMonotonic']} | {'startTicks': row['startTicks']}


def peer(h, pid, uid, gid, public=None):
    return json.loads(h.sdk.command(['/usr/bin/setpriv', '--reuid=' + str(uid), '--regid=' + str(gid), '--clear-groups',
        '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c',
        h.sdk.PEER], h.b.encoded({'pid': pid, 'uid': uid, 'gid': gid, 'public': public or {}, 'requirePublic': public is not None}), timeout=8))


def capture_temporary(h):
    b = h.b; h.source_activation(); paths, native = source_static(h); state = h.p['host'].state(b.SOURCE)
    need(state['ActiveState'] == 'active' and state['SubState'] == 'running' and state['MainPID'] != '0' and
         state['ControlGroup'] == '/system.slice/' + b.SOURCE and not state['DropInPaths'], 'running_fixed_temporary_source_required')
    pids = sorted(int(x) for x in (Path('/sys/fs/cgroup/system.slice') / b.SOURCE / 'cgroup.procs').read_text().split())
    need(len(pids) == 2 and int(state['MainPID']) in pids, 'exact_Node_and_esbuild_temporary_group_required')
    rows = []
    for pid in pids:
        rows.append(json.loads(h.sdk.command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--inh-caps=-all',
            '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c', peer_program(h.sdk)],
            b.encoded({'pid': pid, 'uid': 970, 'gid': 964, 'public': {}, 'requirePublic': False, 'invocation': state['InvocationID']}), timeout=8)))
    stable_state = copy.deepcopy(state)
    after = stable_state['After'].split()
    need(len(after) == len(set(after)), 'unique_temporary_After_dependencies_required')
    stable_state['After'] = ' '.join(sorted(after))
    namespace = json.loads(h.sdk.command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--inh-caps=-all',
        '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c', h.sdk.NAMESPACE_PEER],
        b.encoded({'pid': int(state['MainPID']), 'paths': paths}), timeout=8))
    expected_namespace = {}
    for inside, backing in paths.items():
        info = Path(backing).stat()
        expected_namespace[inside] = {'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid, 'gid': info.st_gid, 'kind': stat.S_IFMT(info.st_mode)}
    need(namespace == expected_namespace, 'actual_temporary_process_namespace_must_match_original_loaded_mounts')
    actor = {'unit': stable_state, 'parent': next(p for p in rows if p['pid'] == int(state['MainPID'])), 'processes': rows,
             'namespace': namespace, 'nativeIdentity': native}
    need(h.p['host'].state(b.SOURCE) == state and pids == sorted(int(x) for x in (Path('/sys/fs/cgroup/system.slice') / b.SOURCE / 'cgroup.procs').read_text().split()),
         'temporary_source_changed_during_kernel_capture')
    source_actor_checks(actor, h.p['ancestorOperation']['fresh'])
    return actor


def fresh_native_sql(b, reader):
    return ("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + b.FRESH +
        "'),'buildId',(SELECT value->>'build_id'FROM " + b.FRESH + "._ponder_meta WHERE key='app'),'tables',(SELECT jsonb_object_agg(c.relname,jsonb_build_object('oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + b.FRESH + "'AND c.relname IN(" + ','.join(b.literal(n) for n in reader.TABLES) + ')))')


def fresh_native_identity(b, native, receipt):
    need(native['schemaOid'] == receipt['schemaOid'] == b.FRESH_OID and native['buildId'] == b.FRESH_BUILD and
         {name: row['oid'] for name, row in native['tables'].items()} == receipt['readTableOids'] and len(native['tables']) == 10 and
         all(row['owner'] == b.WRITER_OID and row['kind'] == 'r' and row['rls'] is row['forceRls'] is False for row in native['tables'].values()),
         'same_actual_fresh_native10_OIDs_owner_and_build_required')
    return native


def source_static(h):
    """Original fresh unit/public/private files and its actual loaded mounts."""
    b = h.b; unit = Path('/etc/systemd/system') / b.SOURCE
    raw = b.protected(unit); need(b.sha(raw) == SOURCE_UNIT_SHA, 'same_original_fresh_unit_required')
    receipt = b.document(SOURCE_BASE / 'result.json', b.SOURCE_ACK)
    operation = b.document(SOURCE_BASE / 'operation.json', receipt['operationSha256'])
    need(operation['operatorSha256'] == h.reader.SOURCE_START_SHA and operation['bootId'] == receipt['bootId'] == b.boot() and
         receipt['ready'] is True and not (SOURCE_BASE / 'inverse-intent.json').exists(), 'same_unreversed_581_temporary_source_ancestry_required')
    native = fresh_native_identity(b, h.query(fresh_native_sql(b, h.reader)), receipt)
    # The authenticated source operation contains exact already-installed public
    # inode records; compare using the original pure file-identity implementation.
    prepare = b.module(Path('/var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-backend-owner-v1.py'),
                       'a1033872bb5c8a5c434ec5bfae4f3d99629c3e2b417de2e1d76e0fa48623aba1')
    need(h.p['host'].inputs() == h.p['ancestorOperation']['inputs'], 'unchanged_authenticated_source_private_files_and_writer_role_required')
    for name, record in operation['publicFilePins'].items():
        path = prepare.ROOT / name
        need(prepare.file_identity(path.lstat()) == record['identity'] and b.sha(b.protected(path)) == record['sha256'],
             'same_fresh_public_candidate_inodes_required')
    created = b.document(SOURCE_BASE / 'unit-created.json')
    need(prepare.file_identity(unit.lstat()) == created['identity'] and created['sha256'] == SOURCE_UNIT_SHA,
         'same_original_temporary_unit_inode_required')
    state = h.state(b.SOURCE)
    need(state['WorkingDirectory'] == str(prepare.PROJECT) and state['User'] == state['Group'] == b.WRITER_ROLE and
         [shlex.split(v) for v in re.findall(r'argv\[\]=(.*?)\s+;', state['ExecStart'])] == [['/usr/bin/env', '-i', *operation['argv']]],
         'same_loaded_temporary_program_and_private_argument_order_required')
    obj = '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in b.SOURCE)
    paths = {}
    for property_name, count in [('BindPaths', 3), ('BindReadOnlyPaths', 1)]:
        lines = [v.split('=', 1)[1] for v in raw.decode().splitlines() if v.startswith(property_name + '=')]
        need(len(lines) == 1, 'single_original_temporary_mount_declaration_required')
        expected = [v.split(':') for v in shlex.split(lines[0])]
        need(len(expected) == count and all(len(v) == 2 for v in expected), 'same_original_temporary_namespace_layout_required')
        observed = json.loads(h.sdk.command(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1', obj,
                             'org.freedesktop.systemd1.Service', property_name], timeout=8))
        need(observed['type'] == 'a(ssbt)' and len(observed['data']) == count and all(len(row) == 4 and row[:3] == [a, z, False] and
             row[3] in {0, 16384} for row, (a, z) in zip(observed['data'], expected)), 'same_loaded_temporary_writable_and_readonly_mounts_required')
        paths.update({inside: backing for backing, inside in expected})
    return paths, native


def temporary_value(actor):
    return {'pid': actor['parent']['pid'], 'startTicks': actor['parent']['startTicks'], 'invocation': actor['unit']['InvocationID'],
            'actorPids': sorted(p['pid'] for p in actor['processes']), 'sdkActor': actor}


class HostMixin:
    def baseline(self): return cache_baseline(self)
    def peers(self):
        pure = self.read_host.context.module(self.read_host.context.READ_HELPERS, self.read_host.context.READ_HELPERS_SHA)
        return pure.consumer_frame(self.h)
    def combined(self):
        proof = self.static.inverse_source() if self.inverse_mode else self.active.validate_runtime(rpc_pin=RPC_ACK)
        if self.inverse_mode and proof['sourceTerminalQualified']:
            return {'inverseOnly': True, 'terminal': True, 'restoreReceiptSha256': self.static.RESULT_SHA}
        # Stable identity only; no checkpoint, heartbeat or head equality.
        return {'restoredSourceReceiptSha256': self.static.RESULT_SHA, 'source': self.p['restoreReceipt']['source'],
                'poolMaximum': 5, 'sourceInventoryAncestry': 'registered4e-plus-explicit-de4-restored5', 'oldC96ActorRelabelled': False}
    def source_actor(self, expected=None):
        actor = capture_temporary(self)
        if expected is None:
            original = self.p['ancestorOperation']['fresh']
            for row in actor['processes']:
                prior = next(v for v in original['processes'] if v['pid'] == row['pid'])
                need(all(row[k] == prior[k] for k in prior), 'original_temporary_epoch_must_match_authenticated_kernel_packet')
            need(actor['unit']['InvocationID'] == original['unit']['InvocationID'], 'original_temporary_invocation_required')
        else:
            source_actor_checks(actor, expected, expected['sdkActor'])
        return temporary_value(actor)
    def restart_temporary_source(self, intent, original):
        self.terminal(self.b.SOURCE); self.source_activation()
        before = self.query("SELECT value FROM " + self.b.FRESH + "._ponder_meta WHERE key='app'")
        clock = self.query('SELECT floor(extract(epoch FROM statement_timestamp())*1000)::bigint')
        self.b.save(self.b.BASE / 'inverse-source-heartbeat-floor.json', {'intentSha256': self.b.sha(self.b.protected(self.b.BASE / 'inverse-source-start-intent.json')),
                    'predecessorHeartbeat': int(before['heartbeat_at']), 'prestartDatabaseClock': int(clock)})
        self.terminal(self.b.SOURCE); self.manager('start', self.b.SOURCE)
        def observed():
            actor = capture_temporary(self); source_actor_checks(actor, original)
            start = intent['monotonicUs'] * os.sysconf('SC_CLK_TCK') // 1_000_000
            need(actor['unit']['InvocationID'] != original['invocation'] and 0 <= actor['parent']['startTicks'] - start <= 45 * os.sysconf('SC_CLK_TCK'),
                 'new_temporary_epoch_must_follow_own_inverse_start_intent')
            heartbeat_current(self, actor); return temporary_value(actor)
        return self.b.wait_read(observed, 'owned_restored_temporary_source_start_pending', 150)
    def inverse_source(self):
        need(self.inverse_mode, 'inverse_only_temporary_guard')
        state = self.state(self.b.SOURCE)
        original = self.b.document(self.b.BASE / 'operation.json')['source']
        if state['MainPID'] == '0':
            self.terminal(self.b.SOURCE)
            self.static.gone(original['sdkActor']['processes'])
            need(state['InvocationID'] in {'', original['invocation']} or int(state['NRestarts']) > 0,
                 'only_owned_terminal_temporary_invocation_required')
            return {'terminal': True, 'actor': None}
        actor = capture_temporary(self); source_actor_checks(actor, original)
        need(actor == original['sdkActor'] or (int(state['NRestarts']) > 0 and actor['parent']['startTicks'] >= original['startTicks']),
             'inverse_only_exact_program_restart_counter_and_epoch_required')
        return {'terminal': False, 'actor': temporary_value(actor)}
    def sessions(self, temporary=None):
        b = self.b; source = self.combined(); actors = {}
        if not source.get('terminal'): actors[b.COMBINED] = self.p['restoreReceipt']['source']
        if temporary is not None: actors[b.SOURCE] = temporary['sdkActor']
        return self.raw.sessions(actors)
    def queue_proof(self, since, minimum):
        # Pure accepted journal predicate; no old source-host constructor.
        module = self.raw.observer.load('booster-feature-handover-v7.py')
        raw = self.run(['/usr/bin/journalctl', '--unit=' + self.b.QUEUE, '--boot=0', '--no-pager', '--output=json', '--since=-3min'], 10)
        status = self.run(['/usr/bin/systemctl', 'show', self.b.QUEUE, '--property=Result', '--value'], 8)
        need(status.strip() == 'success', 'owned_queue_success_required')
        return module.queue_completion([json.loads(line) for line in raw.splitlines() if line], since, minimum)


def temporary_sessions(h, actor):
    """Positive FRESH subset only; the caller owns other shared73004621 writers."""
    sql = "SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=73004621 AND datid=17584"
    rows = h.query(sql); need(len(rows) <= 32, 'bounded_existing_writer_role_sessions_required')
    observer = h.raw.observer
    fds = observer.peer_fds([r['pid'] for r in rows], 111, 113)
    peers = observer.unix_peers(observer.run(['/usr/bin/ss', '-xHn']))
    tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()), **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
    own = observer.peer_fds([r['pid'] for r in actor['processes']], 970, 964)
    need(all(own[str(r['pid'])]['startTicks'] == r['startTicks'] for r in actor['processes']), 'same_temporary_epoch_during_positive_kernel_mapping')
    mapped = observer.map_owned_backends(own, fds, rows, peers, tcp)
    need(len(mapped) > 0 and rows == h.query(sql), 'positive_stable_temporary_kernel_owned_sessions_required')
    return mapped


def heartbeat_current(h, actor):
    floor = h.b.document(h.b.BASE / 'inverse-source-heartbeat-floor.json')
    need(floor['intentSha256'] == h.b.sha(h.b.protected(h.b.BASE / 'inverse-source-start-intent.json')), 'own_temporary_heartbeat_floor_required')
    app = h.query("SELECT value FROM " + h.b.FRESH + "._ponder_meta WHERE key='app'")
    clock = h.query('SELECT floor(extract(epoch FROM statement_timestamp())*1000)::bigint')
    need(app['build_id'] == h.b.FRESH_BUILD and str(app['is_locked']) == '1' and
         int(app['heartbeat_at']) > floor['predecessorHeartbeat'] and int(app['heartbeat_at']) >= floor['prestartDatabaseClock'] and
         0 <= int(clock) - int(app['heartbeat_at']) <= 180000, 'genuine_new_temporary_heartbeat_required')
    return temporary_sessions(h, actor)


def inverse_leaf(b, result_sha, manifest_sha, input_sha, reader_inverse_refs=None):
    h = b.Host(manifest_sha, input_sha); h.inverse_mode = True; owner = b.Owner(h)
    result = b.document(b.BASE / 'inverse-result.json', result_sha); op = owner.operation()
    need(result['format'] == b.FORMAT and result['inverse'] is result['ownedEightSELECTsRevoked'] is result['prior143AndCache4Preserved'] is True and
         result['operatorSha256'] == op['operatorSha256'] and result['operationSha256'] == b.sha(b.protected(b.BASE / 'operation.json')) and
         result['bootId'] == b.boot() and result['restoredSchema'] == b.FRESH and result['restoredBuild'] == b.FRESH_BUILD,
         'exact_new_owned_feature_inverse_receipt_required')
    expected_catalog, catalog_phase = inverse_catalog_phase(h, op, reader_inverse_refs)
    need(b.boot_record() == op['sourceBoot'], 'same_source_boot_inode_restored')
    h.source_activation(); h.definitions(False)
    source = h.source_actor(result['source']); api = h.actor(False)
    need(api == result['api'], 'same_owned_restored_feature_API_required')
    for name in ['inverse-source-start', 'inverse-start-original-api', 'inverse-resume-timer']:
        if name == 'inverse-source-start' and not (b.BASE / (name + '-intent.json')).exists(): continue
        owner.phase(name)
    minimum = max(owner.get('switch-result.json')['switchBoundary'], owner.get('inverse-review.json')['lastFeatureCursor'])
    h.native(b.FRESH, b.FRESH_BUILD, minimum, True); available = h.availability(minimum, b.FRESH_BUILD)
    timer = h.state(b.TIMER); need(timer['ActiveState'] == 'active' and timer['UnitFileState'] == 'enabled', 'restored_owned_queue_schedule_required')
    if (b.BASE / 'inverse-source-start-intent.json').exists(): sessions = heartbeat_current(h, source['sdkActor'])
    else: sessions = temporary_sessions(h, source['sdkActor'])
    need(h.source_actor(result['source']) == source and h.actor(False) == api, 'restored_feature_actors_changed_during_inverse_leaf')
    need(inverse_catalog_phase(h, op, reader_inverse_refs) == (expected_catalog, catalog_phase), 'feature_inverse_catalog_phase_changed_during_actor_and_HTTP_checks')
    return {'format': b.FORMAT + '-inverse-leaf', 'validated': True, 'receiptSha256': result_sha,
            'operatorSha256': op['operatorSha256'], 'operationSha256': result['operationSha256'],
            'temporarySourceActor': source['sdkActor'], 'temporarySourceKernelSessions': sessions, 'api': api,
            'temporarySourceNativeIdentity': source['sdkActor']['nativeIdentity'],
            'temporarySourceActorQualified': True, 'temporarySourceReadinessQualified': True,
            'inverseCatalogPhase': catalog_phase,
            'originalBootInodeRestored': True, 'sameProgramsPrivateInputsAndPrivilegesQualified': True, 'availability': available,
            'sourceActorQualified': False, 'combinedSourceActorQualified': False, 'financialAuthorityQualified': False,
            'currentReadinessQualified': False, 'originalWholeValidatorsPassed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
