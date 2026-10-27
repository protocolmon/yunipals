#!/usr/bin/env python3
"""Current restored READ143 + separately owned four-cache-read phase provider.

The frozen c54 operational bodies execute in a NEW namespace with audited
constructor/proof/transport seams. Frozen modules, globals and receipts remain
unchanged. Metadata construction is a separately authenticated current producer.
"""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FORMAT = 'yunipals-ypal-restored-read-cache-provider-v1'
BASE = Path('/var/backups/yunipals-ypal-restored-cache-owner-v1-20261024')
INPUT = Path('/var/backups/yunipals-ypal-restored-cache-input-v1-20261024/input.json')
TEMPLATE = OPS / 'ypal-cache-guard-owner-v1.py'
TEMPLATE_SHA = 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba'
READ = OPS / 'ypal-restored-read-admission-v1.py'
READ_SHA = '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4'
STATIC = OPS / 'ypal-restored-metadata-context-v1.py'
STATIC_SHA = 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
METADATA = OPS / 'ypal-restored-metadata-handover-v1.py'
METADATA_SHA = 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'
TRANSPORT = OPS / 'ypal-restored-cache-peer-runtime-v1.py'
TRANSPORT_SHA = '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f'
ENTRY = OPS / 'ypal-restored-cache-sql-v1.mjs'
ENTRY_SHA = '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab'
GENERATION_OWNER = OPS / 'ypal-restored-generation-v1.py'
GENERATION_SHA = '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946'
GENERATION = Path('/var/backups/yunipals-ypal-restored-generation-v1-20261024/candidate-result.json')
GENERATION_FORMAT = 'yunipals-ypal-restored-generation-candidate-v1'
READER = Path('/var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-reader-cutover-v1.py')
READER_SHA = 'f6037061b599ebf949a781e6dc685cfc97961c8cff40bd6b7bf73a78113fe3d8'
READER_SQL_SHA = '95efde36a354536f02a9bfa324ffbc987a7d4d0532c9a1669fdd3818e2659630'
LOGINS = {'yunipals_unified_api': '73187671', 'yunipals_unified_islands_api': '73187674'}
CONFIG_KEYS = {'readAdmissionSha256', 'readPlanSha256', 'readContextInputSha256', 'metadataSelectionSha256',
               'metadataProvenanceFile', 'metadataProvenanceSha256', 'generationSha256'}


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None

def read_module():
    # Bootstrap uses the same strict reader, without importing any old runtime.
    import stat
    need(pin(READ_SHA), 'fresh_READ_producer_not_yet_frozen')
    for p in [*READ.parents, READ]:
        s = p.lstat(); need(s.st_uid == s.st_gid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'protected_fresh_READ_source_required')
    raw = READ.read_bytes(); need(sha(raw) == READ_SHA, 'exact_fresh_READ_producer_required')
    m = types.ModuleType('new_restored_read'); m.__file__ = str(READ); exec(compile(raw, str(READ), 'exec'), m.__dict__); return m


def dependency(path, digest):
    need(pin(digest), 'current_dependency_not_yet_frozen'); return read_module().module(path, digest)


def config_checked(config):
    need(set(config) == CONFIG_KEYS and all(pin(config[k]) for k in CONFIG_KEYS if k != 'metadataProvenanceFile') and
         re.fullmatch(r'provenance-(0|[1-9][0-9]*)-observed.json', config['metadataProvenanceFile']) and
         int(config['metadataProvenanceFile'].split('-')[1]) < 128, 'exact_current_cache_inputs_required')
    return config


def admission_config(config):
    return {'admissionSha256': config['readAdmissionSha256'], 'readPlanSha256': config['readPlanSha256'],
            'readContextInputSha256': config['readContextInputSha256']}


