#!/usr/bin/env python3
"""Named fresh-forward namespaces; historical operators/records stay immutable.

Import/default CLI is file-only. A namespace is construction, never permission
to run a phase. Each inherited phase retains its review, intent, ACK and CAS.
The completed recurring inverse is historical ancestry after the first new
replacement; current writer/catalog/actor authority is checked separately.
"""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-ypal-fresh-forward-epoch-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-recurring-generation-v1-20261024/epochs')
KINDS = ('metadata', 'generation', 'cache', 'readers', 'feature')
WRAPPERS = {kind: 'ypal-fresh-forward-' + kind + '-v1.py' for kind in KINDS}
ANCESTRY = {
    'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3',
    'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946',
    'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6',
    'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9',
    'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003',
    'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14',
    'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8',
    'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374',
    'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1',
    'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035',
    'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be',
    'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5',
    'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4',
    'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
}
INVERSE_OWNER = 'ypal-recurring-generation-owner-v1.py'
SOURCE_OWNER = 'ypal-recurring-generation-source-v1.py'
DATA = {'sourceRelease': '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
        'manifestHash': '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
        'schema': 'unified_ypal_20261023_v1', 'schemaOid': '75963410', 'buildId': '71e2a7f3b7'}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def epoch_path(epoch_id):
    need(isinstance(epoch_id, str) and re.fullmatch('[a-z][a-z0-9-]{0,47}', epoch_id), 'bounded_named_fresh_epoch_required')
    return BASE / epoch_id


def protected(path, expected=None, maximum=300000):
    path = Path(path)
    need(path.is_absolute(), 'absolute_fixed_factory_path_required')
    for parent in [*reversed(path.parents), path]:
        st = parent.lstat()
        need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
             'root_owned_nonwritable_factory_path_required')
    st = path.lstat()
    need(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= maximum, 'bounded_regular_factory_input_required')
    raw = path.read_bytes(); after = path.lstat()
    need(len(raw) == st.st_size and all(getattr(st, key) == getattr(after, key) for key in
         ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) and
         (expected is None or pin(expected) and sha(raw) == expected), 'exact_factory_input_bytes_required')
    return raw


def document(path, expected):
    need(pin(expected), 'actual_factory_receipt_pin_required')
    return json.loads(protected(path, expected))


def read_refs(value):
    need(type(value) is dict and set(value) == {'resultSha256', 'manifestSha256', 'inputSha256'} and
         all(pin(v) for v in value.values()), 'three_actual_phase_receipt_refs_required')
    return dict(value)


def checked_input(value, epoch_id):
    keys = {'format', 'epochId', 'priorEpochId', 'inverse', 'source', 'readConfig', 'retainedHistoricalGenerationIds'}
    need(type(value) is dict and set(value) == keys and value['format'] == FORMAT + '-input' and value['epochId'] == epoch_id,
         'exact_named_fresh_forward_input_required')
    epoch_path(value['priorEpochId']); need(value['priorEpochId'] != epoch_id, 'new_epoch_cannot_reuse_old_inverse_namespace')
    read_refs(value['inverse'])
    source = value['source']; need(type(source) is dict and source.get('kind') == 'managed',
                                  'explicit_managed_writer_current_through_consumer_rehearsal_required')
    read_refs({k: v for k, v in source.items() if k != 'kind'})
    refs = value['readConfig']
    need(type(refs) is dict and set(refs) == {'admissionSha256', 'readPlanSha256', 'readContextInputSha256'} and
         all(pin(v) for v in refs.values()), 'actual_immutable143_graph_refs_required')
    ids = value['retainedHistoricalGenerationIds']
    need(type(ids) is list and len(ids) == 1 and isinstance(ids[0], str) and re.fullmatch('[1-9][0-9]*', ids[0]) and
         ids[0] != '103', 'explicit_original_first_native_retention_overlay_required')
    return copy.deepcopy(value)


def namespace(raw, expected, filename, constants=None, overrides=None, transform=None):
    """Compile reviewed bodies into NEW globals; never modify an old module."""
    need(sha(raw) == expected, 'exact_frozen_namespace_template_required')
    constants, overrides = constants or {}, overrides or {}
    tree = ast.parse(raw); found = set(); removed = set(); body = []; original = {}
    for node in tree.body:
        if isinstance(node, ast.If) and ast.unparse(node.test) == "__name__ == '__main__'": continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in constants:
                node.value = ast.parse(repr(constants[name]) if not isinstance(constants[name], Path) else
                                       'Path(' + repr(str(constants[name])) + ')', mode='eval').body
                found.add(name)
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            original[node.name] = sha(ast.dump(node, include_attributes=False).encode())
            if node.name in overrides: removed.add(node.name); continue
        if transform is not None: node = transform(node)
        body.append(node)
    need(found == set(constants) and removed == set(overrides), 'exact_explicit_namespace_seams_required')
    value = types.ModuleType('fresh_' + Path(filename).stem.replace('-', '_')); value.__file__ = str(filename)
    value.__dict__.update(overrides)
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), str(filename), 'exec'), value.__dict__)
    value.fresh_forward_reuse = {'templateSha256': expected, 'constants': sorted(found), 'overrides': sorted(removed),
                                'originalDefinitions': original, 'historicalModulePatched': False}
    return value


def identity_literals(function, replacements, counts):
    """Finite identity-only seam in an already NEW function namespace."""
    need(isinstance(function, types.FunctionType) and not function.__code__.co_freevars,
         'identity_seam_requires_no_hidden_old_closure')
    found = {key: 0 for key in replacements}
    def code_value(code):
        values = []
        for value in code.co_consts:
            if isinstance(value, types.CodeType): value = code_value(value)
            elif isinstance(value, str) and value in replacements:
                found[value] += 1; value = replacements[value]
            values.append(value)
        return code.replace(co_consts=tuple(values))
    code = code_value(function.__code__)
    need(found == counts, 'all_and_only_reviewed_public_identity_literals_required')
    return types.FunctionType(code, function.__globals__, function.__name__, function.__defaults__)


class Epoch:
    def __init__(self, epoch_id, input_sha, manifest_sha):
        self.id, self.base = epoch_id, epoch_path(epoch_id)
        self.input_sha, self.manifest_sha = input_sha, manifest_sha
        st = self.base.lstat()
        need(stat.S_ISDIR(st.st_mode) and st.st_uid == st.st_gid == 0 and stat.S_IMODE(st.st_mode) == 0o700,
             'exclusive_root_private_named_epoch_directory_required')
        need(all(stat.S_IMODE((self.base / name).lstat().st_mode) == 0o600 for name in ('input.json', 'manifest.json')),
             'private_immutable_actual_epoch_input_and_manifest_required')
        self.input = checked_input(document(self.base / 'input.json', input_sha), epoch_id)
        self.manifest = document(self.base / 'manifest.json', manifest_sha)
        need(set(self.manifest) == {'format', 'epochId', 'files', 'dependencies'} and
             self.manifest['format'] == FORMAT + '-sources' and self.manifest['epochId'] == self.id,
             'exact_named_factory_source_manifest_required')
        files, dependencies = self.manifest['files'], self.manifest['dependencies']
        need(type(files) is type(dependencies) is dict and set(files) == {Path(__file__).name, *WRAPPERS.values()} and
             set(dependencies) == set(ANCESTRY) | {INVERSE_OWNER, SOURCE_OWNER} and
             all(dependencies[k] == v for k, v in ANCESTRY.items()), 'fixed_factory_and_immutable_ancestry_closure_required')
        for name, digest in {**files, **dependencies}.items():
            need(re.fullmatch('[a-zA-Z0-9_.-]+', name) and pin(digest), 'finite_actual_factory_source_pin_required')
            protected(OPS / name, digest)
        need(files[Path(__file__).name] == sha(protected(Path(__file__).absolute())), 'actual_factory_core_producer_required')
        self._modules = {}; self._namespaces = {}
        self.ancestry = self.acknowledge()

    def load(self, name):
        need(name in self.manifest['dependencies'], 'fixed_external_factory_dependency_only')
        if name not in self._modules:
            path = OPS / name; raw = protected(path, self.manifest['dependencies'][name])
            value = types.ModuleType('epoch_dependency_' + name.replace('-', '_')); value.__file__ = str(path)
            exec(compile(raw, str(path), 'exec'), value.__dict__); self._modules[name] = value
        return self._modules[name]

    def acknowledge(self):
        refs = self.input['inverse']; owner = self.load(INVERSE_OWNER)
        value = owner.acknowledge_rehearsal_inverse(self.input['priorEpochId'], refs['resultSha256'], refs['manifestSha256'], refs['inputSha256'])
        need(value['validated'] is value['immutableRehearsalInverseAcknowledged'] is True and
             value['currentRestoredQualified'] is False and value['epochId'] == self.input['priorEpochId'] and
             value['inverseResultSha256'] == refs['resultSha256'], 'actual_completed_rehearsal_inverse_ancestry_required')
        need(value['historicalFirstNative']['id'] == self.input['retainedHistoricalGenerationIds'][0] and
             value['retainedGenerationActivation']['terminal'] is True, 'same_original_G0_and_terminal_activation_ancestry_required')
        return value

    def initial_current(self):
        refs = self.input['inverse']; owner = self.load(INVERSE_OWNER)
        value = owner.validate_rehearsal_inverse_leaf(self.input['priorEpochId'], refs['resultSha256'], refs['manifestSha256'], refs['inputSha256'])
        need(value['validated'] is value['currentRestoredQualified'] is True and
             value['inverseResultSha256'] == refs['resultSha256'], 'fresh_full_completed_inverse_before_first_effect_required')
        self.source_current(); return value

    def source_current(self):
        refs = self.input['source']; owner = self.load(SOURCE_OWNER)
        value = owner.validate_source_phase({'result_sha': refs['resultSha256'], 'manifest_sha': refs['manifestSha256'],
            'input_sha': refs['inputSha256']}, retained_current=lambda: retained_current(self))
        # The managed leaf owns actual current epoch/kernel/session authority.
        # Dataset identity is also compared; a successful foreign source leaf
        # cannot authorize this namespace.
        data = value.get('dataIdentity', value)
        need(value['validated'] is value['currentWriterQualified'] is value['sourceReadinessQualified'] is True and
             value['terminalInverseOnly'] is False and value['sourceState'] == 'acknowledged-active' and
             all(data.get(k) == v for k, v in DATA.items()) and len(value['nativeTables']) == 44,
             'same_actual_current_writer_and_registered_physical_dataset_required')
        return value

    def marker(self):
        return {'epochId': self.id, 'inputSha256': self.input_sha, 'manifestSha256': self.manifest_sha,
                'inverseResultSha256': self.input['inverse']['resultSha256'],
                'historicalFirstNativeGenerationId': self.input['retainedHistoricalGenerationIds'][0]}

    def raw(self, name): return protected(OPS / name, ANCESTRY[name])
    def filename(self, kind): return OPS / WRAPPERS[kind]
    def producer(self, kind): return self.manifest['files'][WRAPPERS[kind]]

    def metadata(self):
        if 'metadata' not in self._namespaces: self._namespaces['metadata'] = metadata_namespace(self)
        return self._namespaces['metadata']

    def generation(self):
        if 'generation' not in self._namespaces: self._namespaces['generation'] = generation_namespace(self)
        return self._namespaces['generation']

    def cache(self):
        if 'cache' not in self._namespaces: self._namespaces['cache'] = cache_namespace(self)
        return self._namespaces['cache']

    def readers(self):
        if 'readers' not in self._namespaces: self._namespaces['readers'] = readers_namespace(self)
        return self._namespaces['readers']

    def feature(self):
        if 'feature' not in self._namespaces: self._namespaces['feature'] = feature_namespace(self)
        return self._namespaces['feature']

    def validate_forward(self, reader_result_sha, cache_result_sha, feature_refs):
        return validate_forward(self, reader_result_sha, cache_result_sha, feature_refs)

    def reader_manifest(self): return reader_manifest(self)


