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

FORMAT = 'yunipals-ypal-ordinary-reader-proof-v5'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-ordinary-reader-cutover-v5-20261025')
MANIFEST = OPS / 'ypal-ordinary-reader-cutover-v5.manifest.json'
TEMPLATE = 'ypal-native-cutover-proof-v1.py'
TEMPLATE_SHA = '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946'
WIRE_SHA = 'c38ddda22c242d165e609bf5321f174d0214d1f9c7dabe13b59a27c945f19972'
TRANSPORT = 'ypal-ordinary-reader-peer-v5.py'
TRANSPORT_SHA = 'ac44d60d89e1a72fea5363b3168006ba72423d50c9bcf89f8013f47f68409e82'
QUALIFIER = Path('/var/tmp/yunipals-reader-peer-runtime-input-v1-20261024/ypal-reader-peer-runtime-host-v1.py')
QUALIFIER_SHA = '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76'
QUALIFICATION = Path('/var/backups/yunipals-reader-peer-runtime-host-v1-20261024/qualification-result.json')
QUALIFICATION_SHA = '521e0bb514f1f6ba306b82d489f19ea53183dcdd2aa1e76aa65498cc184f1899'
STAGE_SHA = '6efd1d9d5ee083e71fe3b99ac3aff6238c9b96b5a0da5ae3e2d961bf71a25107'
CONTEXT_NAMES = {
    'phase':'ypal-ordinary-read-cache-v5.py',
    'common':'ypal-ordinary-consumer-handover-v5.py',
    'metadata':'ypal-ordinary-metadata-handover-v5.py',
    'generation':'ypal-ordinary-generation-v5b.py',
    'observer':'ypal-ordinary-observer-retained-prefix-v1.py'
}
CONTEXT_PINS={
    'phase':'387c6a16d5f0c203731212d1a54b618919c0413e4235a37a35510cff584d8cc2',
    'common':'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c',
    'metadata':'9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f',
    'generation':'1ae130895711cd6ec7ddb26a23deb93c62f1bef7c859787b762ce5552a40f512',
    'observer':'451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e'
}

DATA_IDENTITY = {
    'sourceRelease':'0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
    'manifestHash':'0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
    'schema':'unified_ypal_20261023_v1','schemaOid':'75963410','buildId':'71e2a7f3b7',
    'readSchema':'yunipals_ownership_4e77f52b_v5','readSchemaOid':'77370532',
    'readIdentity':'0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab','nativeRelations':44
}
INPUT_KEYS = {'sourceManifestSha256','cachePreparedSha256','publisherInstallSha256','mainInstallSha256',
              'parityWitnessSha256','sustainedObserverSha256','readPlanSha256','readContextInputSha256','cacheInputsSha256','transportQualificationSha256'}
EXCLUDED_METHODS = {'__init__','scope','inverse_scope','generation','metadata','metadata_inverse_context'}
CODE = {'ypal-ordinary-reader-cutover-v5.py','ypal-ordinary-reader-proof-v5.py','ypal-ordinary-cache-finish-v5.py',
        'ypal-ordinary-reader-sql-v5.mjs','ypal-ordinary-reader-probe-v5.mjs','ypal-native-cutover-v1.action.sql'}