def static_read_host(config):
    """Construct only receipt/static-qualified objects; no active source assumption."""
    r = read_module(); static = dependency(STATIC, STATIC_SHA); parts = static.query_components()
    h = r.Host.__new__(r.Host); h.context_input = config['readContextInputSha256']; h.context = parts['readContext']
    h.parts = parts; h.helpers = parts['historicalReadHelpers']; h.primitives = parts['privilegedSourcePrimitives']; h.h = h.primitives['host']
    h.columns = r.protected(r.COLUMNS, r.COLUMNS_SHA).decode().strip(); h.sql = r.combined_sql(parts['catalogSql'], h.columns)
    h.plan_sha = config['readPlanSha256']; h.plan = r.validate_plan(parts, r.document(r.PLAN, h.plan_sha))
    need(h.plan['contextInputSha256'] == h.context_input, 'same_actual_new_READ_context_required')
    receipt, before, rehearsal = r.admitted(h, config['readAdmissionSha256'])
    return r, static, h, receipt, before, rehearsal


def login_catalog(value, enabled):
    result = copy.deepcopy(value)
    for name, oid in LOGINS.items():
        found = [r for r in result['roles'] if r['name'] == name and r['oid'] == oid]
        need(len(found) == 1 and found[0]['login'] is False, 'original_two_API_NOLOGIN_roles_required')
        if enabled: found[0]['login'] = True
    return result


def current_reads(host, cache_reads=False, enabled=False, expected_catalog=None, inverse=False):
    need(type(enabled) is type(inverse) is type(cache_reads) is bool and (not enabled or expected_catalog is not None), 'explicit_owned_reader_LOGIN_phase_and_expected_catalog_required')
    r = host.new_read; _, before, rehearsal = r.admitted(host.read_host, host.config['readAdmissionSha256'])
    expected = rehearsal['after']['read']; columns = rehearsal['after']['allColumnAcl']
    if cache_reads:
        saved = host.cache.document(BASE / 'sql-committed.json'); operation, _ = host.cache.owned(host)
        prepared = host.cache.document(BASE / 'sql-prepared.json')
        need(saved['operatorSha256'] == operation['binding']['operatorSha256'] and saved['bootId'] == r.boot() and
             saved['reviewHash'] == operation['reviewHash'] and saved['readAdmissionSha256'] == host.config['readAdmissionSha256'] and
             saved['commitIntentSha256'] == sha(r.protected(BASE / 'sql-intent.json')) and
             saved['preparedSha256'] == sha(r.protected(BASE / 'sql-prepared.json')) and saved['xid'] == prepared['xid'],
             'exact_separate_four_READ_transaction_and_prepared_chain_required')
        authorization = host.cache.document(BASE / 'authorization.json'); intent = host.cache.document(BASE / 'sql-intent.json')
        _, rolled = host.cache.owned(host)
        need(authorization['format'] == FORMAT and authorization['reviewHash'] == operation['reviewHash'] and
             authorization['readAdmissionSha256'] == host.config['readAdmissionSha256'] and authorization['additionalReadCount'] == 4 and
             authorization['additionalReadDeltaSha256'] == rolled['additionalReadDeltaSha256'] and
             intent['format'] == FORMAT and intent['bootId'] == r.boot() and intent['reviewHash'] == operation['reviewHash'] and
             intent['authorizationSha256'] == saved['additionalReadAuthorizationSha256'] == sha(r.protected(BASE / 'authorization.json')) and
             intent['rehearsalSha256'] == sha(r.protected(BASE / 'rehearsed.json')) and
             prepared['planSha256'] == sha(rolled['sql']['resultJson'].encode()) and
             prepared['postProof']['allColumnAcl'] == saved['postProof']['allColumnAcl'], 'exact_four_READ_authorization_and_same_prepared_SQL_required')
        expected = saved['postProof']['catalog']
        need(saved['postProof']['allColumnAcl'] == columns, 'four_READ_transaction_must_preserve_all_grantee_columns')
        host.cache.read_extension(rehearsal['after']['read'], expected, saved['result'], expected)
    target = login_catalog(expected, enabled)
    if expected_catalog is not None:
        need(r.acl_catalog(expected_catalog) == r.acl_catalog(target), 'caller_expected_catalog_must_equal_owned143_four_and_twoLOGIN_delta')
    first = host.read_host.catalog()
    need(r.graph(first) == r.graph({'read': target, 'allColumnAcl': columns}), 'full_current_direct_relation_schema_function_and_all_column_graph_required')
    proof = host.static.inverse_source() if inverse else host.read_host.runtime()
    need(host.read_host.catalog() == first, 'catalog_changed_during_current_source_qualification')
    return {'format': FORMAT, 'validated': True, **{'readAdmissionSha256': host.config['readAdmissionSha256'],
            'readPlanSha256': host.config['readPlanSha256'], 'readContextInputSha256': host.config['readContextInputSha256']},
            'catalogSha256': sha(encoded(first)), 'sourceBinding': proof, 'apiLoginsEnabled': enabled,
            'additionalReadCount': 4 if cache_reads else 0, 'inverseOnly': inverse, 'ready': False,
            'originalWholeValidatorPassed': False, 'original143WholeValidatorPassed': False,
            'sourceReadinessQualified': False, 'financialAuthorityQualified': False,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0,
            'preservation': {'restoredSourceEpochQualified': True, 'originalWholeValidatorPassed': False}}