def create_epoch(epoch_id, input_sha, manifest_sha): return Epoch(epoch_id, input_sha, manifest_sha)


def checked_marker(epoch, value):
    need(value == epoch.marker(), 'same_actual_inverse_and_fresh_epoch_operation_required')
    epoch.acknowledge()


def approval_predecessor(epoch, approval):
    expected = epoch.ancestry['metadata']['blockedApproval']
    need(type(expected) is dict and expected.get('state') == 'blocked' and
         expected.get('error_code') == 'owned_metadata_inverse', 'actual_owned_inverse_blocked_approval_required')
    return approval == expected


def metadata_namespace(epoch):
    old = 'ypal-restored-metadata-handover-v1.py'; changes = {'approval': 0, 'terminal': 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name in {'review', 'adopt'}:
            for compare in [v for v in ast.walk(node) if isinstance(v, ast.Compare)]:
                if ast.unparse(compare) == "db['approval'] is None":
                    compare.left = ast.parse("approval_predecessor(h, db['approval'])", mode='eval').body
                    compare.ops, compare.comparators = [ast.Is()], [ast.Constant(True)]; changes['approval'] += 1
        if isinstance(node, ast.ClassDef) and node.name == 'Host':
            terminal = next(v for v in node.body if isinstance(v, ast.FunctionDef) and v.name == 'terminal')
            for call in [v for v in ast.walk(terminal) if isinstance(v, ast.Call) and ast.unparse(v.func) == 'need']:
                if len(call.args) == 2 and isinstance(call.args[1], ast.Constant) and call.args[1].value == 'new_unattributed_shared_role_backend_requires_readonly_reconciliation':
                    need(ast.unparse(call.args[0]) == "all((r in sessions['otherPeers'] for r in rows))", 'exact_old_shared_other_peer_subset_guard_required')
                    call.args[0] = ast.parse('terminal_source_current()', mode='eval').body
                    call.args[1] = ast.Constant('current_source_must_remain_qualified_around_owned_metadata_drain')
                    changes['terminal'] += 1
        return node
    base = epoch.base / 'metadata'
    ns = namespace(epoch.raw(old), ANCESTRY[old], epoch.filename('metadata'), {
        'FORMAT': FORMAT + '-metadata', 'BASE': base,
        'DROP': Path('/etc/systemd/system/yunipals-metadata.service.d') /
                ('zzzzzzzzzzzzzzzzzzzzzzzz-fresh-' + epoch.id + '.conf'),
        'INPUT': epoch.base / 'input.json', 'SOURCES': epoch.base / 'manifest.json',
        'PROVIDER': epoch.filename('cache')
    }, {'execution_context': lambda h, refs: execution_context(epoch, h, refs),
        'cli_context': lambda input_sha, inverse=False: metadata_context(epoch, input_sha, inverse)}, transform)
    need(changes == {'approval': 2, 'terminal': 1}, 'exact_owned_inverse_approval_and_positive_owned_metadata_drain_seams_required')
    ns.approval_predecessor = lambda h, approval: approval_predecessor(epoch, approval)
    ns.terminal_source_current = lambda: epoch.source_current()['currentWriterQualified'] is True
    old_review, old_operation, old_adopt = ns.review, ns.operation, ns.adopt
    def review(host):
        initial = epoch.initial_current()
        binding, db = old_review(host)
        need(db['scan']['ingestion_mode'] == 'rpc' and approval_predecessor(epoch, db['approval']),
             'same_actual_owned_blocked_predecessor_at_fresh_metadata_review')
        binding.update(freshForwardEpoch=epoch.marker(), oldApproval=copy.deepcopy(db['approval']),
                       inverseMetadataRef=copy.deepcopy(epoch.ancestry['metadata']['inverseRef']),
                       initialRestoredBindingSha256=sha(encoded(epoch.ancestry)))
        return binding, db
    def operation(host, digest):
        value = old_operation(host, digest); checked_marker(epoch, value['freshForwardEpoch'])
        need(approval_predecessor(epoch, value['oldApproval']) and
             value['inverseMetadataRef'] == epoch.ancestry['metadata']['inverseRef'], 'actual_prior_metadata_inverse_chain_required')
        return value
    def adopt(host, op):
        checked_marker(epoch, op['freshForwardEpoch'])
        need(host.database()['approval'] == op['oldApproval'], 'blocked_approval_changed_after_new_drain')
        return old_adopt(host, op)
    ns.review, ns.operation, ns.adopt = review, operation, adopt
    ns.epoch = epoch
    ns.context = lambda: metadata_context(epoch, epoch.input_sha)
    return ns


def execution_context(epoch, host, refs):
    need(refs == {'inputSha256': epoch.input_sha, 'sourcesSha256': epoch.manifest_sha} and
         document(epoch.base / 'input.json', epoch.input_sha) == epoch.input and
         document(epoch.base / 'manifest.json', epoch.manifest_sha) == epoch.manifest and
         host.read_config == epoch.input['readConfig'], 'same_exclusive_fresh_epoch_metadata_execution_context_required')
    return dict(refs)


def metadata_refresh(epoch, read_config):
    provider = epoch.cache(); config = {'readAdmissionSha256': read_config['admissionSha256'], **read_config}
    _, _, host, _, _, rehearsal = provider.static_read_host(config)
    def refresh():
        expected = rehearsal['after']; first = host.catalog()
        need(host._factory_read.graph(first) == host._factory_read.graph(expected), 'exact143_before_fresh_cache_admission_required')
        source = epoch.source_current()
        need(host.catalog() == first, 'catalog_changed_during_fresh_epoch_current_writer_check')
        return {'validated': True, 'readAdmissionSha256': read_config['admissionSha256'],
                'readPlanSha256': read_config['readPlanSha256'], 'readContextInputSha256': read_config['readContextInputSha256'],
                'sourceBinding': source, 'originalWholeValidatorPassed': False,
                'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    return refresh


def metadata_context(epoch, input_sha, inverse=False):
    need(input_sha == epoch.input_sha and inverse is False, 'fresh_forward_metadata_context_not_a_descendant_inverse_owner')
    ns = epoch.metadata(); config = epoch.input['readConfig']
    r = epoch.load('ypal-restored-read-admission-v1.py')
    ref = {'producerFile': str(OPS / 'ypal-restored-read-admission-v1.py'),
           'producerSha256': ANCESTRY['ypal-restored-read-admission-v1.py'], 'resultFile': str(r.BASE / 'result.json'),
           'receiptSha256': config['admissionSha256'], 'planSha256': config['readPlanSha256'],
           'contextInputSha256': config['readContextInputSha256']}
    h = ns.construct_context(config, metadata_refresh(epoch, config), admission_ref=ref)
    h.execution_context = {'inputSha256': epoch.input_sha, 'sourcesSha256': epoch.manifest_sha}
    execution_context(epoch, h, h.execution_context); return h


def retained_generation(epoch, host, op=None):
    """Current terminal proof, never a current claim about historical PIDs."""
    activation = epoch.ancestry['retainedGenerationActivation']
    need(activation['originalProducerSha256'] == ANCESTRY['ypal-restored-generation-v1.py'] and
         activation['terminal'] is activation['bootLinkAbsent'] is activation['ownedOldProcessesGone'] is activation['ownedSessionsDrained'] is True,
         'accepted_original_terminal_generation_activation_required')
    parked = activation['parkedBoot']
    original = epoch.load('ypal-restored-generation-v1.py')
    need(parked['file'] == str(original.BASE / 'original-boot-link') and
         not os.path.lexists(original.BOOT) and host.meta.link(Path(parked['file'])) == parked['identity'],
         'same_retained_original_parked_boot_inode_and_absent_activation_required')
    old = host.s.document(original.BASE / 'operation.json', activation['originalOperationSha256'])
    need(old['operatorSha256'] == ANCESTRY['ypal-restored-generation-v1.py'] and old['oldBoot'] == parked['identity'],
         'exact_historical_generation_operation_and_boot_ancestry_required')
    host.private({'oldActor': old['oldActor']})
    value = host.state()
    need(value['MainPID'] == value['ControlPID'] == '0' and value['Job'] == '' and
         value['ActiveState'] in {'inactive', 'failed'} and value['UnitFileState'] == 'disabled' and value['WantedBy'] == '',
         'retained_original_generation_must_stay_terminal_disabled')
    cg = Path('/sys/fs/cgroup/system.slice') / original.LEADER / 'cgroup.procs'
    need(not cg.exists() or not cg.read_text().split(), 'retained_original_generation_cgroup_must_stay_empty')
    need(not any(host.meta.identity_alive(host.m, actor) for actor in old['oldActor']['processes']), 'retained_original_generation_processes_must_stay_gone')
    # Existing kernel attribution proves only old owned sessions gone. A
    # legitimate unrelated shared-role connection is not an owned writer.
    sessions = host.s.document(original.BASE / 'drain-sessions.json')['sessions']
    rows = host.h.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16388 AND datid=17584")
    need(not any(any(row['pid'] == prior['pid'] and row['backendStart'] == prior['backendStart'] for prior in sessions['owned']) for row in rows),
         'retained_original_generation_owned_backends_must_stay_gone')
    if op is not None:
        checked_marker(epoch, op['freshForwardEpoch'])
        need(op['retainedGenerationActivation'] == activation and op['oldActor'] == old['oldActor'], 'same_retained_terminal_generation_ancestry_required')
    return {'activation': activation, 'oldOperation': old, 'currentTerminalUnit': value,
            'definitionsSha256': sha(encoded(activation['definitions'])), 'currentObserved': True}


def capsule_reuse(epoch, ns, host, op):
    checked_marker(epoch, op['freshForwardEpoch']); ns.drained(host, op); host.qualify(); ns.capacity_preflight(host)
    prior = epoch.ancestry['originalCapsule']
    original = epoch.load('ypal-restored-generation-v1.py')
    need(prior['file'] == str(original.BASE / 'capsule-result.json'), 'only_original_retained_capsule_receipt_may_be_reused')
    receipt = host.s.document(Path(prior['file']), prior['sha256'])
    need(receipt['contextSha256'] == prior['contextSha256'] and receipt['archiveRelease'] == prior['archiveRelease'] and
         receipt['generationBindingSha256'] == prior['generationBindingSha256'], 'same_original_capsule_context_and_103_prior_archive_binding_required')
    verified = ns.read_bridge(host, 'verify-capsule', {'receipt': receipt}); observation = ns.read_only_capsule(host, receipt)
    intent = {'format': FORMAT + '-capsule-reuse', 'freshForwardEpoch': epoch.marker(), 'originalCapsule': prior,
              'operationSha256': sha(host.s.protected(ns.BASE / 'operation.json')), 'externalBindingSha256': host.external(op),
              'capsuleRecaptured': False, 'databaseWrites': 0}
    need(not (ns.BASE / 'capsule-reuse-intent.json').exists(), 'capsule_reuse_unknown_ACK_must_not_be_repeated')
    host.s.save(ns.BASE / 'capsule-reuse-intent.json', intent)
    need(ns.read_only_capsule(host, receipt) == observation, 'retained_capsule_context_changed_before_reuse_ACK')
    host.s.save(ns.BASE / 'capsule-result.json', receipt)
    return host.s.save(ns.BASE / 'capsule-reuse-result.json', {**intent, 'reused': True,
        'capsuleResultSha256': sha(host.s.protected(ns.BASE / 'capsule-result.json')),
        'verificationSha256': sha(encoded(verified)), 'observationSha256': sha(encoded(observation))})


def historical_generation_current(epoch, query):
    expected = epoch.ancestry['historicalFirstNative']; generation_id = expected['id']
    need(generation_id == epoch.input['retainedHistoricalGenerationIds'][0] and
         re.fullmatch('[1-9][0-9]*', generation_id) and all(pin(expected[k]) for k in
             ('rowSqlSha256', 'immutableSqlSha256', 'publicationSha256')), 'exact_actual_historical_G0_identity_required')
    value = query("SELECT jsonb_build_object('id',g.id::text,'rowSqlSha256',encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex'),"
        "'immutableSqlSha256',encode(sha256(convert_to((to_jsonb(g)-'state'-'retired_at')::text,'UTF8')),'hex'),"
        "'sourceSnapshot',g.validation->'sourceSnapshot')FROM metadata_projection.generation g WHERE g.id=" + generation_id)
    need(value == {k: expected[k] for k in ('id', 'rowSqlSha256', 'immutableSqlSha256', 'sourceSnapshot')},
         'retained_historical_G0_row_and_original_source_snapshot_must_remain_exact')
    return value


def generation_namespace(epoch):
    old = 'ypal-restored-generation-v1.py'; base = epoch.base / 'generation'
    unit = 'yunipals-ypal-fresh-' + epoch.id + '-prepare.service'
    runtime = 'yunipals-ypal-fresh-' + epoch.id + '-prepare'
    work = Path('/run') / runtime
    monitor_name = 'ypal-restored-generation-capacity-watch-v1.py'
    monitor_sha = 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6'
    app = 'yunipals_ypal_fresh_' + sha(epoch.id.encode())[:20] + '_prepare'
    monitor_raw = protected(OPS / monitor_name, monitor_sha)
    old_monitor = epoch.load(monitor_name)
    monitor = namespace(monitor_raw, monitor_sha, epoch.filename('generation'), {
        'UNIT': unit, 'WORK': work, 'APP': app,
        'ENV_FILES': (*old_monitor.ENV_FILES[:-1], str(base / 'generation.public.env'))
    })
    replacements = {'candidate': 0, 'ids': 0, 'app': 0, 'runtime': 0, 'command': 0, 'retention-ack': 0}
    command = '/usr/bin/python3 -I -B ' + str(epoch.filename('generation')) + ' --monitor --epoch ' + epoch.id + \
              ' --epoch-input-sha ' + epoch.input_sha + ' --epoch-manifest-sha ' + epoch.manifest_sha
    def transform(node):
        if isinstance(node, ast.FunctionDef):
            if node.name in {'accept_candidate', 'validate_candidate_database_current'}:
                for value in ast.walk(node):
                    if isinstance(value, ast.Constant) and value.value == 'yunipals-ypal-restored-generation-candidate-v1':
                        value.value = FORMAT + '-generation-candidate'; replacements['candidate'] += 1
                if node.name == 'accept_candidate':
                    result = [v for v in node.body if isinstance(v, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'result' for t in v.targets)]
                    need(len(result) == 1 and isinstance(result[0].value, ast.Dict), 'one_inherited_candidate_result_required')
                    for key, expression in {
                        'freshForwardEpoch': 'fresh_epoch_marker()',
                        'retentionOverlaySha256': "sha(h.s.protected(BASE/'retention-overlay-result.json'))",
                        'capsuleReuseResultSha256': "sha(h.s.protected(BASE/'capsule-reuse-result.json'))"
                    }.items():
                        result[0].value.keys.append(ast.Constant(key)); result[0].value.values.append(ast.parse(expression, mode='eval').body)
            if node.name == 'worker_terminal':
                for value in ast.walk(node):
                    if isinstance(value, ast.Constant) and value.value == 'yunipals_ypal_restored_generation_prepare_20261024':
                        value.value = app; replacements['app'] += 1
            if node.name == 'unit_bytes':
                for row in node.body:
                    if isinstance(row, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'runtime' for t in row.targets):
                        row.value = ast.Constant(runtime); replacements['runtime'] += 1
                    if isinstance(row, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'command' for t in row.targets):
                        row.value = ast.Constant(command); replacements['command'] += 1
            if node.name == 'build':
                body = []
                for row in node.body:
                    if isinstance(row, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'ids' for t in row.targets):
                        need(ast.unparse(row.value) == "capsule['preservedGenerations']", 'exact_old_capsule_selector_ancestry_required')
                        row.value = ast.parse("retention_ids(capsule['preservedGenerations'])", mode='eval').body; replacements['ids'] += 1
                    body.append(row)
                    if isinstance(row, ast.Expr) and isinstance(row.value, ast.Call) and ast.unparse(row.value) == 'h.s.save(path, raw)':
                        body.append(ast.parse('acknowledge_retention_overlay(h, raw)').body[0]); replacements['retention-ack'] += 1
                node.body = body
        return node
    ns = namespace(epoch.raw(old), ANCESTRY[old], epoch.filename('generation'), {
        'FORMAT': FORMAT + '-generation', 'BASE': base, 'META_BASE': epoch.base / 'metadata',
        'META_FILE': epoch.filename('metadata'), 'META_SHA': epoch.producer('metadata'),
        'MONITOR': epoch.filename('generation'), 'MONITOR_SHA': epoch.producer('generation'), 'UNIT': unit, 'WORK': work
    }, transform=transform)
    need(replacements == {'candidate': 2, 'ids': 1, 'app': 1, 'runtime': 1, 'command': 1, 'retention-ack': 1}, 'exact_generation_retention_runtime_and_candidate_seams_required')
    old_module, old_host = ns.module, ns.Host
    def module(path, digest):
        if path == ns.META_FILE:
            need(digest == epoch.producer('metadata'), 'actual_fresh_metadata_producer_required'); return epoch.metadata()
        if path == ns.MONITOR:
            need(digest == epoch.producer('generation'), 'actual_fresh_monitor_producer_required'); return monitor
        return old_module(path, digest)
    ns.module = module
    class Host(old_host):
        def terminal(self, op): return retained_generation(epoch, self, op)['currentTerminalUnit']
        def actor(self):
            raise RuntimeError('retained_terminal_generation_cannot_be_claimed_current_active')
    ns.Host = Host
    def review(host):
        host.qualify(); ns.capacity_preflight(host); retained = retained_generation(epoch, host)
        historical_generation_current(epoch, host.h.query)
        need(not os.path.lexists(base) and host.state(unit)['LoadState'] == 'not-found', 'fresh_named_generation_operation_and_unit_required')
        current = host.context()
        need(current['generation']['id'] == '103' and current['generation']['state'] == 'ready' and
             current['generation']['ownership_release_id'] is None and current['generation']['ownership_read_identity'] is None and
             current['ready'] is True, 'fresh_actual_original103_and_all_four_sources_ready_required')
        old_op = retained['oldOperation']
        return {'format': ns.FORMAT, 'operatorSha256': epoch.producer('generation'), 'bootId': host.s.boot(),
            'readAdmissionSha256': host.args.read_ack, 'readConfig': host.h.read_config,
            'metadataInputSha256': host.args.metadata_input_sha, 'metadataOperatorSha256': epoch.producer('metadata'),
            'historicalGenerationProducerSha256': ns.TEMPLATE_SHA, 'metadataOperationSha256': host.args.metadata_operation,
            'metadataSelectedSha256': host.args.metadata_selected, 'metadataProvenanceFile': host.args.metadata_provenance,
            'metadataProvenanceSha256': host.args.metadata_provenance_sha, 'candidateSha256': ns.CANDIDATE_SHA,
            'installSha256': host.args.install_ack, 'artifactDigest': host.installer.DIGEST,
            'oldActor': old_op['oldActor'], 'oldBoot': old_op['oldBoot'], 'consumerFence': host.consumers(),
            'context': current, 'executionFiles': {str(p): sha(host.m.protected(p)) for p in [ns.MONITOR, ns.CAPSULE, ns.GUARD]},
            'freshForwardEpoch': epoch.marker(), 'retainedGenerationActivation': retained['activation'],
            'retainedTerminalObservation': retained, 'historicalActorClaimedCurrent': False}
    def drained(host, op):
        retained_generation(epoch, host, op)
        need(host.s.document(base / 'terminal-predecessor-observed.json')['freshForwardEpoch'] == epoch.marker(),
             'new_actual_terminal_predecessor_observation_required')
    def drain(host, binding):
        need(not os.path.lexists(base), 'exclusive_fresh_generation_operation_required')
        host.qualify(); retained = retained_generation(epoch, host)
        need(retained == binding['retainedTerminalObservation'], 'retained_terminal_predecessor_changed_after_review')
        base.mkdir(mode=0o700); host.s.sync(base.parent)
        digest = host.s.save(base / 'operation.json', binding)
        host.s.save(base / 'terminal-predecessor-observed.json', {'freshForwardEpoch': epoch.marker(),
            'operationSha256': digest, 'retained': retained, 'serviceActions': 0, 'bootMoved': False})
        drained(host, binding); host.s.save(base / 'drained.json', {'operationSha256': digest, 'stopped': True,
            'alreadyTerminalAuthenticated': True, 'newStopIssued': False}); return digest
    old_operation, old_build, old_accept = ns.operation, ns.build, ns.accept_candidate
    old_candidate_current = ns.validate_candidate_database_current
    def operation(host, digest):
        value = old_operation(host, digest); checked_marker(epoch, value['freshForwardEpoch'])
        retained_generation(epoch, host, value); return value
    def retention_ids(ids):
        need(type(ids) is list and ids and ids[0] == '103' and len(ids) == len(set(ids)), 'original_capsule_selector_must_remain_explicit')
        result = list(ids)
        for item in epoch.input['retainedHistoricalGenerationIds']:
            if item not in result: result.append(item)
        return result
    def build(host, op):
        drained(host, op)
        historical_generation_current(epoch, host.h.query)
        reuse = host.s.document(base / 'capsule-reuse-result.json')
        need(reuse['reused'] is True and reuse['freshForwardEpoch'] == epoch.marker() and reuse['capsuleRecaptured'] is False and
             reuse['capsuleResultSha256'] == sha(host.s.protected(base / 'capsule-result.json')), 'acknowledged_original_capsule_reuse_before_build_required')
        receipt = host.s.document(base / 'capsule-result.json'); ids = retention_ids(receipt['preservedGenerations'])
        overlay = {'format': FORMAT + '-retention-overlay', 'freshForwardEpoch': epoch.marker(),
            'originalCapsuleSha256': epoch.ancestry['originalCapsule']['sha256'],
            'immutableCapsuleSelector': receipt['preservedGenerations'], 'additionallyRetainedHistoricalGenerationIds': epoch.input['retainedHistoricalGenerationIds'],
            'effectivePreserveGenerationIds': ids, 'originalSelectorClaimedUnchanged': False}
        need(not (base / 'retention-overlay-intent.json').exists(), 'unknown_retention_or_build_ACK_must_not_be_repeated')
        host.s.save(base / 'retention-overlay-intent.json', overlay)
        return old_build(host, op)
    def acknowledge_retention_overlay(host, raw):
        intent = host.s.document(base / 'retention-overlay-intent.json')
        need(intent['freshForwardEpoch'] == epoch.marker() and host.s.protected(base / 'generation.public.env') == raw,
             'actual_public_selector_bytes_required_before_retention_ACK')
        parsed = host.m.parse_env(raw)
        need(parsed == {'PROJECTION_PRESERVE_GENERATION_IDS': ','.join(intent['effectivePreserveGenerationIds']),
            'OFFCHAIN_DB_POOL_MAX': '4', 'PROJECTION_BACKUP_PEAK_BYTES': '0', 'PROJECTION_MIN_FREE_BYTES': '25000000000',
            'PROJECTION_STORAGE_PATH': '/'}, 'exact_retention_overlay_without_capacity_or_pool_relaxation_required')
        return host.s.save(base / 'retention-overlay-result.json', {**intent, 'appliedToNewBuildOnly': True, 'publicEnvSha256': sha(raw)})
    def accept_candidate(host, op):
        # The inherited builder/DB/exit/capacity checks run unchanged; additions
        # are inserted into its one result before the exclusive save.
        historical_generation_current(epoch, host.h.query)
        return old_accept(host, op)
    ns.review, ns.drain, ns.drained, ns.operation = review, drain, drained, operation
    ns.retention_ids, ns.build, ns.accept_candidate = retention_ids, build, accept_candidate
    ns.fresh_epoch_marker = epoch.marker
    ns.acknowledge_retention_overlay = acknowledge_retention_overlay
    ns.reuse_capsule = lambda host, op: capsule_reuse(epoch, ns, host, op)
    def authenticate_candidate_records(digest):
        candidate = document(base / 'candidate-result.json', digest)
        need(candidate['format'] == FORMAT + '-generation-candidate' and candidate['operatorSha256'] == epoch.producer('generation') and
             candidate['metadataOperatorSha256'] == epoch.producer('metadata') and candidate['metadataInputSha256'] == epoch.input_sha and
             candidate['readConfig'] == epoch.input['readConfig'], 'same_named_epoch_candidate_producer_metadata_and_READ_refs_required')
        checked_marker(epoch, candidate['freshForwardEpoch'])
        operation = document(base / 'operation.json', candidate['operationSha256'])
        checked_marker(epoch, operation['freshForwardEpoch'])
        need(operation['retainedGenerationActivation'] == epoch.ancestry['retainedGenerationActivation'],
             'candidate_must_link_actual_retained_terminal_generation_ancestry')
        capsule = document(base / 'capsule-result.json', candidate['capsuleResultSha256'])
        original = epoch.ancestry['originalCapsule']
        need(capsule == document(Path(original['file']), original['sha256']), 'byte_equal_original_capsule_semantics_required')
        reuse = document(base / 'capsule-reuse-result.json', candidate['capsuleReuseResultSha256'])
        reuse_intent = document(base / 'capsule-reuse-intent.json', sha(protected(base / 'capsule-reuse-intent.json')))
        need(reuse['freshForwardEpoch'] == epoch.marker() and reuse['originalCapsule'] == original and
             reuse['operationSha256'] == candidate['operationSha256'] and reuse['capsuleResultSha256'] == candidate['capsuleResultSha256'] and
             reuse['reused'] is True and reuse['capsuleRecaptured'] is False and
             {k: v for k, v in reuse.items() if k not in {'reused', 'capsuleResultSha256', 'verificationSha256', 'observationSha256'}} == reuse_intent,
             'actual_named_capsule_reuse_intent_and_ACK_chain_required')
        overlay = document(base / 'retention-overlay-result.json', candidate['retentionOverlaySha256'])
        intent = document(base / 'retention-overlay-intent.json', sha(protected(base / 'retention-overlay-intent.json')))
        need(overlay == {**intent, 'appliedToNewBuildOnly': True, 'publicEnvSha256': sha(protected(base / 'generation.public.env'))} and overlay['freshForwardEpoch'] == epoch.marker() and
             overlay['immutableCapsuleSelector'] == capsule['preservedGenerations'] and
             overlay['additionallyRetainedHistoricalGenerationIds'] == epoch.input['retainedHistoricalGenerationIds'] and
             overlay['effectivePreserveGenerationIds'] == retention_ids(capsule['preservedGenerations']) and
             overlay['originalSelectorClaimedUnchanged'] is False, 'actual_named_additive_retention_overlay_chain_required')
        return candidate
    def candidate_current(digest):
        candidate = authenticate_candidate_records(digest)
        value = old_candidate_current(digest)
        parts = ns.module(ns.STATIC, ns.STATIC_SHA).query_components()
        historical_generation_current(epoch, parts['readerHost'].query)
        return {**value, 'freshForwardEpoch': candidate['freshForwardEpoch'], 'originalCapsuleReused': True,
                'historicalG0RetainedAdditionally': True}
    ns.authenticate_candidate_records, ns.validate_candidate_database_current = authenticate_candidate_records, candidate_current
    ns.restore_activation = lambda *_a, **_k: need(False, 'fresh_epoch_must_not_restart_retained_original_generation_activation')
    ns.monitor, ns.epoch = monitor, epoch
    return ns


class CurrentReadHost:
    """A new source-dependent facade, never success returned by an old gate."""
    def __init__(self, host, read, epoch): self._host, self._factory_read, self.epoch = host, read, epoch
    def __getattr__(self, name): return getattr(self._host, name)
    def runtime(self): return stable_source(self.epoch.source_current())


def stable_source(value):
    keys = ['format', 'receiptSha256', 'operatorSha256', 'sourceRelease', 'manifestHash', 'schema', 'schemaOid', 'buildId',
            'currentWriterQualified']
    # Exact current actors/epoch receipts are authority. Fresh heartbeat/head
    # values are observations and may advance between the two scope captures.
    keys += [key for key in ['operationSha256', 'currentEpochReceiptSha256', 'currentManagedEpoch', 'source', 'nativeTables',
                             'transportFactorySha256', 'hostBuildReceiptSha256', 'poolMaximum'] if key in value]
    return {key: copy.deepcopy(value[key]) for key in keys}


def cache_namespace(epoch):
    old = 'ypal-restored-read-cache-provider-v1.py'; counts = {'meta': 0, 'preservation': 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == 'cache_runtime':
            for value in ast.walk(node):
                if isinstance(value, ast.Constant) and value.value == "Path('/var/backups/yunipals-ypal-restored-metadata-handover-v1-20261024')":
                    value.value = 'Path(' + repr(str(epoch.base / 'metadata')) + ')'; counts['meta'] += 1
        if isinstance(node, ast.FunctionDef) and node.name == 'current_reads':
            for value in ast.walk(node):
                if isinstance(value, ast.Constant) and value.value == 'restoredSourceEpochQualified':
                    value.value = 'freshForwardSourceEpochQualified'; counts['preservation'] += 1
        return node
    ns = namespace(epoch.raw(old), ANCESTRY[old], epoch.filename('cache'), {
        'FORMAT': FORMAT + '-cache', 'BASE': epoch.base / 'cache', 'INPUT': epoch.base / 'cache-input.json',
        'METADATA': epoch.filename('metadata'), 'METADATA_SHA': epoch.producer('metadata'),
        'GENERATION_OWNER': epoch.filename('generation'), 'GENERATION_SHA': epoch.producer('generation'),
        'GENERATION': epoch.base / 'generation/candidate-result.json', 'GENERATION_FORMAT': FORMAT + '-generation-candidate'
    }, transform=transform)
    need(counts == {'meta': 1, 'preservation': 1}, 'exact_cache_metadata_path_and_new_source_proof_domain_required')
    old_dependency, old_static, old_current, old_cache_runtime = ns.dependency, ns.static_read_host, ns.current_reads, ns.cache_runtime
    def dependency(path, digest):
        for kind in ('metadata', 'generation'):
            if path == epoch.filename(kind):
                need(digest == epoch.producer(kind), 'actual_same_epoch_phase_producer_required')
                return getattr(epoch, kind)()
        return old_dependency(path, digest)
    def static_read_host(config):
        read, static, host, receipt, before, rehearsal = old_static(config)
        return read, static, CurrentReadHost(host, read, epoch), receipt, before, rehearsal
    def current_reads(host, cache_reads=False, enabled=False, expected_catalog=None, inverse=False):
        need(inverse is False, 'descendant_inverse_requires_the_distinct_recurring_owner')
        value = old_current(host, cache_reads, enabled, expected_catalog, False)
        return {**value, 'freshForwardEpoch': epoch.marker(), 'oldRestoredActorClaimedCurrent': False}
    ns.dependency, ns.static_read_host, ns.current_reads = dependency, static_read_host, current_reads
    def cache_runtime():
        value = old_cache_runtime()
        value.DROP = Path('/etc/systemd/system') / (value.UNIT + '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-fresh-' + epoch.id + '.conf')
        return value
    ns.cache_runtime = cache_runtime
    ns.metadata_refresh = lambda config, inverse=False: (
        need(not inverse, 'fresh_forward_metadata_refresh_cannot_authorize_descendant_inverse') or metadata_refresh(epoch, config))
    old_phase = ns.Phase
    class Phase(old_phase):
        def generation(self):
            result = super().generation()
            epoch.generation().authenticate_candidate_records(self.host.config['generationSha256'])
            return result
    ns.Phase = Phase
    ns.epoch = epoch
    return ns


def reader_manifest(epoch):
    """Deterministic NEW manifest, materialized separately before construction."""
    value = json.loads(epoch.raw('ypal-native-cutover-v2.manifest.json'))
    for name, digest in list(value['files'].items()):
        if name.endswith('.py'):
            value['dependencies'][name] = digest; del value['files'][name]
    value['files'].update({WRAPPERS[k]: epoch.producer(k) for k in ('readers', 'cache')})
    value['dependencies'].update(epoch.manifest['dependencies'])
    value['dependencies'].update(epoch.manifest['files'])
    for name in value['files']: value['dependencies'].pop(name, None)
    value['format'] = FORMAT + '-readers-sources'
    value['freshForwardEpoch'] = epoch.marker()
    for role, name in {'read': 'ypal-restored-managed-handover-v1.py', 'phase': WRAPPERS['cache'],
                       'metadata': WRAPPERS['metadata']}.items():
        value['contexts'][role] = {'file': name, 'sha256': {**value['dependencies'], **value['files']}[name]}
    return value


def reader_proof(epoch):
    """NEW current phase facade over the exact source-free cf4b/9ab bodies."""
    old = 'ypal-native-cutover-proof-v2.py'; expected_manifest = reader_manifest(epoch)
    manifest_sha = sha(encoded(expected_manifest)); path = epoch.base / 'reader-manifest.json'
    need(document(path, manifest_sha) == expected_manifest, 'actual_materialized_exact_fresh_reader_manifest_required')
    proof_ns = namespace(epoch.raw(old), ANCESTRY[old], epoch.filename('readers'), {
        'FORMAT': FORMAT + '-reader-proof', 'BASE': epoch.base / 'readers', 'MANIFEST': path
    }, {'manifest_contract': lambda value: (
        need(value == expected_manifest, 'exact_fresh_reader_manifest_contract_required') or value)})
    original_proof = proof_ns.Proof
    class Proof(original_proof):
        def __init__(self):
            super().__init__(manifest_sha)
            old_context = self.Context; owner = self
            class Context(old_context):
                def generation_terminal(self):
                    generation, candidate, op, _ = self.generation()
                    primitives = self.phase.metadata_primitives(); metadata = epoch.metadata()
                    mh = metadata.construct_context(primitives['readConfig'], lambda: owner.metadata_refresh(self, False),
                        primitives=primitives, admission_ref=primitives['admission_ref'])
                    gh = generation.Host.__new__(generation.Host)
                    gh.meta, gh.h, gh.s, gh.m = metadata, mh, mh.s, mh.m
                    retained_generation(epoch, gh, op)
                    state = generation.worker_terminal(gh, generation.UNIT, generation.WORK)
                    return {'candidateOperationSha256': candidate['operationSha256'],
                            'units': {generation.LEADER: 'retained-terminal', generation.UNIT: state},
                            'recurringGenerationStarted': False, 'retainedOriginalBootAcknowledged': True}
                def inverse_scope(self, cache_reads=True):
                    raise RuntimeError('fresh_reader_descendant_inverse_requires_distinct_recurring_owner')
            self.Context = Context
        def module(self, name, digest):
            need(self.pins.get(name) == digest, 'same_manifest_bound_fresh_reader_component_required')
            for kind in ('metadata', 'generation', 'cache'):
                if name == WRAPPERS[kind]:
                    need(digest == epoch.producer(kind), 'same_actual_fresh_phase_wrapper_required'); return getattr(epoch, kind)()
            return super().module(name, digest)
        def module_context(self, role):
            if role == 'read':
                def runtime():
                    value = stable_source(epoch.source_current())
                    need(len(value['nativeTables']) == 44, 'all44_current_native_identities_required')
                    return {**value, 'nativeTableIdentities': value['nativeTables']}
                return types.SimpleNamespace(validate_runtime=runtime)
            if role == 'phase': return epoch.cache()
            if role == 'metadata': return epoch.metadata()
            return super().module_context(role)
        def generation_args(self, context):
            config = context.prepared['config']; candidate = context.phase.generation()[1]
            return types.SimpleNamespace(read_ack=config['readAdmissionSha256'], install_ack=candidate['installSha256'],
                metadata_input_sha=epoch.input_sha, metadata_operation=candidate['metadataOperationSha256'],
                metadata_selected=config['metadataSelectionSha256'], metadata_provenance=config['metadataProvenanceFile'],
                metadata_provenance_sha=config['metadataProvenanceSha256'], phase=None)
        def inverse_scope(self, *_a, **_k):
            raise RuntimeError('fresh_reader_descendant_inverse_requires_distinct_recurring_owner')
    proof = Proof()
    # Retained login admission bodies must authenticate the NEW wrapper/result
    # domain. Only these two producer literals change, never the role delta.
    method = proof.pure.SourceIndependentReaderMethods.logins_enabled
    old_name, old_format = 'ypal-native-cutover-v2.py', 'yunipals-ypal-native-cutover-v2'
    proof.pure.SourceIndependentReaderMethods.logins_enabled = identity_literals(method,
        {old_name: WRAPPERS['readers'], old_format: FORMAT + '-readers'}, {old_name: 1, old_format: 1})
    preview_prefix = 'yunipals-ypal-fresh-' + epoch.id + '-preview-'
    proof.pure.preview_unit = identity_literals(proof.pure.preview_unit,
        {'yunipals-ypal-native-preview-v1-': preview_prefix}, {'yunipals-ypal-native-preview-v1-': 1})
    proof.pure.render_reader = identity_literals(proof.pure.render_reader,
        {'ypal-native-cutover-v1-': 'ypal-fresh-' + epoch.id + '-',
         '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-native-v1.conf': '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-fresh-' + epoch.id + '.conf'},
        {'ypal-native-cutover-v1-': 1, '.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-native-v1.conf': 1})
    return proof


def readers_namespace(epoch):
    """Unchanged 950b publication/probe wire; named root/proof/finish journals."""
    code = epoch.load('ypal-native-cutover-v2.py'); manifest = reader_manifest(epoch)
    proof = reader_proof(epoch)
    cloned = namespace(epoch.raw('ypal-native-cutover-v2.py'), ANCESTRY['ypal-native-cutover-v2.py'], epoch.filename('readers'), {
        'FORMAT': FORMAT + '-readers', 'BASE': epoch.base / 'readers',
        'MANIFEST': epoch.base / 'reader-manifest.json', 'PROOF': WRAPPERS['readers']
    })
    root = cloned.assemble(protected(code.TEMPLATE, code.TEMPLATE_SHA), proof)
    # assemble's fixed v2 manifest pathname is an identity seam only. It is
    # overridden in this new namespace with the already authenticated manifest.
    root.MANIFEST = epoch.base / 'reader-manifest.json'
    root.PUBLICATION = root.BASE / 'publication'
    root.manager = identity_literals(root.manager,
        {'yunipals-ypal-native-preview-v1-': 'yunipals-ypal-fresh-' + epoch.id + '-preview-'},
        {'yunipals-ypal-native-preview-v1-': 1})
    def cache_finish_module(controller, context):
        need(controller is root and context.proof is proof, 'same_fresh_epoch_reader_context_required')
        return cache_finish_namespace(epoch, controller, proof)
    proof.cache_finish_module = cache_finish_module
    root.epoch, root.proof = epoch, proof
    root.core = lambda digest: (need(digest == proof.manifest_sha, 'same_actual_fresh_reader_manifest_required') or root)
    root.finish = lambda: cache_finish_namespace(epoch, root, proof)
    return root


def cache_finish_namespace(epoch, root, proof):
    old = 'ypal-cache-finish-v3.py'; changes = 0
    def transform(node):
        nonlocal changes
        if isinstance(node, ast.FunctionDef) and node.name == 'assemble':
            for value in ast.walk(node):
                if isinstance(value, ast.Constant) and value.value == "OPS / 'ypal-native-cutover-v2.manifest.json'":
                    value.value = 'Path(' + repr(str(epoch.base / 'reader-manifest.json')) + ')'; changes += 1
        return node
    code = namespace(epoch.raw(old), ANCESTRY[old], epoch.filename('cache'), {
        'FORMAT': FORMAT + '-cache-finish', 'BASE': epoch.base / 'cache-finish'
    }, transform=transform)
    need(changes == 1, 'one_fresh_cache_finish_manifest_identity_seam_required')
    return code.runtime(root, proof)


def source_kernel_actors(value):
    actor = value['currentManagedEpoch'] if 'currentManagedEpoch' in value else value['source']
    need(type(actor) is dict and set(actor) >= {'unit', 'parent', 'processes'} and
         actor['unit']['MainPID'] == str(actor['parent']['pid']) and actor['unit']['Id'] in
         {'yunipals-indexer.service', 'yunipals-ypal-combined-source.service'},
         'actual_current_source_unit_and_SDK_kernel_tree_required')
    return {actor['unit']['Id']: actor}


def feature_namespace(epoch):
    """New feature constructor/producer, exact e506 operational bodies."""
    context_old = 'ypal-restored-feature-context-v1.py'; owner_old = 'ypal-restored-feature-handover-v1.py'
    literal_changes = {'reader': 0, 'reader-format': 0, 'cache': 0}
    def context_transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == 'reader_ancestry':
            for value in ast.walk(node):
                if isinstance(value, ast.Constant) and value.value == 'ypal-native-cutover-v2.py':
                    value.value = WRAPPERS['readers']; literal_changes['reader'] += 1
                if isinstance(value, ast.Constant) and value.value == 'yunipals-ypal-native-cutover-v2':
                    value.value = FORMAT + '-readers'; literal_changes['reader-format'] += 1
        if isinstance(node, ast.FunctionDef) and node.name == 'cache_receipts':
            for value in ast.walk(node):
                if isinstance(value, ast.Constant) and value.value == 'ypal-restored-read-cache-provider-v1.py':
                    value.value = WRAPPERS['cache']; literal_changes['cache'] += 1
        return node
    dependencies = {**epoch.manifest['dependencies'], **epoch.manifest['files']}
    ctx = namespace(epoch.raw(context_old), ANCESTRY[context_old], epoch.filename('feature'), {
        'DEPENDENCIES': dependencies, 'READER_BASE': epoch.base / 'readers'
    }, {'initialize': lambda *args: need(False, 'fresh_feature_constructor_not_yet_bound')}, context_transform)
    need(literal_changes == {'reader': 3, 'reader-format': 1, 'cache': 1}, 'exact_fresh_reader_and_cache_receipt_identity_seams_required')
    selector = Path('/etc/yunipals-unified') / ('booster-ypal-fresh-' + epoch.id + '.public.env')
    counts = {'selector': 0, 'drops': 0}
    def owner_transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == 'assemble':
            for value in ast.walk(node):
                if isinstance(value, ast.Constant) and value.value == "Path('/etc/yunipals-unified/booster-ypal-restored-combined.public.env')":
                    value.value = 'Path(' + repr(str(selector)) + ')'; counts['selector'] += 1
                if isinstance(value, ast.Constant) and value.value == "{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-restored-combined.conf') for u in (API, QUEUE)}":
                    value.value = "{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-fresh-" + epoch.id + ".conf') for u in (API, QUEUE)}"
                    counts['drops'] += 1
        return node
    owner = namespace(epoch.raw(owner_old), ANCESTRY[owner_old], epoch.filename('feature'), {
        'FORMAT': FORMAT + '-feature', 'BASE': epoch.base / 'feature', 'INPUT': epoch.base / 'feature-input.json',
        'MANIFEST': epoch.base / 'manifest.json', 'CONTEXT': epoch.filename('feature'), 'CONTEXT_SHA': epoch.producer('feature')
    }, transform=owner_transform)
    need(counts == {'selector': 1, 'drops': 1}, 'exact_new_feature_selector_and_drop_identity_seams_required')
    def initialize(host, business, manifest_pin, input_pin, canonical_ref, capture_id):
        need(manifest_pin == epoch.manifest_sha and document(epoch.base / 'manifest.json', manifest_pin) == epoch.manifest,
             'same_fixed_fresh_epoch_feature_manifest_required')
        config = business.document(business.INPUT, input_pin)
        need(set(config) == ctx.CONFIG and all(business.pin(v) for v in config.values()), 'actual_completed_new_reader_and_cache_inputs_required')
        host.b, host.manifest, host.config, host.epoch = business, epoch.manifest, config, epoch
        host.static = epoch.load('ypal-restored-metadata-context-v1.py')
        host.parts = host.static.query_components(); host.p = host.parts['privilegedSourcePrimitives']
        host.sdk, host.raw = host.p['sdk'], host.p['host'].raw
        host.provider = epoch.cache()
        host.read, _, host.read_host, host.read_receipt, host.read_before, host.read_rehearsal = host.provider.static_read_host(config)
        host.cache = host.provider.cache_runtime(); host.reader = business.load_fixed('ypal-reader-cutover-v1.py')
        host.parity = business.module(mpath := OPS / 'ypal-booster-source-parity-v1.py', dependencies[mpath.name])
        host.h = types.SimpleNamespace(m=types.SimpleNamespace(run=host.sdk.command, protected=host.sdk.protected))
        host.old = types.SimpleNamespace(h=types.SimpleNamespace(observer=host.raw.observer))
        host.old.core = types.SimpleNamespace(run=lambda argv, timeout=30: host.sdk.command(argv, timeout=timeout).decode(),
                                             sql=lambda text: host.read_host.query(text, False))
        host.old.query = lambda text: ctx.query_one(host.read_host, text)
        host.old.request = lambda path, public=False: host.reader.Host.request(host.old, path, public)
        host.old.actor = lambda unit, values: ctx.api_actor(host, unit, values)
        host.manifest_pin, host.input_pin, host.canonical_ref, host.capture_id = manifest_pin, input_pin, canonical_ref, capture_id
        host.inverse_mode, host.first_effect_deadline = False, None
    ctx.initialize = initialize
    b = owner.assemble(protected(owner.TEMPLATE, owner.TEMPLATE_SHA), ctx)
    tree = ast.parse(protected(owner.TEMPLATE, owner.TEMPLATE_SHA))
    owner_class = next(v for v in tree.body if isinstance(v, ast.ClassDef) and v.name == 'Owner')
    review = copy.deepcopy(next(v for v in owner_class.body if isinstance(v, ast.FunctionDef) and v.name == 'review'))
    actor_guards = [row for row in ast.walk(review) if isinstance(row, ast.Call) and ast.unparse(row.func) == 'need' and
        len(row.args) == 2 and isinstance(row.args[1], ast.Constant) and row.args[1].value == 'actual_finalized_initial_API_actor_required']
    need(len(actor_guards) == 1 and ast.unparse(actor_guards[0].args[0]) ==
         "api['MainPID'] == '2334701' and api['InvocationID'] == '3a3b4014f75b4db9968f4c5ee26fa904'", 'one_exact_old_initial_feature_API_tuple_guard_required')
    actor_guards[0].args[0] = ast.parse('actual_restored_feature_api(api)', mode='eval').body
    b.actual_restored_feature_api = lambda api: api == epoch.ancestry['feature']['api']
    exec(compile(ast.fix_missing_locations(ast.Module(body=[review], type_ignores=[])), str(epoch.filename('feature')), 'exec'), b.__dict__)
    b.Owner.review = b.review
    old_module = b.module
    def module(path, digest):
        name = Path(path).name
        for kind in ('metadata', 'generation', 'cache', 'readers'):
            if path == epoch.filename(kind):
                need(digest == epoch.producer(kind), 'same_actual_new_feature_phase_component_required')
                return getattr(epoch, kind)()
        return old_module(path, digest)
    b.module = module
    old_host = b.Host
    class Host(old_host):
        def combined(self):
            need(not self.inverse_mode, 'fresh_feature_inverse_requires_distinct_recurring_owner')
            value = epoch.source_current()
            return {'sourceKernelActors': source_kernel_actors(value), 'sourcePhase': stable_source(value),
                    'oldC96ActorRelabelled': False, 'currentWriterQualified': True}
        def sessions(self, temporary=None):
            actors = source_kernel_actors(epoch.source_current())
            if temporary is not None: actors[b.SOURCE] = temporary['sdkActor']
            return self.raw.sessions(actors)
        def source_actor(self, expected=None):
            value = ctx.capture_temporary(self)
            expected_sdk = epoch.ancestry['feature']['temporarySourceActor'] if expected is None else expected['sdkActor']
            ctx.source_actor_checks(value, expected_sdk, expected_sdk)
            return ctx.temporary_value(value)
        def actor(self, selected=False):
            value = super().actor(selected)
            if not selected:
                need(value == epoch.ancestry['feature']['api'], 'same_actual_inverse_restored_feature_API_epoch_required')
            return value
    b.Host = Host
    b.runtime = lambda: b
    b.validate_inverse_leaf = lambda *_a, **_k: need(False, 'fresh_feature_inverse_requires_distinct_recurring_owner')
    b.epoch = epoch
    return b


def retained_current(epoch):
    """Only the independently owned temporary peer, never parent authority."""
    base = epoch.base / 'feature'
    if not (base / 'retire-source-stop-intent.json').exists():
        refs = epoch.input['inverse']; owner = epoch.load(INVERSE_OWNER)
        value = owner.validate_restored_temporary_leaf(epoch.input['priorEpochId'], refs['resultSha256'], refs['manifestSha256'], refs['inputSha256'])
        need(value['validated'] is True and value['sourceActorQualified'] is value['financialAuthorityQualified'] is False and
             value['databaseWrites'] == value['serviceActions'] == 0 and set(value['actors']) == {'yunipals-booster-ypal-source.service'},
             'actual_inverse_owned_retained_temporary_peer_only_required')
        return value
    b = epoch.feature(); op = b.document(base / 'operation.json')
    h = b.Host(epoch.manifest_sha, op['inputSha256']); owner = b.Owner(h); op = owner.operation()
    intent = b.document(base / 'retire-source-stop-intent.json'); review = b.document(base / 'retirement-review.json')
    need(intent['format'] == b.FORMAT and intent['operatorSha256'] == epoch.producer('feature') and
         intent['bootId'] == b.boot() and intent['operationSha256'] == sha(b.protected(base / 'operation.json')) and
         review['reviewHash'] == sha(b.encoded(review['binding'])) and review['binding']['source'] == op['source'],
         'exact_new_feature_retirement_stop_intent_and_review_required')
    state = h.state(b.SOURCE)
    if state['MainPID'] != '0':
        # The intent does not imply the stop happened. Exact old peer remains
        # positively qualified until its terminal state is actually observed.
        refs = epoch.input['inverse']
        return epoch.load(INVERSE_OWNER).validate_restored_temporary_leaf(epoch.input['priorEpochId'],
            refs['resultSha256'], refs['manifestSha256'], refs['inputSha256'])
    need(state['InvocationID'] == op['source']['invocation'], 'retirement_terminal_must_be_the_selected_temporary_invocation')
    h.terminal(b.SOURCE); h.static.gone(op['source']['sdkActor']['processes'])
    ctx_paths, native = feature_context_static(h, epoch)
    if os.path.lexists(b.BOOT):
        need(b.boot_record() == review['binding']['boot'], 'same_retained_boot_before_owned_retirement_disable_required')
        h.source_activation()
    else:
        boot_intent = b.document(base / 'retire-source-boot-intent.json')
        need(boot_intent['operatorSha256'] == epoch.producer('feature') and boot_intent['operationSha256'] == intent['operationSha256'] and
             b.link_record(base / 'temporary-source.boot.original') == review['binding']['boot'], 'same_owned_boot_disable_intent_and_archived_inode_required')
        h.source_activation(True)
    # The source companion proves all remaining native sessions belong to the
    # actual managed tree; this callback only removes the exact dead peer.
    need(h.state(b.SOURCE) == state, 'owned_retirement_terminal_changed_during_source_callback')
    return {'validated': True, 'actors': {}, 'ownedTemporaryTerminal': True,
            'retirementIntentSha256': sha(b.protected(base / 'retire-source-stop-intent.json')),
            'temporaryNativeIdentity': native, 'sourceActorQualified': False, 'financialAuthorityQualified': False,
            'databaseWrites': 0, 'serviceActions': 0}


def feature_context_static(host, epoch):
    # Exact retained source-static body, no current source/consumer callback.
    context = namespace(epoch.raw('ypal-restored-feature-context-v1.py'), ANCESTRY['ypal-restored-feature-context-v1.py'],
                        epoch.filename('feature'))
    return context.source_static(host)


def post_feature_phase(epoch, root, proof, refs):
    old = 'ypal-restored-reader-cache-phase-v1.py'
    def feature_current(value):
        need(value == refs and type(value) is dict and set(value) == {'retirementSha256', 'manifestSha256', 'inputSha256'} and
             all(pin(v) for v in value.values()) and value['manifestSha256'] == epoch.manifest_sha,
             'actual_completed_same_epoch_feature_ref_triple_required')
        owner = epoch.feature(); result = owner.validate_feature_leaf(value['retirementSha256'], value['manifestSha256'], value['inputSha256'])
        need(result['format'] == owner.FORMAT and result['validated'] is True and result['operatorSha256'] == epoch.producer('feature') and
             result['receiptSha256'] == value['retirementSha256'] and result['temporarySourceRetired'] is result['collectorOnlyCurrentGraphQualified'] is True and
             all(result[k] is False for k in ('sourceActorQualified', 'financialAuthorityQualified', 'independentPeerLifecyclesQualified',
                 'allConfiguredSourcesQualified', 'originalWholeValidatorsPassed', 'current143WholeGraphQualified')),
             'actual_fresh_feature_retirement_and_scoped_collector_leaf_required')
        return {'producerFile': str(epoch.filename('feature')), 'producerSha256': epoch.producer('feature'),
            'receiptSha256': value['retirementSha256'], 'manifestSha256': value['manifestSha256'], 'inputSha256': value['inputSha256'],
            'api': result['api'], 'temporarySourceRetired': True, 'sourceActorQualified': False, 'financialAuthorityQualified': False}
    ns = namespace(epoch.raw(old), ANCESTRY[old], epoch.filename('readers'),
                   overrides={'feature_current': feature_current})
    return ns.reader_namespace(root, proof, copy.deepcopy(refs)), feature_current


def validate_forward(epoch, reader_result_sha, cache_result_sha, feature_refs):
    need(pin(reader_result_sha) and pin(cache_result_sha), 'actual_new_reader_and_cache_acceptance_refs_required')
    first = stable_source(epoch.source_current()); root = epoch.readers(); proof = root.proof
    phase, feature_current = post_feature_phase(epoch, root, proof, feature_refs)
    feature = feature_current(feature_refs)
    readers = phase.validate_reader_leaf(reader_result_sha, proof.manifest_sha, feature_refs)
    cache = cache_finish_namespace(epoch, phase, proof).validate_cache_leaf(cache_result_sha, proof.manifest_sha, feature_refs)
    generation, candidate, operation, capsule = proof.Context(root.document(root.BASE / 'operation.json')['binding']['inputs']).generation()
    need(candidate['freshForwardEpoch'] == epoch.marker() and operation['freshForwardEpoch'] == epoch.marker() and
         candidate['generationId'] == readers['generationId'] == cache['generationId'] and
         candidate['generationId'] not in {'103', epoch.ancestry['historicalFirstNative']['id']} and
         capsule['contextSha256'] == epoch.ancestry['originalCapsule']['contextSha256'],
         'new_actual_first_native_generation_cannot_relabel_historical_G0_or_capsule')
    reuse = root.document(generation.BASE / 'capsule-reuse-result.json', candidate['capsuleReuseResultSha256'])
    overlay = root.document(generation.BASE / 'retention-overlay-result.json', candidate['retentionOverlaySha256'])
    need(reuse['capsuleRecaptured'] is False and reuse['freshForwardEpoch'] == overlay['freshForwardEpoch'] == epoch.marker() and
         overlay['additionallyRetainedHistoricalGenerationIds'] == epoch.input['retainedHistoricalGenerationIds'],
         'acknowledged_capsule_reuse_and_additive_historical_G0_retention_required')
    query = epoch.load('ypal-restored-metadata-context-v1.py').query_components()['readerHost'].query
    historical = historical_generation_current(epoch, query)
    need(feature_current(feature_refs) == feature and stable_source(epoch.source_current()) == first,
         'source_epoch_or_feature_changed_during_actual_fresh_forward_acceptance')
    return {'format': FORMAT + '-accepted', 'validated': True, 'freshForwardEpoch': epoch.marker(),
        'readerResultSha256': reader_result_sha, 'cacheResultSha256': cache_result_sha,
        'readerManifestSha256': proof.manifest_sha, 'featureRefs': copy.deepcopy(feature_refs),
        'generationId': candidate['generationId'], 'historicalFirstNativeGenerationId': historical['id'],
        'historicalG0RetainedAdditionally': True, 'originalCapsuleReused': True, 'sourceQualification': first,
        'readers': readers, 'cache': cache, 'feature': feature, 'twentyFourHourRefreshQualified': False,
        'recurringWorkerActivationQualified': False, 'financialAuthorityQualified': False,
        'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def factory_main(kind, argv=None):
    """Fixed wrapper CLI; no inverse dispatch and no automatic phase retry."""
    import sys
    need(kind in KINDS, 'one_fixed_fresh_forward_kind_required')
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print(json.dumps({'format': FORMAT + '-' + kind, 'staticOnly': True, 'namespaceConstructed': False,
            'forwardEpochStarted': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument('--epoch', required=True); p.add_argument('--epoch-input-sha', required=True)
    p.add_argument('--epoch-manifest-sha', required=True); p.add_argument('--construct', action='store_true')
    p.add_argument('--monitor', action='store_true'); p.add_argument('--reader-manifest', action='store_true')
    args, phase_args = p.parse_known_args(argv)
    epoch = create_epoch(args.epoch, args.epoch_input_sha, args.epoch_manifest_sha)
    need(not any('inverse' in v or 'restore-activation' in v or 'reconcile-start' in v for v in phase_args),
         'fresh_forward_wrapper_cannot_dispatch_descendant_inverse')
    if args.reader_manifest:
        need(kind == 'readers' and not phase_args and not args.monitor, 'one_explicit_readonly_reader_manifest_plan_required')
        print(json.dumps(reader_manifest(epoch), sort_keys=True)); return
    ns = getattr(epoch, kind)()
    if args.construct:
        need(not phase_args and not args.monitor, 'construction_is_not_phase_execution')
        print(json.dumps({'format': FORMAT + '-' + kind, 'constructed': True, 'epoch': epoch.marker(),
                          'currentWriterQualified': False, 'phaseExecuted': False})); return
    if args.monitor:
        need(kind == 'generation' and not phase_args, 'only_named_generation_monitor_has_no_phase_arguments')
        ns.monitor.main(); return
    if kind == 'generation':
        generation_dispatch(epoch, ns, phase_args); return
    if kind == 'metadata':
        # The reviewed metadata CLI requires its immutable input explicitly.
        need('--input-sha' in phase_args and phase_args[phase_args.index('--input-sha') + 1] == epoch.input_sha,
             'same_fresh_epoch_metadata_input_on_CLI_required')
    if kind == 'feature':
        need('--manifest-sha' in phase_args and phase_args[phase_args.index('--manifest-sha') + 1] == epoch.manifest_sha,
             'same_fresh_epoch_feature_manifest_on_CLI_required')
    original = sys.argv
    try:
        sys.argv = [str(epoch.filename(kind)), *phase_args]; ns.main()
    finally: sys.argv = original


def generation_dispatch(epoch, ns, argv):
    p = argparse.ArgumentParser()
    for name in ['read-ack', 'install-ack', 'metadata-operation', 'metadata-selected', 'metadata-provenance-sha', 'metadata-input-sha']:
        p.add_argument('--' + name, required=True)
    p.add_argument('--metadata-provenance', required=True)
    p.add_argument('--phase', choices=['drain', 'capsule-reuse', 'build', 'reconcile-build', 'accept-candidate'])
    p.add_argument('--ack'); args = p.parse_args(argv)
    need(args.metadata_input_sha == epoch.input_sha and args.read_ack == epoch.input['readConfig']['admissionSha256'] and
         all(pin(getattr(args, v)) for v in ['read_ack', 'install_ack', 'metadata_operation', 'metadata_selected', 'metadata_provenance_sha']),
         'actual_same_epoch_generation_and_metadata_receipts_required')
    need(os.geteuid() == os.getegid() == 0 and __import__('socket').gethostname() == 'yunipals-main', 'fixed_root_fresh_generation_host_required')
    os.umask(0o077); h = ns.Host(args)
    with ns.lock():
        if args.phase in {None, 'drain'}:
            binding = ns.review(h); digest = sha(encoded(binding))
            need(args.phase is None or args.ack == digest, 'fresh_exact_named_generation_review_required')
            result = ns.drain(h, binding) if args.phase else None
            print(json.dumps({'format': ns.FORMAT, 'reviewHash': digest, 'operationSha256': result, 'binding': binding})); return
        need(pin(args.ack), 'actual_named_generation_operation_ACK_required')
        op = ns.operation(h, args.ack)
        methods = {'capsule-reuse': ns.reuse_capsule, 'build': ns.build, 'reconcile-build': ns.reconcile_build,
                   'accept-candidate': ns.accept_candidate}
        result = methods[args.phase](h, op)
        print(json.dumps({'format': ns.FORMAT, 'phase': args.phase, 'acknowledged': True, 'result': result}))


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--epoch'); p.add_argument('--input-sha'); p.add_argument('--manifest-sha')
    args = p.parse_args()
    if not any(vars(args).values()):
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'namespaceConstructed': False,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(args.epoch and pin(args.input_sha) and pin(args.manifest_sha), 'all_explicit_actual_epoch_refs_required')
    epoch = create_epoch(args.epoch, args.input_sha, args.manifest_sha)
    print(json.dumps({'format': FORMAT, 'constructed': True, 'epoch': epoch.marker(), 'currentRestoredQualified': False,
                      'currentWriterQualified': False, 'phaseExecutionAuthorized': False}))


if __name__ == '__main__': main()