NEW_QUALIFICATION = Path('/var/backups/yunipals-ypal-ordinary-reader-peer-v5-20261025/qualification-result.json')
FEATURE = 'ypal-ordinary-feature-handover-v5.py'
FEATURE_SHA = 'cb21c6f6b6ffa627d24d67922892b7377191063f687253c65940e7a2a9f3e880'
FEATURE_CONTEXT = 'ypal-ordinary-feature-context-v5.py'
FEATURE_CONTEXT_SHA = 'da2fea0aa36277c1c464ca27ad280b03ba31bfec2730182779ac839638496656'
MAIN_INSTALLER = 'ypal-latest-complete-main-api-install-v1.py'


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def manifest_contract(value):
    need(set(value)=={'format','wireManifestSha256','dataIdentity','files','dependencies','contexts','transportQualification','canonicalWitness'} and
         value['format']=='yunipals-ypal-ordinary-reader-source-v5' and value['wireManifestSha256']==WIRE_SHA and value['dataIdentity']==DATA_IDENTITY and
         set(value['files'])==CODE and not set(value['files'])&set(value['dependencies']) and set(value['contexts'])==set(CONTEXT_NAMES),
         'finite_explicit_V5_reader_manifest_required')
    need(value['transportQualification']=={'historicalProducerSha256':QUALIFIER_SHA,'historicalReceiptSha256':QUALIFICATION_SHA,
         'historicalStageSha256':STAGE_SHA,'newProducerSha256':TRANSPORT_SHA,'newQualificationFile':str(NEW_QUALIFICATION)},
         'separate_historical_dependency_and_new_public_byte_qualification_required')
    witness=value['canonicalWitness']
    need(set(witness)=={'captureId','resultSha256','witnessSha256'} and isinstance(witness['captureId'],str) and
         re.fullmatch('[a-z][a-z0-9-]{0,47}',witness['captureId']) and pin(witness['resultSha256']) and pin(witness['witnessSha256']),
         'actual_named_qualified_V5_witness_receipts_required')
    for role,name in CONTEXT_NAMES.items():
        ref=value['contexts'][role]
        need(set(ref)=={'file','sha256'} and ref['file']==name and ref['sha256']==CONTEXT_PINS[role] and value['dependencies'].get(name)==ref['sha256'],
             'fixed_new_context_filename_and_real_producer_required')
    need(value['dependencies'].get(FEATURE)==FEATURE_SHA and value['dependencies'].get(FEATURE_CONTEXT)==FEATURE_CONTEXT_SHA,
         'exact_new_feature_predicate_dependencies_required')
    return value

def observer_acknowledged(value, expected, producer):
    need(value['format']=='yunipals-ypal-ordinary-observer-retained-prefix-v1' and value['mode']=='new' and
         value['recordedActivationQualified'] is value['observerScopeOnly'] is value['ordinarySustainedObserver'] is True and
         value['receiptSha256'] == expected and value['operatorSha256'] == producer and
         value['releaseId'] == DATA_IDENTITY['sourceRelease'] and
         value['observerCurrentQualified'] is value['sourceActorQualified'] is value['currentWriterQualified'] is False and
         value['databaseWrites'] == value['serviceActions'] == value['providerRequests'] == 0,
         'actual_immutable_new_observer_ACK_required_without_current_lifecycle_claim')
    return value