def metadata_refresh(config, inverse=False):
    need(set(config) == {'admissionSha256', 'readPlanSha256', 'readContextInputSha256'}, 'explicit_metadata_READ_reference_required')
    r, static, read_host, receipt, before, rehearsal = static_read_host({**config, 'readAdmissionSha256': config['admissionSha256']})
    def check():
        expected = rehearsal['after']; first = read_host.catalog()
        need(r.graph(first) == r.graph(expected), 'exact_new143_current_graph_without_cache4_required')
        source = static.inverse_source() if inverse else read_host.runtime()
        need(r.graph(read_host.catalog()) == r.graph(expected), 'metadata_READ_graph_changed_during_source_proof')
        return {'validated': True, 'readAdmissionSha256': config['admissionSha256'],
                'readPlanSha256': config['readPlanSha256'], 'readContextInputSha256': config['readContextInputSha256'],
                'sourceBinding': source, 'inverseOnly': inverse, 'originalWholeValidatorPassed': False,
                'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    return check


def semantic_guard(expected, actual):
    before, current = copy.deepcopy(expected), copy.deepcopy(actual)
    need(set(before) == set(current) and len(before['epochs']) == len(current['epochs']) == 4 and
         {v['collection'] for v in before['epochs']} == {v['collection'] for v in current['epochs']} == {'ethereum', 'base', 'polygon', 'bnb'},
         'same_four_guard_epoch_collections_required')
    prior = {v['collection']:v for v in before['epochs']}
    for row in current['epochs']:
        need(re.fullmatch('[0-9]+', str(row['revision'])) and int(row['revision']) >= int(prior[row['collection']]['revision']), 'guard_epoch_cannot_decrease_or_reset')
    for value in [before, current]:
        value['epochs'] = sorted([{k:v for k,v in row.items() if k != 'revision'} for row in value['epochs']], key=lambda row:row['collection'])
    need(before == current, 'all_guard_object_trigger_definition_full_and_column_ACLs_must_stay_exact')
    return sha(encoded(current))


def guard_current(host, cache_reads=True):
    committed = host.cache.document(BASE / 'sql-committed.json')
    actual = host.cache.sql_child(host, 'inspect')
    digest = semantic_guard(committed['result']['after' if cache_reads else 'before'], actual['state'])
    return {'semanticCatalogSha256': digest, 'epochsMonotonic': True, 'allColumnACLsQualified': True}


def qualified_sql_child(cache, host, mode, plan=None, prepared=None, generation=None, plan_json=None):
    columns = host.new_read.admitted(host.read_host, host.config['readAdmissionSha256'])[2]['after']['allColumnAcl']
    def check(value):
        need(value['postProof']['allColumnAcl'] == columns, 'same_transaction_all_grantee_column_ACLs_must_stay_exact')
        if prepared is not None: prepared(value)
    result = cache._sql_child(host, mode, plan, check if prepared is not None else None, generation, plan_json)
    if mode != 'freshness':
        need(result['postProof']['allColumnAcl'] == columns, 'actual_cache_SQL_postproof_all_column_ACLs_required')
    return result


def reader_catalog(host):
    original = dependency(READER, READER_SHA); sql = original.catalog_sql()
    need(sha(sql.encode()) == READER_SQL_SHA, 'exact_original_collector_catalog_SQL_required')
    return host.h.query(sql), sql


def initialize(host, config, cache, inverse_mode=False):
    host.config = config_checked(config); host.cache = cache; host.inverse_mode = inverse_mode
    r, static, read_host, receipt, before, rehearsal = static_read_host(config)
    host.new_read, host.static, host.read_host = r, static, read_host
    host.h = types.SimpleNamespace(query=read_host.h.query, observer=read_host.h.raw.observer,
        m=types.SimpleNamespace(run=read_host.primitives['sdk'].command, protected=read_host.primitives['sdk'].protected))
    host.read_receipt, host.read_before, host.read_rehearsal = receipt, before, {**rehearsal, 'after': rehearsal['after']['read']}
    host.plan = read_host.plan; host.catalog_sql = read_host.parts['catalogSql']
    host.m = dependency(cache.RETAINED, cache.RETAINED_SHA); host.m.artifact()
    host.candidate_owner = dependency(OPS / 'ypal-generation-cache-candidates-v1.py', cache.CANDIDATE_OWNER_SHA)
    host.candidate = r.document(cache.CANDIDATES / 'result.json', cache.CANDIDATE_SHA)
    need(host.candidate['staged'] is True and host.candidate['selected'] is False and host.candidate['sourceRelease'] == cache.RELEASE and
         host.candidate['readIdentity'] == cache.IDENTITY, 'exact_retained_dormant_cache_candidate_required')
    pure = read_host.context.module(read_host.context.READ_HELPERS, read_host.context.READ_HELPERS_SHA)
    def exact_current(receipt_sha):
        need(receipt_sha == host.config['readAdmissionSha256'], 'passed_READ_ACK_must_equal_authenticated_config')
        return current_reads(host, False, inverse=host.inverse_mode)
    host.read = types.SimpleNamespace(SQL=read_host.context.historical().READ_CATALOG, acl_catalog=r.acl_catalog,
        consumer_frame=pure.consumer_frame, reader_catalog=lambda _: reader_catalog(host),
        validate_current=exact_current)
    host.view = types.SimpleNamespace(query=lambda _h, sql: read_host.query(sql))
    _, host.reader_sql = reader_catalog(host)
    host.s = types.SimpleNamespace(transition_lock=host.read_host.primitives['sdk'].lock)
    host.admission_ref = {'producerFile': str(READ), 'producerSha256': READ_SHA, 'resultFile': str(r.BASE / 'result.json'),
        'receiptSha256': config['readAdmissionSha256'], 'planSha256': config['readPlanSha256'], 'contextInputSha256': config['readContextInputSha256']}
    host.metadata_primitives = lambda: {**static.metadata_primitives(), 'admission_ref': host.admission_ref, 'readConfig': admission_config(config)}


def refresh(host):
    cache = host.cache
    for name, digest in host.candidate['files'].items():
        need(sha(cache.protected(cache.CANDIDATES / name)) == digest, 'exact_dormant_cache_candidate_files_required')
    closure = host.candidate['officialSourceClosure']
    need(len(closure) == len(host.candidate_owner.CLOSURE) and {v['path'] for v in closure} == set(host.candidate_owner.CLOSURE), 'same_finite_official_cache_closure_required')
    for row in closure:
        raw = cache.protected(cache.PROJECT / row['path']); need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'same_accepted_official_cache_worker_sources_required')
    return current_reads(host, (BASE / 'sql-committed.json').exists() and not (BASE / 'sql-inversed.json').exists(), inverse=host.inverse_mode)


