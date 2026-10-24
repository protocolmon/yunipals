#!/usr/bin/env python3
"""Current explicit phase facade; frozen source-dependent constructors excluded."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-ypal-native-cutover-proof-v2'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-native-cutover-v2-20261024')
MANIFEST = OPS / 'ypal-native-cutover-v2.manifest.json'
TEMPLATE = 'ypal-native-cutover-proof-v1.py'
TEMPLATE_SHA = '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946'
WIRE_SHA = 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168'
TRANSPORT = 'ypal-reader-peer-runtime-v1.py'
TRANSPORT_SHA = 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa'
QUALIFIER = Path('/var/tmp/yunipals-reader-peer-runtime-input-v1-20261024/ypal-reader-peer-runtime-host-v1.py')
QUALIFIER_SHA = '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76'
QUALIFICATION = Path('/var/backups/yunipals-reader-peer-runtime-host-v1-20261024/qualification-result.json')
QUALIFICATION_SHA = '521e0bb514f1f6ba306b82d489f19ea53183dcdd2aa1e76aa65498cc184f1899'
STAGE_SHA = '6efd1d9d5ee083e71fe3b99ac3aff6238c9b96b5a0da5ae3e2d961bf71a25107'
CONTEXT_NAMES = {
    'read': 'ypal-restored-read-current-context-v1.py',
    'phase': 'ypal-restored-read-cache-provider-v1.py',
    'metadata': 'ypal-restored-metadata-handover-v1.py',
    'metadataStatic': 'ypal-restored-metadata-context-v1.py',
    'observer': 'ypal-restored-ordinary-observer-v1.py'
}
DATA_IDENTITY = {
    'sourceRelease': '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
    'manifestHash': '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
    'schema': 'unified_ypal_20261023_v1', 'schemaOid': '75963410', 'buildId': '71e2a7f3b7',
    'readSchema': 'yunipals_ownership_4e77f52b_v4', 'readSchemaOid': '75994954',
    'readIdentity': '0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67',
    'nativeRelations': 44
}
INPUT_KEYS = {'sourceManifestSha256', 'cachePreparedSha256', 'publisherInstallSha256', 'mainInstallSha256',
              'parityWitnessSha256', 'sustainedObserverSha256', 'readPlanSha256', 'readContextInputSha256', 'cacheInputsSha256'}
EXCLUDED_METHODS = {'__init__', 'scope', 'inverse_scope', 'generation', 'metadata', 'metadata_inverse_context'}
CODE = {'ypal-native-cutover-v2.py', 'ypal-native-cutover-proof-v2.py', 'ypal-cache-finish-v3.py',
        'ypal-native-cutover-v1.mjs', 'ypal-native-reader-probe-v1.mjs', 'ypal-native-cutover-v1.action.sql'}


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def manifest_contract(value):
    need(set(value) == {'format', 'wireManifestSha256', 'dataIdentity', 'files', 'dependencies', 'contexts', 'transportQualification'} and
         value['format'] == 'yunipals-ypal-native-cutover-source-v2' and
         value['wireManifestSha256'] == WIRE_SHA and value['dataIdentity'] == DATA_IDENTITY and
         set(value['files']) == CODE and not set(value['files']) & set(value['dependencies']) and
         set(value['contexts']) == set(CONTEXT_NAMES), 'finite_explicit_new_reader_manifest_required')
    need(value['transportQualification'] == {'producerSha256': QUALIFIER_SHA, 'receiptSha256': QUALIFICATION_SHA,
         'stageResultSha256': STAGE_SHA}, 'same_actual521e_scoped_transport_qualification_required')
    for role, name in CONTEXT_NAMES.items():
        reference = value['contexts'][role]
        need(set(reference) == {'file', 'sha256'} and reference['file'] == name and pin(reference['sha256']) and
             value['dependencies'].get(name) == reference['sha256'],
             'actual_frozen_context_pin_must_equal_its_manifest_dependency')
    return value


def observer_acknowledged(value, expected, producer):
    need(value['recordedActivationQualified'] is value['observerScopeOnly'] is value['ordinarySustainedObserver'] is True and
         value['receiptSha256'] == expected and value['operatorSha256'] == producer and
         value['releaseId'] == DATA_IDENTITY['sourceRelease'] and
         value['observerCurrentQualified'] is value['sourceActorQualified'] is value['currentWriterQualified'] is False and
         value['databaseWrites'] == value['serviceActions'] == value['providerRequests'] == 0,
         'actual_immutable_new_observer_ACK_required_without_current_lifecycle_claim')
    return value


def observer_identity(value):
    need(value['validated'] is value['observerCurrentQualified'] is value['observerScopeOnly'] is
         value['ordinarySustainedObserver'] is value['freeOnly'] is True and value['runtimeMaximumSeconds'] is None and
         value['paidAuthority'] is value['sourceActorQualified'] is value['currentWriterQualified'] is False and
         value['databaseWrites'] == value['serviceActions'] == value['providerRequests'] == 0,
         'actual_current_nonexpiring_observer_without_writer_or_paid_authority_required')
    # readOnlyInspect contains operational observations. Both complete current
    # validations must pass; only these authenticated identities must be equal.
    return {key: value[key] for key in ('format', 'receiptSha256', 'operatorSha256', 'releaseId',
            'actor', 'bootLink', 'dataIdentity', 'initialSourceContext')}


def protected(path, expected=None, maximum=200000):
    path = Path(path)
    for parent in [*path.parents, path]:
        row = parent.lstat(); sticky = parent == Path('/var/tmp') and row.st_mode & stat.S_ISVTX
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and
             (not row.st_mode & 0o022 or sticky), 'fixed_protected_current_reader_context_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
         'bounded_regular_current_reader_context_required')
    raw = path.read_bytes(); after = path.lstat()
    need(len(raw) == before.st_size and all(getattr(before, key) == getattr(after, key) for key in
         ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) and
         (expected is None or pin(expected) and sha(raw) == expected), 'exact_current_reader_context_bytes_required')
    return raw


def load(path, expected):
    need(pin(expected), 'actual_current_context_producer_not_yet_frozen')
    raw = protected(path, expected)
    value = types.ModuleType('explicit_reader_' + Path(path).stem.replace('-', '_')); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value


def inherited_methods(raw, module_loader):
    """No old constructor, source/metadata scope or active-source inverse runs."""
    need(sha(raw) == TEMPLATE_SHA, 'exact_frozen9ab_source_independent_reader_template_required')
    tree = ast.parse(raw); body = []; stripped = set(); login_changes = 0; inverse_terminal = None
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in {'source_manifest', 'module'}: continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            replacements = {'FORMAT': repr(FORMAT), 'BASE': 'Path(' + repr(str(BASE)) + ')',
                            'SOURCE_MANIFEST': "OPS / 'ypal-native-cutover-v2.manifest.json'"}
            if name in replacements:
                node = copy.deepcopy(node); node.value = ast.parse(replacements[name], mode='eval').body
        if isinstance(node, ast.ClassDef) and node.name == 'Context':
            node = copy.deepcopy(node); node.name = 'SourceIndependentReaderMethods'
            methods = []
            for method in node.body:
                if isinstance(method, ast.FunctionDef) and method.name == 'metadata_inverse_context':
                    inverse_classes = [row for row in method.body if isinstance(row, ast.ClassDef) and row.name == 'InverseMetadataContext']
                    need(len(inverse_classes) == 1, 'one_frozen_inverse_metadata_context_required')
                    terminals = [row for row in inverse_classes[0].body if isinstance(row, ast.FunctionDef) and row.name == 'terminal']
                    need(len(terminals) == 1, 'one_frozen_source_independent_metadata_terminal_method_required')
                    inverse_terminal = copy.deepcopy(terminals[0])
                if isinstance(method, ast.FunctionDef) and method.name in EXCLUDED_METHODS:
                    stripped.add(method.name); continue
                if isinstance(method, ast.FunctionDef) and method.name == 'logins_enabled':
                    for value in ast.walk(method):
                        if isinstance(value, ast.Constant) and value.value in {
                                'yunipals-ypal-native-cutover-v1', 'ypal-native-cutover-v1.py'}:
                            value.value = value.value.replace('-v1', '-v2'); login_changes += 1
                methods.append(method)
            node.body = methods
        body.append(node)
    need(stripped == EXCLUDED_METHODS and login_changes == 2 and inverse_terminal is not None,
         'exact_source_dependent_method_exclusions_and_new_LOGIN_owner_required')
    factory = ast.parse('def inverse_metadata_terminal(owner, outer):\n    return terminal\n').body[0]
    factory.body.insert(0, inverse_terminal)
    body.append(factory)
    namespace = types.ModuleType('explicit_source_independent_reader_methods')
    namespace.__file__ = str(Path(__file__).absolute()); namespace.module = module_loader
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), namespace.__file__, 'exec'), namespace.__dict__)
    return namespace


class Proof:
    def __init__(self, manifest_sha):
        self.manifest_sha = manifest_sha
        self.manifest = manifest_contract(json.loads(protected(MANIFEST, manifest_sha, 100000)))
        self.pins = {**self.manifest['dependencies'], **self.manifest['files']}
        need(self.pins.get(TEMPLATE) == TEMPLATE_SHA and self.pins.get(TRANSPORT) == TRANSPORT_SHA,
             'exact_frozen_reader_and_transport_templates_required')
        for name, digest in self.pins.items():
            need('/' not in name and pin(digest), 'finite_exact_public_reader_source_map_required')
            protected(OPS / name, digest)
        self._authorized_dependencies = None
        self.pure = inherited_methods(protected(OPS / TEMPLATE, TEMPLATE_SHA), self.module)
        owner = self

        class Context(self.pure.SourceIndependentReaderMethods):
            def __init__(self, inputs): owner.initialize(self, inputs)
            def scope(self, enabled=None): return owner.scope(self, enabled)
            def inverse_scope(self, cache_reads=True): return owner.inverse_scope(self, cache_reads)
            def leaf_scope(self, feature_refs=None):
                result = super().leaf_scope(feature_refs)
                return {**result, 'validated': True, 'readAdmissionSha256': self.phase.admission_ref['receiptSha256'],
                        'currentWriterQualified': False, 'originalWholeValidatorPassed': False,
                        'providerCalls': 0}
            def generation(self): return self.phase.generation()
            def metadata(self):
                _, candidate, _, _ = self.generation()
                selection = self.cache.document(self.cache.META / 'selected.json',
                                                self.prepared['config']['metadataSelectionSha256'])
                return owner.module_context('metadata').metadata(
                    self.phase, candidate, selection, lambda: owner.metadata_refresh(self, False))
            def metadata_inverse_context(self):
                _, candidate, _, _ = self.generation()
                metadata = owner.module_context('metadata'); primitives = self.phase.metadata_primitives()
                inverse_type = type('CurrentInverseMetadataContext', (metadata.Host,),
                    {'terminal': owner.metadata_terminal(metadata, self)})
                context = inverse_type(primitives['readConfig'], lambda: owner.metadata_refresh(self, True),
                                       True, primitives, primitives['admission_ref'])
                need(candidate['readAdmissionSha256'] == context.admission_pin,
                     'same_new_metadata_admission_for_owned_inverse_required')
                operation = metadata.operation(context, candidate['metadataOperationSha256'])
                return metadata, context, operation
        self.Context = Context

    def __getattr__(self, name): return getattr(self.pure, name)

    @property
    def CACHE_SHA(self):
        # Retained function bodies record the actual owner of prepared/cache
        # acknowledgements. c54 is their historical template, not this owner.
        return self.manifest['contexts']['phase']['sha256']

    def module(self, name, digest):
        need(name in self.pins and self.pins[name] == digest, 'manifest_bound_public_leaf_only')
        return load(OPS / name, digest)

    def module_context(self, role):
        reference = self.manifest['contexts'][role]
        return load(OPS / reference['file'], reference['sha256'])

    def source_manifest(self, pin_value):
        need(pin_value == self.manifest_sha and json.loads(protected(MANIFEST, pin_value)) == self.manifest,
             'same_current_external_reader_manifest_required')
        return self.manifest

    def transport_module(self): return self.module(TRANSPORT, TRANSPORT_SHA)

    def cache_finish_module(self, controller, context):
        name = 'ypal-cache-finish-v3.py'
        need(context.proof is self and context.inputs['sourceManifestSha256'] == self.manifest_sha,
             'same_current_coordinator_context_for_cache_inverse_required')
        return self.module(name, self.manifest['files'][name]).runtime(controller, self)

    def transport_current(self):
        helper = load(QUALIFIER, QUALIFIER_SHA)
        ack = helper.document(QUALIFICATION, QUALIFICATION_SHA)
        staged = helper.document(helper.BASE / 'stage-result.json', STAGE_SHA)
        current = helper.review()
        need(ack['format'] == 'yunipals-reader-peer-runtime-host-v1' and ack['qualified'] is True and
             ack['stageResultSha256'] == STAGE_SHA and staged['staged'] is True and staged['binding'] == current and
             ack['reviewHash'] == current['reviewHash'] and ack['peers'] == current['peers'] and
             ack['productionDependencies'] == current['productionDependencies'] and
             ack['applicationStarted'] is ack['poolConstructed'] is ack['coordinatorIntegrated'] is False and
             ack['databaseConnections'] == ack['providerCalls'] == ack['serviceActions'] == ack['existingPermissionChanges'] == 0,
             'actual_scoped521e_public_transport_qualification_and_unchanged_current_state_required')
        if self._authorized_dependencies is None:
            dependency, entries = helper.production()
            need(dependency == current['productionDependencies'], 'same_current_dependency_programs_required')
            current_tree = helper.preauthorize_dependencies(entries)
            need(current_tree == ack['preEvaluationDependencyProof'], 'same_full_dependency_tree_before_any_reader_module_evaluation_required')
            self._authorized_dependencies = current_tree
        return {'qualified': True, 'receiptSha256': QUALIFICATION_SHA, 'producerSha256': QUALIFIER_SHA,
                'currentPeers': current['peers'], 'currentProgramsSha256': current['productionDependencies']['publicFilesSha256'],
                'dependencyAuthorizationAtCommandStart': self._authorized_dependencies,
                'sourceAuthority': False, 'roleAuthority': False, 'canonicalAuthority': False}

    def initialize(self, context, inputs):
        need(set(inputs) == INPUT_KEYS and all(pin(value) for value in inputs.values()) and
             inputs['sourceManifestSha256'] == self.manifest_sha, 'same_nine_actual_reader_phase_receipt_refs_required')
        observer = observer_acknowledged(self.module_context('observer').acknowledgement(inputs['sustainedObserverSha256']),
                    inputs['sustainedObserverSha256'], self.manifest['contexts']['observer']['sha256'])
        # No active-source predicate is called in construction. Forward scope,
        # inverse and a later source-independent reader leaf are distinct APIs.
        self.transport_current()
        phase = self.module_context('phase').create_phase(copy.deepcopy(inputs), copy.deepcopy(self.manifest))
        context.inputs = inputs; context.manifest = self.manifest; context.proof = self; context.phase = phase
        context.observer_acknowledgement = observer
        for name in ('cache', 'host', 'prepared', 'before', 'rehearsal', 'sql_ack'):
            need(hasattr(phase, name), 'authenticated_current_READ143_and_cache4_phase_objects_required')
            setattr(context, name, getattr(phase, name))
        need(context.prepared['prepared'] is True and context.prepared['nativeGenerationPublished'] is False and
             context.prepared['nativeWorkerStarted'] is False, 'actual_inactive_cache_and_unpublished_candidate_prerequisite_required')
        reference = phase.admission_ref
        name = 'ypal-restored-read-admission-v1.py'
        need(reference['producerFile'] == str(OPS / name) and reference['producerSha256'] == self.pins[name] and
             reference['resultFile'] == '/var/backups/yunipals-ypal-restored-read-admission-v1-20261024/result.json' and
             reference['receiptSha256'] == context.prepared['config']['readAdmissionSha256'] and
             reference['planSha256'] == inputs['readPlanSha256'] and
             reference['contextInputSha256'] == inputs['readContextInputSha256'],
             'same_actual_fresh143_producer_receipt_plan_and_context_required')
        context.publisher = self.module('ypal-generation-publisher-install-v1.py', self.DEPENDENCIES['ypal-generation-publisher-install-v1.py'])
        context.publisher_receipt = context.publisher.installed(context.host.m, inputs['publisherInstallSha256'])
        context.main = self.module('ypal-main-api-install-v1.py', self.DEPENDENCIES['ypal-main-api-install-v1.py'])
        context.main_receipt = context.main.installed(context.host.m, inputs['mainInstallSha256'])
        need(inputs['publisherInstallSha256'] == self.PUBLISHER_INSTALL_SHA and inputs['mainInstallSha256'] == self.MAIN_INSTALL_SHA,
             'same_actual_installed_reader_and_publication_artifacts_required')

    def scope(self, context, enabled=None):
        actual_enabled = context.logins_enabled()
        need(enabled is None or enabled is actual_enabled, 'actual_owned_two_LOGIN_phase_required')
        runtime = self.module_context('read').validate_runtime()
        need(all(runtime[key] == DATA_IDENTITY[key] for key in
                 ('sourceRelease', 'manifestHash', 'schema', 'schemaOid', 'buildId')) and
             len(runtime['nativeTableIdentities']) == DATA_IDENTITY['nativeRelations'],
             'same_registered_logical_release_physical44_schema_and_build_required')
        baseline = context.sql_ack['postProof']['catalog']
        expected = self.login_postcatalog(baseline)[0] if actual_enabled else baseline
        actual = context.catalog(); self.exact_login_catalog(baseline, actual, actual_enabled)
        self.complete_cache_acl_baseline(baseline, actual); context.columns_current()
        phase = context.phase.scope(actual_enabled, expected)
        need(phase['validated'] is True, 'fresh_actual_READ143_cache4_and_all_column_graph_required')
        guard = context.guard_scope(True)
        need(self.module_context('read').validate_runtime() == runtime and context.catalog() == actual,
             'current_restored_source_or_complete_reader_graph_changed')
        return {'format': FORMAT, 'validated': True, 'sourceManifestSha256': self.manifest_sha,
                'readAdmissionSha256': context.prepared['config']['readAdmissionSha256'],
                'cachePreparedSha256': context.inputs['cachePreparedSha256'], 'catalogSha256': sha(encoded(actual)),
                'sourceRuntime': runtime, 'currentPhase': phase, 'apiLoginsEnabled': actual_enabled,
                'cacheGuard': guard, 'original143WholeValidatorPassed': False, 'originalCacheWholeValidatorPassed': False,
                'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}

    def inverse_scope(self, context, cache_reads=True):
        enabled = context.logins_enabled()
        baseline = context.sql_ack['postProof']['catalog'] if cache_reads else context.host.read_rehearsal['after']
        expected = self.login_postcatalog(baseline)[0] if enabled else baseline
        actual = context.catalog()
        need(context.host.read.acl_catalog(actual) == context.host.read.acl_catalog(expected),
             'exact_owned_inverse_catalog_and_all_original_READs_required')
        phase = context.phase.inverse_scope(cache_reads, enabled, expected)
        source = self.module_context('metadataStatic').validate_inverse_runtime()
        need(phase['validated'] is True and source['validated'] is True and
             source['format'] == 'yunipals-ypal-restored-metadata-context-v1-inverse-source' and
             source['restoreReceiptSha256'] == '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1' and
             source['restoreOperatorSha256'] == 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34' and
             source['sourceState'] in {'terminal', 'acknowledged-active'} and source['poolMaximum'] == 5 and
             source['frameworkReadinessQualified'] is source['currentCanonicalCoverageQualified'] is
             source['readerRoleGraphQualified'] is source['financialAuthorityQualified'] is False,
             'exact_owned_current_or_terminal_source_inverse_only_proof_required')
        context.columns_current(); guard = context.guard_scope(cache_reads)
        return {'format': FORMAT, 'validated': True, 'inverseOnly': True, 'ready': False,
                'sourceManifestSha256': self.manifest_sha, 'catalogSha256': sha(encoded(actual)),
                'readAdmissionSha256': context.prepared['config']['readAdmissionSha256'],
                'ownedCacheReadsPresent': cache_reads, 'apiLoginsEnabled': enabled, 'currentPhase': phase,
                'sourceState': source, 'cacheGuard': guard, 'sourceCoverageQualified': False,
                'original143WholeValidatorPassed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}

    def metadata_refresh(self, context, inverse):
        value = context.inverse_scope(False) if inverse else context.scope()
        reference = context.phase.admission_ref
        need(value['validated'] is True and value['readAdmissionSha256'] == reference['receiptSha256'] and
             reference['planSha256'] == context.inputs['readPlanSha256'] and
             reference['contextInputSha256'] == context.inputs['readContextInputSha256'],
             'same_authenticated_read_context_in_metadata_callback_required')
        return {**value, 'readPlanSha256': reference['planSha256'],
                'readContextInputSha256': reference['contextInputSha256'], 'originalWholeValidatorPassed': False}

    def metadata_inverse_actor(self, context, owner, host, operation, selection):
        before = owner.state(host.m)
        if before['MainPID'] != '0':
            return host.actor(operation, True, pristine=False)
        # No terminal actor is invented or adopted. This is only the exact
        # acknowledged selected invocation, with its unchanged native overlay.
        actor = selection['nativeActor']
        need(before['InvocationID'] == actor['unit']['InvocationID'] and
             owner.file_identity(owner.DROP) == self.document(owner.BASE / 'native-drop-created.json') and
             sha(self.protected(owner.DROP)) == operation['candidateDropSha256'] and
             owner.link(owner.BOOT) == selection['boot'] and owner.loaded(host, operation, True, True),
             'exact_selected_terminal_metadata_invocation_private_overlay_and_boot_required')
        host.private(operation['oldWriter'])
        sessions = context.terminal_sessions(actor, '16388')
        host.terminal(operation, actor, sessions)
        need(owner.state(host.m) == before, 'selected_terminal_metadata_changed_during_inverse_capture')
        return actor

    def metadata_terminal(self, owner, outer):
        original = self.pure.inverse_metadata_terminal(owner, outer)
        proof = self
        def terminal(host, operation, actor, sessions=None):
            if sessions is None and not os.path.lexists(owner.DROP):
                # The old native invocation remains terminal while its original
                # definition/boot are restored. It is not the old RPC PID.
                intent = proof.document(owner.BASE / 'inverse-intent.json')
                selected = proof.document(owner.BASE / 'selected.json', outer.prepared['config']['metadataSelectionSha256'])
                actor = intent['nativeActor'] or selected['nativeActor']
                created = proof.document(owner.BASE / 'native-drop-created.json')
                removal = proof.document(owner.BASE / 'inverse-drop-remove-intent.json')
                need(intent['oldStillRunning'] is False and
                     removal == {'sha256': operation['candidateDropSha256'], 'identity': created} and
                     owner.state(host.m)['InvocationID'] == actor['unit']['InvocationID'],
                     'same_owned_inverse_native_invocation_and_drop_removal_prefix_required')
                enabled = os.path.lexists(owner.BOOT)
                if enabled:
                    need(owner.link(owner.BOOT) == operation['oldBoot'] and
                         proof.document(owner.BASE / 'inverse-boot-publish-intent.json') == operation['oldBoot'],
                         'same_owned_restored_original_metadata_boot_required')
                else:
                    need(owner.link(owner.BASE / 'original-boot-link') == operation['oldBoot'] and
                         proof.document(owner.BASE / 'inverse-boot-remove-intent.json') == operation['oldBoot'],
                         'same_owned_parked_original_metadata_boot_required')
                need(owner.loaded(host, operation, False, enabled), 'exact_original_loaded_metadata_inverse_phase_required')
                sessions = outer.terminal_sessions(actor, '16388')
            return original(host, operation, actor, sessions)
        return terminal

    def separate_witnesses(self, controller, context):
        # Reuse the actual frozen fixed-boundary validation and wire protocol,
        # but explicitly bind the NEW current observer producer/context.
        reference = self.manifest['contexts']['observer']
        need(pin(reference['sha256']), 'new_current_sustained_observer_not_yet_frozen')
        observer = self.module_context('observer')
        runtime = self.module_context('read').validate_runtime()
        proof = observer.validate_current(context.inputs['sustainedObserverSha256'])
        identity = observer_identity(proof)
        dataset = {key: runtime[key] for key in ('sourceRelease', 'manifestHash', 'schema', 'schemaOid', 'buildId')}
        dataset['nativeTableIdentitiesSha256'] = sha(encoded(runtime['nativeTableIdentities']))
        need(proof['releaseId'] == self.RELEASE and proof['operatorSha256'] == reference['sha256'] and
             proof['receiptSha256'] == context.inputs['sustainedObserverSha256'] and proof['dataIdentity'] == dataset and
             proof['initialSourceContext'] == context.observer_acknowledgement['initialSourceContext'],
             'actual_current_nonexpiring_observer_and_same_logical_dataset_required')
        witness_path = Path('/var/backups/yunipals-ypal-fixed-boundary-witness-v3-20261024/result.json')
        captured = controller.document(witness_path, context.inputs['parityWitnessSha256'])
        parity_path = Path('/var/backups/yunipals-ypal-ownership-parity-v1-20261024/parity.json')
        need(captured['binding']['plan']['output'] == str(witness_path) and
             captured['binding']['plan']['candidateReportFile'] == str(parity_path), 'same_actual_fixed_boundary_evidence_paths_required')
        parity = controller.public_input(parity_path, captured['binding']['plan']['candidateReportSha256'])
        baseline = controller.public_input(Path(captured['binding']['plan']['baselineFile']),
                                          '69f91e57c10171dd7b8ab2424236dd22c07e913b27b0376fdc579bde0d549540')
        witness = controller.child(context, 'witness', {'witness': captured, 'parityBytes': parity.decode(), 'baselineBytes': baseline.decode()})
        need(witness['validated'] is witness['allSixCollections'] is witness['canonicalWitnessQualifiedAtCapture'] is True and
             witness['currentReadinessQualified'] is False and witness['sourceRelease'] == self.RELEASE and witness['readIdentity'] == self.IDENTITY,
             'actual_all_six_fixed_boundary_parity_without_current_readiness_relabel_required')
        need(self.module_context('read').validate_runtime() == runtime and
             observer_identity(observer.validate_current(context.inputs['sustainedObserverSha256'])) == identity,
             'source_or_current_observer_changed_during_witness_qualification')
        return {'sixCollectionWitnessSha256': context.inputs['parityWitnessSha256'],
                'sustainedObserverSha256': context.inputs['sustainedObserverSha256'],
                'witnessProducerSha256': controller.PARITY_OWNER_SHA, 'observerProducerSha256': reference['sha256'],
                'dataIdentity': dataset, 'initialObserverSourceContext': proof['initialSourceContext'],
                'observerQualifiesCurrentWriter': False}