def observer_identity(value):
    need(value['format']=='yunipals-ypal-ordinary-observer-retained-prefix-v1' and value['mode']=='new' and
         value['validated'] is value['observerCurrentQualified'] is value['observerScopeOnly'] is
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
    tree = ast.parse(raw); body = []; stripped = set(); login_changes = 0; inverse_terminal = None; state_changes=0
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in {'source_manifest', 'module'}: continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            replacements = {'FORMAT': repr(FORMAT), 'BASE': 'Path(' + repr(str(BASE)) + ')',
                            'SOURCE_MANIFEST': "OPS / 'ypal-ordinary-reader-cutover-v5.manifest.json'",
                            'IDENTITY':repr(DATA_IDENTITY['readIdentity']),'READ':repr(DATA_IDENTITY['readSchema']),
                            'MAIN_DIGEST':repr('f2fa474602b2df9012b9ce05561445a2247b16bb76808d8c3d6ca1d14b378d9f'),
                            'MAIN_INSTALL_SHA':repr('c0f4d50b5a3c7addb249f5eae39d50d929c35ea61dddd04c7a3d0c82b94419c0')}
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
                            value.value = 'yunipals-ypal-ordinary-reader-cutover-v5' if value.value.startswith('yunipals-') else 'ypal-ordinary-reader-cutover-v5.py'; login_changes += 1
                if isinstance(method,ast.FunctionDef) and method.name in {'sessions','terminal_sessions'}:
                    for value in ast.walk(method):
                        if isinstance(value,ast.Constant) and isinstance(value.value,str) and 'client_addr::text' in value.value:
                            value.value=value.value.replace('client_addr::text','host(client_addr)')
                if isinstance(method,ast.FunctionDef)and method.name=='state':
                    checks=[index for index,value in enumerate(method.body)if isinstance(value,ast.Expr)and isinstance(value.value,ast.Call)and ast.unparse(value.value.func)=='need'and
                            value.value.args and 'set(result) == set(STATE_PROPERTIES)'in ast.unparse(value.value.args[0])]
                    need(len(checks)==1,'one_original_complete_reader_manager_check_required')
                    block=ast.parse("""if result.get('LoadState')=='loaded':
    missing=set(STATE_PROPERTIES)-set(result)
    need(missing<={'ExecStartPre','ExecStartPost','ExecStop','ExecStopPost','ExecReload'},'only_missing_optional_Service_execution_arrays_may_be_qualified')
    obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isalnum()else'_'+format(ord(c),'02x')for c in unit)
    for key in sorted(missing):
        typed=json.loads(self.host.m.run(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',obj,'org.freedesktop.systemd1.Service',key]))
        need(type(typed)is dict and set(typed)=={'type','data'}and typed['type']=='a(sasbttttuii)'and typed['data']==[],'missing_reader_execution_hook_requires_genuine_typed_empty_array')
        result[key]=''
""").body[0]
                    method.body.insert(checks[0],block);state_changes+=1
                methods.append(method)
            node.body = methods
        body.append(node)
    need(stripped == EXCLUDED_METHODS and login_changes == 2 and inverse_terminal is not None and state_changes==1,
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
            def __init__(self,inputs):owner.initialize(self,inputs)
            def scope(self,enabled=None):return owner.scope(self,enabled)
            def inverse_scope(self,cache_reads=True):return owner.inverse_scope(self,cache_reads)
            def leaf_scope(self,feature_refs=None):return owner.leaf_scope(self,feature_refs)
            def generation(self):return self.phase.generation()
            def generation_terminal(self):return owner.generation_terminal(self)
            def metadata(self):return self.phase.metadata(lambda:owner.metadata_refresh(self,False))
            def metadata_inverse_context(self):return self.phase.metadata_inverse_context(lambda:owner.metadata_refresh(self,True))
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
        name = 'ypal-ordinary-cache-finish-v5.py'
        need(context.proof is self and context.inputs['sourceManifestSha256'] == self.manifest_sha,
             'same_current_coordinator_context_for_cache_inverse_required')
        return self.module(name, self.manifest['files'][name]).runtime(controller, self)

    def transport_current(self,qualification_sha=None):
        helper=load(QUALIFIER,QUALIFIER_SHA)
        ack=helper.document(QUALIFICATION,QUALIFICATION_SHA)
        need(ack['qualified']is True and ack['stageResultSha256']==STAGE_SHA and
             ack['applicationStarted']is ack['poolConstructed']is ack['coordinatorIntegrated']is False and
             ack['databaseConnections']==ack['providerCalls']==ack['serviceActions']==ack['existingPermissionChanges']==0,
             'actual_historical_dependency_qualification_required')
        if self._authorized_dependencies is None:
            dependency,entries=helper.production()
            need(dependency==ack['productionDependencies'],'same_acknowledged_installed_dependency_programs_required')
            tree=helper.preauthorize_dependencies(entries)
            need(tree==ack['preEvaluationDependencyProof'],'exact_dependency_tree_before_any_peer_evaluation_required')
            self._authorized_dependencies=tree
        qualification_sha=qualification_sha or getattr(self,'qualification_sha',None)
        need(pin(qualification_sha),'actual_new_V5_peer_qualification_receipt_required')
        record=self.document(NEW_QUALIFICATION,qualification_sha)
        peer=self.transport_module();peer.inputs()
        intent=self.document(NEW_QUALIFICATION.parent/'qualification-intent.json')
        need(intent=={key:record[key]for key in('format','producerSha256','publicFiles','historicalDependencyReceiptSha256')}and
             record['preEvaluationDependencyProof']==self._authorized_dependencies,'actual_exclusive_peer_capture_intent_and_dependency_proof_required')
        need(record['format']==peer.FORMAT and record['qualified']is True and record['producerSha256']==TRANSPORT_SHA and
             record['wireManifestSha256']==WIRE_SHA and record['historicalDependencyReceiptSha256']==QUALIFICATION_SHA and
             record['publicFiles']==peer.PINS and set(record['peers'])=={'postgres','main'} and
             record['databaseConnections']==record['providerCalls']==record['serviceActions']==record['permissionChanges']==0,
             'actual_new_public_bytes_and_two_restricted_peers_qualification_required')
        for kind in ['postgres','main']:
            current=peer.peer(kind);observed=record['peers'][kind]
            need(observed['format']==peer.FORMAT and observed['qualifiedPublicTransport']is True and observed['peer']==kind and
                 observed['sourceManifestSha256']==WIRE_SHA and observed['loaderSha256']==peer.LOADER_SHA and
                 observed['serviceChanges']==observed['filesystemPermissionChanges']==0 and observed['coordinatorIntegrated']is observed['provesNativeCutover']is False and
                 (observed['qualification']['uid'],observed['qualification']['gid'])==current and
                 observed['qualification']['capabilitiesEmpty']is observed['qualification']['noNewPrivileges']is True and
                 observed['qualification']['groups']in[[],[current[1]]] and observed['qualification']['installedPgImported']is True and
                 observed['qualification']['installedMainCodeReadable']is(kind=='main')and observed['qualification']['installedAppImported']is observed['qualification']['actualActionProbePassed']is False and observed['qualification']['transportAttempts']==observed['qualification']['databaseConnections']==0,
                 'same_current_numeric_restricted_peer_and_real_qualification_required')
        return {'qualified':True,'receiptSha256':qualification_sha,'producerSha256':TRANSPORT_SHA,
                'historicalDependencyReceiptSha256':QUALIFICATION_SHA,'dependencyAuthorizationAtCommandStart':self._authorized_dependencies,
                'sourceAuthority':False,'roleAuthority':False,'canonicalAuthority':False}

    def initialize(self, context, inputs):
        need(set(inputs) == INPUT_KEYS and all(pin(value) for value in inputs.values()) and
             inputs['sourceManifestSha256'] == self.manifest_sha, 'same_ten_actual_reader_phase_receipt_refs_required')
        observer = observer_acknowledged(self.module_context('observer').acknowledgement(inputs['sustainedObserverSha256']),
                    inputs['sustainedObserverSha256'], self.manifest['contexts']['observer']['sha256'])
        # No active-source predicate is called in construction. Forward scope,
        # inverse and a later source-independent reader leaf are distinct APIs.
        self.qualification_sha=inputs['transportQualificationSha256'];self.transport_current()
        phase = self.module_context('phase').create_phase(copy.deepcopy(inputs), copy.deepcopy(self.manifest))
        context.inputs = inputs; context.manifest = self.manifest; context.proof = self; context.phase = phase
        context.observer_acknowledgement = observer
        for name in ('cache', 'host', 'prepared', 'before', 'rehearsal', 'sql_ack'):
            need(hasattr(phase, name), 'authenticated_current_READ143_and_cache4_phase_objects_required')
            setattr(context, name, getattr(phase, name))
        need(context.prepared['prepared'] is True and context.prepared['nativeGenerationPublished'] is False and
             context.prepared['nativeWorkerStarted'] is False, 'actual_inactive_cache_and_unpublished_candidate_prerequisite_required')
        reference = phase.admission_ref
        name = 'ypal-ordinary-read-admission-v5b.py'
        need(reference['producerFile'] == str(OPS / name) and reference['producerSha256'] == self.pins[name] and
             reference['resultFile'] == '/var/backups/yunipals-ypal-ordinary-read-admission-v5b-20261025/result.json' and
             reference['receiptSha256'] == context.prepared['config']['readAdmissionSha256'] and
             reference['planSha256'] == inputs['readPlanSha256'] and
             reference['contextInputSha256'] == inputs['readContextInputSha256'],
             'same_actual_fresh143_producer_receipt_plan_and_context_required')
        context.publisher = self.module('ypal-generation-publisher-install-v1.py', self.DEPENDENCIES['ypal-generation-publisher-install-v1.py'])
        context.publisher_receipt = context.publisher.installed(context.host.m, inputs['publisherInstallSha256'])
        context.main = self.module(MAIN_INSTALLER,self.pins[MAIN_INSTALLER])
        context.main_receipt = context.main.installed(context.host.m, inputs['mainInstallSha256'])
        need(inputs['publisherInstallSha256'] == self.PUBLISHER_INSTALL_SHA and inputs['mainInstallSha256'] == self.MAIN_INSTALL_SHA,
             'same_actual_installed_reader_and_publication_artifacts_required')

    def scope(self,context,enabled=None):
        actual_enabled=context.logins_enabled()
        need(enabled is None or enabled is actual_enabled,'actual_owned_two_LOGIN_phase_required')
        baseline=context.sql_ack['postProof']['catalog'];expected=self.login_postcatalog(baseline)[0]if actual_enabled else baseline
        actual=context.catalog();self.exact_login_catalog(baseline,actual,actual_enabled)
        self.complete_cache_acl_baseline(baseline,actual);context.columns_current()
        phase=context.phase.scope(actual_enabled,expected)
        need(phase['validated']is True and context.catalog()==actual,'actual_V5_READ143_plus71_cache4_LOGIN_and_current_source_required')
        return {'format':FORMAT,'validated':True,'sourceManifestSha256':self.manifest_sha,
                'readAdmissionSha256':context.phase.admission_ref['receiptSha256'],'cachePreparedSha256':context.inputs['cachePreparedSha256'],
                'catalogSha256':sha(encoded(actual)),'currentPhase':phase,'sourceRuntime':phase['sourceBinding'],
                'apiLoginsEnabled':actual_enabled,'cacheGuard':context.guard_scope(True),
                'original143WholeValidatorPassed':False,'originalCacheWholeValidatorPassed':False,
                'databaseWrites':0,'serviceActions':0,'providerCalls':0}

    def inverse_scope(self,context,cache_reads=True):
        enabled=context.logins_enabled();baseline=context.sql_ack['postProof']['catalog']if cache_reads else context.host.read_rehearsal['after']
        expected=self.login_postcatalog(baseline)[0]if enabled else baseline;actual=context.catalog()
        need(context.host.read.acl_catalog(actual)==context.host.read.acl_catalog(expected),'exact_owned_inverse_catalog_and_columns_required')
        phase=context.phase.inverse_scope(cache_reads,enabled,expected)
        need(phase['validated']is True and context.catalog()==actual,'actual_ordinary_owned_active_or_terminal_inverse_phase_required')
        context.columns_current()
        return {'format':FORMAT,'validated':True,'inverseOnly':True,'ready':False,'sourceManifestSha256':self.manifest_sha,
                'catalogSha256':sha(encoded(actual)),'readAdmissionSha256':context.phase.admission_ref['receiptSha256'],
                'ownedCacheReadsPresent':cache_reads,'apiLoginsEnabled':enabled,'currentPhase':phase,'sourceState':phase['sourceBinding'],
                'cacheGuard':context.guard_scope(cache_reads),'sourceCoverageQualified':False,'original143WholeValidatorPassed':False,
                'databaseWrites':0,'serviceActions':0,'providerCalls':0}

    def leaf_scope(self,context,feature_refs=None):
        need(context.logins_enabled()is True and not(BASE/'inverse-intent.json').exists(),'completed_uninversed_reader_LOGIN_phase_required')
        feature=None
        if feature_refs is not None:
            need(type(feature_refs)is dict and set(feature_refs)=={'resultSha256','manifestSha256','inputSha256'}and all(pin(v)for v in feature_refs.values()),'actual_new_feature_receipt_refs_required')
            owner=self.module(FEATURE,FEATURE_SHA)
            need(owner.CONTEXT==OPS/FEATURE_CONTEXT and owner.CONTEXT_SHA==FEATURE_CONTEXT_SHA,'exact_new_feature_context_required')
            feature=owner.validate_feature_leaf(feature_refs['resultSha256'],feature_refs['manifestSha256'],feature_refs['inputSha256'])
            need(feature['format']=='yunipals-ypal-ordinary-feature-handover-v5' and feature['operatorSha256']==FEATURE_SHA and
                 feature['receiptSha256']==feature_refs['resultSha256'] and feature['validated']is feature['temporarySourceRetired']is feature['collectorOnlyCurrentGraphQualified']is True and
                 all(feature[k]is False for k in('sourceActorQualified','financialAuthorityQualified','independentPeerLifecyclesQualified','allConfiguredSourcesQualified','originalWholeValidatorsPassed','current143WholeGraphQualified')),
                 'actual_new_feature_collector_only_leaf_required')
        expected,_=self.login_postcatalog(context.sql_ack['postProof']['catalog']);current=context.catalog()
        value=self.reader_role_slice(expected,current,feature is not None);columns=context.host.read_host.catalog()['allColumnAcl']
        need(columns==context.sql_ack['postProof']['allColumnAcl'] and context.query(self.column_authority_sql([int(v)for v in self.LEAF_ROLES.values()]))==0,
             'all_grantee_columns_and_effective_owned_column_authority_required')
        guard=context.guard_scope(True)
        need(context.catalog()==current and context.host.read_host.catalog()['allColumnAcl']==columns,'current_reader_graph_changed_during_leaf')
        return {**value,'validated':True,'readAdmissionSha256':context.phase.admission_ref['receiptSha256'],'feature':feature,
                'cacheGuard':guard,'allColumnAclSha256':sha(encoded(columns)),'allGranteeColumnACLsQualified':True,
                'sourceReadinessQualified':False,'currentWriterQualified':False,'originalWholeValidatorPassed':False,
                'databaseWrites':0,'serviceActions':0,'providerCalls':0}

    def generation_terminal(self,context):
        generation,candidate,operation,_=context.generation();m=context.host.m;rows={}
        for name in(generation.LEADER,generation.UNIT):
            keys=('Id','ActiveState','SubState','MainPID','ControlPID','Job')
            raw=m.run(['/usr/bin/systemctl','show','--all',name,*['--property='+key for key in keys]])
            state=dict(line.split('=',1)for line in raw.decode().splitlines())
            need(set(state)==set(keys)and state['Id']==name,'complete_owned_generation_terminal_state_required')
            rows[name]=self.terminal(state,operation['oldActor']['processes']if name==generation.LEADER else())
        metadata=self.module_context('metadata').namespace(context.prepared['config']['metadataInputSha256'])
        need(not os.path.lexists(generation.BOOT)and metadata.link(generation.BASE/'original-boot-link')==operation['oldBoot'],
             'recurring_generation_boot_must_stay_owned_and_disabled')
        return {'candidateOperationSha256':candidate['operationSha256'],'units':rows,'recurringGenerationStarted':False}

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

    def separate_witnesses(self,controller,context):
        observer=self.module_context('observer');reference=self.manifest['contexts']['observer']
        source=context.host.read_host.runtime();before=observer.validate_current(context.inputs['sustainedObserverSha256']);identity=observer_identity(before)
        witness_ref=self.manifest['canonicalWitness'];base=Path('/var/backups/yunipals-ypal-ordinary-v5-fixed-boundary-witness-v1-20261025/captures')/witness_ref['captureId']
        result=self.document(base/'result.json',witness_ref['resultSha256'])
        need(result['completed']is result['qualified']is result['sourceBeforeAfterReady']is True and result['witnessSha256']==context.inputs['parityWitnessSha256']==witness_ref['witnessSha256'] and
             result['witnessFile']==str(base/'witness.json'),'actual_new_named_qualified_V5_capture_required')
        captured=self.document(base/'witness.json',context.inputs['parityWitnessSha256'])
        parity_path=Path('/var/backups/yunipals-ypal-ownership-parity-v1-20261024/parity.json')
        parity=controller.public_input(parity_path,'b04ff03dadbc8fa8f167fdec862b071ee4dc6e89268bed84a5260c77c2290aa4')
        retained=self.document(base/'retained-runtime-plan.json')
        baseline=controller.public_input(Path(retained['baselineFile']),'69f91e57c10171dd7b8ab2424236dd22c07e913b27b0376fdc579bde0d549540')
        value=controller.child(context,'witness',{'witness':captured,'parityBytes':parity.decode(),'baselineBytes':baseline.decode()})
        need(value['validated']is value['allSixCollections']is value['canonicalWitnessQualifiedAtCapture']is True and
             value['currentReadinessQualified']is False and value['sourceRelease']==self.RELEASE and value['readIdentity']==self.IDENTITY,
             'actual_all_six_V5_canonical_witness_without_ongoing_readiness_claim_required')
        after=context.host.read_host.runtime()
        need(after==source and observer_identity(observer.validate_current(context.inputs['sustainedObserverSha256']))==identity,
             'current_source_or_observer_changed_during_V5_witness_validation')
        dataset={key:source[key]for key in('sourceRelease','manifestHash','schema','schemaOid','buildId')}
        dataset['nativeTableIdentitiesSha256']=sha(encoded(source['nativeTableIdentities']))
        need(before['dataIdentity']==dataset and before['initialSourceContext']==context.observer_acknowledgement['initialSourceContext'],
             'same_registered_native44_observer_dataset_required')
        return {'sixCollectionWitnessSha256':context.inputs['parityWitnessSha256'],'sustainedObserverSha256':context.inputs['sustainedObserverSha256'],
                'witnessProducerSha256':controller.PARITY_OWNER_SHA,'observerProducerSha256':reference['sha256'],
                'dataIdentity':dataset,'initialObserverSourceContext':before['initialSourceContext'],'observerQualifiesCurrentWriter':False}