def metadata_current(host, generation, selection):
    facade = dependency(METADATA, METADATA_SHA)
    return facade.metadata(host, generation, selection, lambda: refresh(host))


def statement(text): return ast.parse(text).body[0]


def transport_function(fn):
    fn = copy.deepcopy(fn); need(fn.name == 'sql_child', 'fixed_cache_SQL_transport_body_required')
    dictionaries = [v for v in ast.walk(fn) if isinstance(v, ast.Dict) and any(isinstance(k, ast.Constant) and k.value == 'catalogSql' for k in v.keys)]
    need(len(dictionaries) == 1, 'one_frozen_cache_SQL_request_required')
    dictionaries[0].keys.append(ast.Constant('columnsSql'))
    dictionaries[0].values.append(ast.parse('protected(COLUMN_SQL).decode()', mode='eval').body)
    assignments = [v for v in ast.walk(fn) if isinstance(v, ast.Assign) and len(v.targets) == 1 and isinstance(v.targets[0], ast.Name) and v.targets[0].id == 'args']
    need(len(assignments) == 1 and isinstance(assignments[0].value, ast.List), 'one_frozen_cache_setpriv_command_required')
    values = assignments[0].value.elts
    need([ast.unparse(v) for v in values[-4:]] == ['NODE', "'--import'", 'str(TSX)', 'str(ENTRY)'], 'unchanged_TSX_and_logical_cache_entry_required')
    values[-4:] = [ast.Starred(ast.parse('public_cache_node_args(public)', mode='eval').body, ast.Load())]
    launches = [v for v in ast.walk(fn) if isinstance(v, ast.Call) and ast.unparse(v.func) == 'subprocess.Popen']
    need(len(launches) == 1, 'one_cache_SQL_child_launch_required'); call = launches[0]
    call.keywords.append(ast.keyword('pass_fds', ast.parse('public.pass_fds', mode='eval').body))
    env = next(v for v in call.keywords if v.arg == 'env'); env.value = ast.parse('{**CLEAN, **public.environment}', mode='eval').body
    # setpriv's env -i needs the FD descriptor explicitly, not merely the parent environment.
    for node in ast.walk(fn):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'env' for t in node.targets):
            node.value = ast.Dict(keys=[None, None], values=[node.value, ast.parse('public.environment', mode='eval').body])
    fn.body = [ast.With([ast.withitem(ast.parse('transport_scope()', mode='eval').body, ast.Name('public', ast.Store()))], fn.body)]
    return ast.fix_missing_locations(fn)


def cache_runtime():
    r = read_module(); raw = r.protected(TEMPLATE, TEMPLATE_SHA); tree = ast.parse(raw)
    changes = {'FORMAT': repr(FORMAT), 'BASE': 'Path(' + repr(str(BASE)) + ')', 'ENTRY': 'OPS / ' + repr(ENTRY.name), 'ENTRY_SHA': repr(ENTRY_SHA), 'META': "Path('/var/backups/yunipals-ypal-restored-metadata-handover-v1-20261024')",
               'META_OWNER': 'OPS / ' + repr(METADATA.name), 'META_OWNER_SHA': repr(METADATA_SHA),
               'GENERATION_OWNER': 'OPS / ' + repr(GENERATION_OWNER.name), 'GENERATION_OWNER_SHA': repr(GENERATION_SHA),
               'GENERATION': 'Path(' + repr(str(GENERATION)) + ')'}
    seen = set(); functions = {}; body = []
    for node in tree.body:
        if isinstance(node, ast.If) and ast.unparse(node.test) == "__name__ == '__main__'": continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in changes:
            name = node.targets[0].id; node.value = ast.parse(changes[name], mode='eval').body; seen.add(name)
        if isinstance(node, ast.ClassDef) and node.name == 'Host':
            replacements = {'__init__': 'initialize_current(self, config)', 'refresh': 'return refresh_current(self)',
                            'metadata_current': 'return metadata_current_new(self, generation, selection)'}
            for method in node.body:
                if isinstance(method, ast.FunctionDef) and method.name in replacements:
                    method.body = [statement(replacements.pop(method.name))]
            need(not replacements, 'exact_three_old_cache_Host_seams_required')
            changed_formats = 0
            for method in node.body:
                if isinstance(method, ast.FunctionDef) and method.name == 'prerequisites':
                    for value in ast.walk(method):
                        if isinstance(value, ast.Constant) and value.value == 'yunipals-ypal-native-generation-candidate-v1':
                            value.value = GENERATION_FORMAT; changed_formats += 1
            need(changed_formats == 1, 'single_new_generation_candidate_format_seam_required')
        if isinstance(node, ast.FunctionDef):
            functions[node.name] = node
            if node.name == 'validate_reads': node.body = [statement('return current_reads_new(host, True, inverse=host.inverse_mode)')]
            elif node.name == 'sql_child':
                node = transport_function(node); node.name = '_sql_child'
        body.append(node)
    need(seen == set(changes), 'exact_ten_cache_namespace_constant_seams_required')
    namespace = types.ModuleType('current_restored_cache_owner'); namespace.__file__ = str(Path(__file__).absolute())
    def init(host, config): initialize(host, config, namespace, getattr(namespace, 'inverse_mode', False))
    namespace.__dict__.update(initialize_current=init, refresh_current=refresh, metadata_current_new=metadata_current,
        current_reads_new=current_reads, COLUMN_SQL=read_module().COLUMNS,
        transport_scope=lambda: dependency(TRANSPORT, TRANSPORT_SHA).public_transport(),
        public_cache_node_args=lambda public: [*public.node_arguments()[:-1], '--import', str(namespace.TSX), public.node_arguments()[-1]])
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), namespace.__file__, 'exec'), namespace.__dict__)
    namespace.sql_child = lambda host, mode, plan=None, prepared=None, generation=None, plan_json=None: qualified_sql_child(namespace, host, mode, plan, prepared, generation, plan_json)
    return namespace


class Phase:
    def __init__(self, inputs, manifest):
        self.inputs, self.manifest = inputs, manifest; self.cache = cache_runtime(); r = read_module()
        required = {READ.name: READ_SHA, STATIC.name: STATIC_SHA, TRANSPORT.name: TRANSPORT_SHA, METADATA.name: METADATA_SHA, GENERATION_OWNER.name: GENERATION_SHA}
        need(all(manifest['dependencies'].get(name) == digest and pin(digest) for name, digest in required.items()) and
             manifest.get('files', {}).get(Path(__file__).name, manifest['dependencies'].get(Path(__file__).name)) == sha(r.protected(Path(__file__).absolute())),
             'exact_external_manifest_current_phase_dependency_closure_required')
        self.prepared = r.document(BASE / 'prepared.json', inputs['cachePreparedSha256'])
        need(self.prepared['format'] == FORMAT and self.prepared['operatorSha256'] == sha(r.protected(Path(__file__).absolute())) and
             self.prepared['prepared'] is True and self.prepared['nativeWorkerStarted'] is False and self.prepared['nativeGenerationPublished'] is False,
             'actual_current_epoch_prepared_cache_ACK_required')
        need(r.document(INPUT, inputs['cacheInputsSha256']) == self.prepared['config'], 'same_explicit_cache_inputs_and_prepared_ACK_required')
        self.host = self.cache.Host(self.prepared['config']); self.before, self.rehearsal = self.cache.owned(self.host)
        self.sql_ack = r.document(BASE / 'sql-committed.json', self.prepared['additionalReadAcknowledgementSha256'])
        for name in ['readPlanSha256', 'readContextInputSha256']:
            need(self.host.config[name] == inputs[name], 'same_coordinator_and_cache_READ_reference_required')
        self.admission_ref = {'producerFile': str(READ), 'producerSha256': READ_SHA, 'resultFile': str(r.BASE / 'result.json'),
                              'receiptSha256': self.host.config['readAdmissionSha256'], 'planSha256': self.host.config['readPlanSha256'],
                              'contextInputSha256': self.host.config['readContextInputSha256']}
    def scope(self, enabled=False, expected_catalog=None):
        proof = current_reads(self.host, True, enabled, expected_catalog); guard = guard_current(self.host, True)
        final = current_reads(self.host, True, enabled, expected_catalog)
        need(proof == final, 'current_phase_changed_during_guard_capture')
        return {**final, 'cacheGuard': guard}
    def inverse_scope(self, cache_reads=True, enabled=False, expected_catalog=None):
        proof = current_reads(self.host, cache_reads, enabled, expected_catalog, True); guard = guard_current(self.host, cache_reads)
        final = current_reads(self.host, cache_reads, enabled, expected_catalog, True)
        need(proof == final, 'inverse_phase_changed_during_guard_capture')
        return {**final, 'cacheGuard': guard}
    def metadata_primitives(self):
        result = self.host.static.metadata_primitives(); return {**result, 'admission_ref': self.admission_ref,
            'readConfig': admission_config(self.host.config), 'sourceAuthorityQualified': False}
    def generation(self):
        owner = dependency(self.cache.GENERATION_OWNER, self.cache.GENERATION_OWNER_SHA)
        r = read_module(); candidate = r.document(self.cache.GENERATION, self.host.config['generationSha256'])
        need(candidate['format'] == GENERATION_FORMAT and candidate['operatorSha256'] == self.cache.GENERATION_OWNER_SHA and
             candidate['built'] is candidate['validated'] is candidate['completed'] is True and candidate['published'] is False and
             candidate['sourceRelease'] == self.cache.RELEASE and candidate['readIdentity'] == self.cache.IDENTITY and candidate['predecessorGenerationId'] == '103' and
             candidate['readAdmissionSha256'] == self.host.config['readAdmissionSha256'] and
             candidate['readConfig'] == admission_config(self.host.config) and candidate['metadataOperatorSha256'] == METADATA_SHA and
             candidate['metadataSelectedSha256'] == self.host.config['metadataSelectionSha256'] and
             candidate['metadataProvenanceSha256'] == self.host.config['metadataProvenanceSha256'], 'actual_current_READ_bound_unpublished_generation_required')
        op = r.document(owner.BASE / 'operation.json', candidate['operationSha256'])
        need(op['format'] == owner.FORMAT and op['operatorSha256'] == candidate['operatorSha256'] and op['bootId'] == r.boot() and op['readAdmissionSha256'] == candidate['readAdmissionSha256'], 'same_generation_operation_chain_required')
        return owner, candidate, op, r.document(owner.BASE / 'capsule-result.json', candidate['capsuleResultSha256'])
    def metadata(self, refresh_callback=None):
        _, candidate, _, _ = self.generation(); r=read_module()
        selection=r.document(self.cache.META / 'selected.json', self.host.config['metadataSelectionSha256'])
        return dependency(METADATA, METADATA_SHA).metadata(self, candidate, selection, refresh_callback or (lambda: self.scope()))
    def metadata_inverse_context(self, refresh_callback=None):
        _, candidate, _, _ = self.generation()
        return dependency(METADATA, METADATA_SHA).metadata_inverse_context(self, candidate, refresh_callback or (lambda: self.inverse_scope(False)))


def create_phase(inputs, coordinator_manifest): return Phase(inputs, coordinator_manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--inputs-sha', required=True)
    group = parser.add_mutually_exclusive_group()
    for name in ['rehearse', 'reconcile-stop', 'commit', 'reconcile-commit', 'prepare-ack', 'inspect', 'inverse-review', 'reconcile-inverse', 'archive-review']:
        group.add_argument('--' + name, action='store_true' if name in {'reconcile-stop', 'commit', 'reconcile-commit', 'prepare-ack', 'inspect', 'inverse-review', 'reconcile-inverse', 'archive-review'} else 'store')
    group.add_argument('--drain', nargs=2); group.add_argument('--inverse'); group.add_argument('--finish-inverse', nargs='?', const='unchanged103')
    group.add_argument('--archive-aborted'); args=parser.parse_args()
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main', 'fixed_root_current_cache_host_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_current_cache_operation_expired')); signal.alarm(300)
    cache=cache_runtime(); cache.inverse_mode=bool(args.inverse or args.reconcile_inverse or args.finish_inverse or args.inverse_review)
    config=config_checked(read_module().document(INPUT,args.inputs_sha)); host=cache.Host(config)
    with host.read_host.primitives['sdk'].lock():
        if args.rehearse: result=cache.rehearsal(host,args.rehearse)
        elif args.drain: result=cache.drain(host,*args.drain)
        elif args.reconcile_stop: result=cache.reconcile_stop(host)
        elif args.commit: result=cache.commit(host)
        elif args.reconcile_commit: result=cache.reconcile_commit(host)
        elif args.prepare_ack: result=cache.prepare_ack(host)
        elif args.inverse: result=cache.inverse(host,args.inverse)
        elif args.reconcile_inverse: result=cache.reconcile_inverse(host)
        elif args.inverse_review: result=cache.inverse_review(host)
        elif args.finish_inverse: result=cache.finish_inverse(host,None if args.finish_inverse=='unchanged103' else args.finish_inverse)
        elif args.archive_aborted: result=cache.archive_aborted(host,args.archive_aborted)
        elif args.archive_review: result=cache.archive_review(host)
        elif args.inspect: result=cache.inspect(host)
        else: result=cache.review(host)
        print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error) if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error)) else type(error).__name__,'automaticRetryAllowed':False})); raise SystemExit(1)
