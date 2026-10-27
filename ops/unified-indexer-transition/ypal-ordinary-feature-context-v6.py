#!/usr/bin/env python3
"""Ordinary writer/V6 publication with V5 READ composition for the unchanged fresh-feature bodies.

Only static primitives are constructed. Operational source authority is separate
from source-independent feature/inverse leaves and is never inherited from c96.
"""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FORMAT = 'yunipals-ypal-ordinary-feature-handover-v6'
READ_SCHEMA = 'yunipals_ownership_4e77f52b_v5'
READ_IDENTITY = '0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab'
PROVIDER = 'ypal-ordinary-read-cache-v6.py'
READER = 'ypal-ordinary-reader-cutover-v6.py'
BUSINESS_EVENTS = {'RequestCreated', 'RequestCompleted'}
EVENT_FIELDS = {'id', 'address', 'name', 'args', 'block_number', 'block_hash',
                'timestamp', 'transaction_hash', 'log_index'}
PINNED = {
 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be',
 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c',
 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986',
 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5',
 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd',
 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3',
 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2',
 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb',
 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035',
 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e'
}
CONFIG = {'readAdmissionSha256', 'readPlanSha256', 'readContextInputSha256', 'cachePreparedSha256',
          'cacheInputsSha256', 'readerResultSha256', 'readerManifestSha256', 'ordinaryResultSha256', 'ordinaryInputSha256'}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) and value != '0'*64


def wrap_leaf_return(node, function_name):
    """Add ancestry after the retained leaf's complete genuine validation body."""
    returns = [item for item in ast.walk(node) if isinstance(item, ast.Return)]
    need(len(returns) == 1 and isinstance(node.body[-1], ast.Return) and
         isinstance(returns[0].value, ast.Dict), 'one_retained_feature_leaf_result_dictionary_required')
    returns[0].value = ast.Call(func=ast.Name(id=function_name, ctx=ast.Load()),
                               args=[ast.Name(id='h', ctx=ast.Load()), returns[0].value], keywords=[])


def wrap_leaf_return_seam(value, raw):
    """The business leaf runs in V6 globals; its sole return gains exact refs."""
    tree = ast.parse(raw)
    leaf = copy.deepcopy(next(node for node in tree.body if isinstance(node, ast.FunctionDef) and
                              node.name == 'validate_feature_leaf'))
    wrap_leaf_return(leaf, 'feature_leaf_binding')
    value.feature_leaf_binding = feature_leaf_binding
    exec(compile(ast.fix_missing_locations(ast.Module(body=[leaf], type_ignores=[])),
                 value.__file__, 'exec'), value.__dict__)


def feature_leaf_binding(h, proof):
    """Finite public ancestry; confers no source or whole-reader authority.

    Both retained forward/inverse leaf bodies reach this only after their
    genuine receipt, actors, grants, availability and rollback checks. The
    coordinator acknowledgement is immutable and never calls a feature leaf.
    """
    files = h.manifest['files']
    need(type(proof) is dict and proof.get('validated') is True and
         proof.get('operatorSha256') == files['ypal-ordinary-feature-handover-v6.py'] and
         pin(proof.get('receiptSha256')) and pin(h.manifest_pin) and pin(h.input_pin) and
         proof.get('sourceActorQualified') is proof.get('financialAuthorityQualified') is False and
         proof.get('originalWholeValidatorsPassed') is False and
         proof.get('databaseWrites') == proof.get('serviceActions') == proof.get('providerCalls', 0) == 0,
         'retained_validated_feature_leaf_without_source_or_whole_validator_authority_required')
    recorded = reader_ancestry(h)
    ancestry = {
        'readerResultSha256': recorded['receiptSha256'],
        'readerManifestSha256': recorded['manifestSha256'],
        'readerOperatorSha256': recorded['operatorSha256'],
        'readerOperationSha256': recorded['operationSha256'],
        'readerPublicationSha256': recorded['publicationSha256'],
        'readConfig': copy.deepcopy(recorded['readConfig']),
        'cachePreparedSha256': recorded['cachePreparedSha256'],
        'cacheInputsSha256': recorded['cacheInputsSha256']
    }
    need(not set(proof).intersection({'manifestSha256', 'inputSha256', 'contextSha256', 'readerAncestry'}),
         'new_feature_ancestry_envelope_must_not_shadow_retained_leaf_fields')
    return {**proof, 'manifestSha256': h.manifest_pin, 'inputSha256': h.input_pin,
            'contextSha256': files['ypal-ordinary-feature-context-v6.py'], 'readerAncestry': ancestry}


def exact_dependencies(value):
    need(type(value) is dict and set(value) == set(PINNED) | {PROVIDER, READER} and
         all(pin(v) for v in value.values()) and all(value[k] == v for k,v in PINNED.items()),
         'finite_real_feature_dependencies_and_external_exact_reader_provider_pins_required')
    return dict(value)


def helpers(b, dependencies):
    factory = b.module(OPS/'ypal-fresh-forward-epoch-v1.py', PINNED['ypal-fresh-forward-epoch-v1.py'])
    raw = b.protected(OPS/'ypal-restored-feature-context-v1.py')
    changes = {'provider': 0, 'address': 0, 'source-runtime-presentation': 0, 'inverse-envelope': 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == 'cache_receipts':
            for item in ast.walk(node):
                if isinstance(item, ast.Constant) and item.value == 'ypal-restored-read-cache-provider-v1.py':
                    item.value = PROVIDER; changes['provider'] += 1
        if isinstance(node, ast.FunctionDef) and node.name == 'temporary_sessions':
            for item in ast.walk(node):
                if isinstance(item, ast.Constant) and isinstance(item.value, str) and 'client_addr::text' in item.value:
                    need(item.value.count('client_addr::text') == 1, 'one_temporary_kernel_address_cast_required')
                    item.value = item.value.replace('client_addr::text', 'host(client_addr)'); changes['address'] += 1
        if isinstance(node, ast.FunctionDef) and node.name == 'capture_temporary':
            for index, item in enumerate(node.body):
                if isinstance(item, ast.Assign) and ast.unparse(item) == 'stable_state = copy.deepcopy(state)':
                    # source_static already proves literal loaded argv from the
                    # authenticated unit; peer signatures prove the actual live
                    # program. systemctl's last-command status resets on reload.
                    node.body.insert(index+1, ast.parse("stable_state.pop('ExecStart', None)").body[0])
                    changes['source-runtime-presentation'] += 1; break
        if isinstance(node, ast.FunctionDef) and node.name == 'inverse_leaf':
            wrap_leaf_return(node, 'feature_leaf_binding'); changes['inverse-envelope'] += 1
        return node
    n = factory.namespace(raw, PINNED['ypal-restored-feature-context-v1.py'], Path(__file__).absolute(),
         {'DEPENDENCIES': dependencies, 'CONFIG': CONFIG},
         {'initialize': initialize, 'reader_ancestry': reader_ancestry, 'inverse_catalog_phase': inverse_catalog_phase}, transform)
    n.feature_leaf_binding = feature_leaf_binding
    need(changes == {'provider': 1, 'address': 1, 'source-runtime-presentation': 1, 'inverse-envelope': 1}, 'exact_new_provider_TCP_address_and_checked_source_presentation_seams_required')
    return n


def initialize(h, b, manifest_pin, input_pin, canonical_ref, capture_id):
    h.b = b; h.manifest = b.document(b.MANIFEST, manifest_pin)
    files = {'ypal-ordinary-feature-handover-v6.py', 'ypal-ordinary-feature-context-v6.py'}
    need(set(h.manifest) == {'format', 'files', 'dependencies'} and h.manifest['format'] == FORMAT+'-code' and
         set(h.manifest['files']) == files and h.manifest['files']['ypal-ordinary-feature-handover-v6.py'] == b.sha(b.protected(Path(b.__file__).absolute())) and
         h.manifest['files']['ypal-ordinary-feature-context-v6.py'] == b.sha(b.protected(Path(__file__).absolute())),
         'exact_new_ordinary_feature_code_manifest_required')
    dependencies = exact_dependencies(h.manifest['dependencies'])
    for name, digest in dependencies.items(): need(b.sha(b.protected(OPS/name)) == digest, 'actual_exact_feature_dependency_file_required')
    h.config = b.document(b.INPUT, input_pin)
    need(type(h.config) is dict and set(h.config) == CONFIG and all(pin(v) for v in h.config.values()), 'actual_ordinary_READ_V5_cache_V6_reader_input_refs_required')
    h.helpers = helpers(b, dependencies)
    h.intake = b.module(OPS/'ypal-alchemy-ordinary-consumer-context-v1.py', PINNED['ypal-alchemy-ordinary-consumer-context-v1.py'])
    h.parts = h.intake.query_components()['components']; h.p = h.parts['privilegedSourcePrimitives']
    h.sdk = h.p['sdk']; h.raw = h.p['host'].raw
    h.static = types.SimpleNamespace(gone=known_gone)
    h.provider = b.module(OPS/PROVIDER, dependencies[PROVIDER])
    h.read, _, h.read_host, h.read_receipt, h.read_before, h.read_rehearsal = h.provider.static_read_host(h.config)
    h.coordinator = b.module(OPS/READER, dependencies[READER])
    cache_config = b.document(h.provider.INPUT, h.config['cacheInputsSha256'])
    coordinator_manifest = b.document(h.coordinator.MANIFEST, h.config['readerManifestSha256'])
    need(coordinator_manifest['files'][READER] == dependencies[READER], 'same_actual_reader_manifest_and_external_feature_dependency_required')
    h.cache = h.provider.cache_runtime(cache_config, coordinator_manifest)
    h.reader = b.load_fixed('ypal-reader-cutover-v1.py')
    h.consumer_helpers = b.module(OPS/'ypal-combined-read-admission-v2.py', PINNED['ypal-combined-read-admission-v2.py'])
    h.parity = b.module(OPS/'ypal-booster-source-parity-v1.py', PINNED['ypal-booster-source-parity-v1.py'])
    h.h = types.SimpleNamespace(m=types.SimpleNamespace(run=h.sdk.command, protected=h.sdk.protected))
    h.old = types.SimpleNamespace(h=types.SimpleNamespace(observer=h.raw.observer))
    h.old.core = types.SimpleNamespace(run=lambda argv, timeout=30: h.sdk.command(argv, timeout=timeout).decode(),
                                     sql=lambda text: h.read_host.query(text, False))
    h.old.query = lambda text: query_one(h.read_host, text)
    h.old.request = lambda path, public=False: h.reader.Host.request(h.old, path, public)
    h.old.actor = lambda unit, values: h.helpers.api_actor(h, unit, values)
    h.manifest_pin, h.input_pin = manifest_pin, input_pin
    h.canonical_ref, h.capture_id = canonical_ref, capture_id
    h.inverse_mode = False; h.first_effect_deadline = None
    # Construction authenticates immutable actual ACKs only; it does not demand
    # an initial standalone process after a later, explicitly owned handover.
    reader_ancestry(h)


def query_one(host, sql):
    value = host.query(sql)
    need(isinstance(value, list) and len(value) == 1, 'one_bounded_feature_SQL_value_required')
    return value[0]


def read_config(h):
    return {'admissionSha256': h.config['readAdmissionSha256'], 'readPlanSha256': h.config['readPlanSha256'],
            'readContextInputSha256': h.config['readContextInputSha256']}


def reader_ancestry(h):
    value = h.coordinator.acknowledgement(h.config['readerResultSha256'], h.config['readerManifestSha256'])
    need(value['validated'] is value['immutableReaderAcknowledgementOnly'] is value['published'] is True and
         value['receiptSha256'] == h.config['readerResultSha256'] and value['manifestSha256'] == h.config['readerManifestSha256'] and
         value['operatorSha256'] == h.manifest['dependencies'][READER] and pin(value['operationSha256']) and pin(value['publicationSha256']) and
         value['readSchema'] == READ_SCHEMA and value['readIdentity'] == READ_IDENTITY and value['sourceRelease'] == h.intake.DATA['sourceRelease'] and
         value['readConfig'] == read_config(h) and value['cachePreparedSha256'] == h.config['cachePreparedSha256'] and
         value['cacheInputsSha256'] == h.config['cacheInputsSha256'] and
         all(value[k] is False for k in ['currentReadersQualified', 'currentWriterQualified', 'sourceActorQualified']) and
         value['databaseWrites'] == value['serviceActions'] == value['providerCalls'] == 0,
         'actual_new_V6_reader_publication_READ_cache_chain_without_current_feature_recursion_required')
    return value


def inverse_catalog_phase(h, op, reader_inverse_refs):
    b = h.b; before, saved = h.helpers.cache_receipts(h)
    need(op['catalogBefore']['baseline'] == saved['postProof']['reader'], 'same_original_ordinary_V5_plus_cache4_collector_required')
    if reader_inverse_refs is None:
        expected = op['catalogBefore']; phase = {'phase': 'before-reader-inverse-V5-plus-cache4', 'readerInverseQualified': False}
    else:
        need(type(reader_inverse_refs) is dict and set(reader_inverse_refs) == {'result_sha', 'manifest_sha'} and
             all(pin(v) for v in reader_inverse_refs.values()) and reader_inverse_refs['manifest_sha'] == h.config['readerManifestSha256'],
             'explicit_same_completed_V5_reader_inverse_refs_required')
        proof = h.coordinator.validate_inverse_leaf(**reader_inverse_refs)
        binding, catalog = proof['binding'], proof['binding']['catalog']
        recorded = reader_ancestry(h)
        need(proof['validated'] is True and proof['bindingSha256'] == sha(encoded(binding)) and
             binding['manifestSha256'] == reader_inverse_refs['manifest_sha'] and binding['inverseResultSha256'] == reader_inverse_refs['result_sha'] and
             binding['records']['operation.json'] == recorded['operationSha256'] and
             all(catalog[k] == h.config[k] for k in ['readAdmissionSha256', 'readPlanSha256', 'readContextInputSha256']) and
             catalog['validated'] is catalog['read143Preserved'] is catalog['cache4Reversed'] is catalog['twoLOGINReversed'] is True and
             catalog['catalogSha256'] == sha(encoded(h.read.acl_catalog(h.read_rehearsal['after']['read']))) and
             catalog['allColumnAclSha256'] == sha(encoded(h.read_rehearsal['after']['allColumnAcl'])) and
             all(proof[k] is False for k in ['sourceActorQualified', 'currentWriterQualified', 'financialAuthorityQualified', 'currentReadinessQualified']),
             'actual_same_reader_completed_inverse_V5_full_catalog_and_column_proof_required')
        expected = h.helpers.restored_collector_baseline(b, op['catalogBefore'], before['catalog']['postProof']['reader'],
                       saved['postProof']['reader'], saved['result'], h.cache, h.parts['historicalReadHelpers'])
        phase = {'phase': 'after-completed-reader-inverse-V5', 'readerInverseQualified': True,
                 'readerInverseRefs': copy.deepcopy(reader_inverse_refs), 'readerInverseBindingSha256': proof['bindingSha256']}
    need(h.catalog() == expected, 'exact_feature_inverse_catalog_for_actual_reader_phase_required')
    return expected, phase


class HostMixin:
    def baseline(self): return self.helpers.cache_baseline(self)
    def fresh_event(self, event, minimum):
        """V6 additionally requires a real opening/claim request or fulfillment.

        The frozen gate accepted any canonical booster event. This deliberate
        successor gate first proves exactly one complete, identical business
        row in each schema, then executes that unchanged post-switch/canonical
        gate. Normal user activity supplies the event; no transaction is made.
        """
        need(type(event) is dict and set(event) == {'blockNumber', 'blockHash', 'transactionHash', 'logIndex'} and
             type(event['blockNumber']) is int and event['blockNumber'] > minimum and
             type(event['logIndex']) is int and event['logIndex'] >= 0 and
             all(isinstance(event[key], str) and re.fullmatch('0x[a-f0-9]{64}', event[key])
                 for key in ['blockHash', 'transactionHash']), 'genuine_post_switch_opening_or_claim_identity_required')
        b = self.b
        where = ('block_number=' + str(event['blockNumber']) + ' AND block_hash=' + b.literal(event['blockHash']) +
                 ' AND transaction_hash=' + b.literal(event['transactionHash']) + ' AND log_index=' + str(event['logIndex']))
        rows = self.query("SELECT jsonb_build_object('left',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb)FROM " +
                          b.FRESH + '.booster_event e WHERE ' + where +
                          "),'right',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb)FROM " +
                          b.TARGET + '.booster_event e WHERE ' + where + '))')
        need(type(rows) is dict and set(rows) == {'left', 'right'} and
             all(type(rows[key]) is list and len(rows[key]) == 1 for key in ['left', 'right']) and
             type(rows['left'][0]) is dict and set(rows['left'][0]) == EVENT_FIELDS and
             rows['left'][0] == rows['right'][0] and rows['left'][0]['name'] in BUSINESS_EVENTS and
             rows['left'][0]['block_number'] == event['blockNumber'] and
             rows['left'][0]['block_hash'] == event['blockHash'] and
             rows['left'][0]['transaction_hash'] == event['transactionHash'] and
             rows['left'][0]['log_index'] == event['logIndex'],
             'one_identical_genuine_opening_or_claim_event_payload_in_both_sources_required')
        return b.HistoricalHost.fresh_event(self, event, minimum)
    def peers(self):
        # The old helper object exposes only its exact SQL/edge functions; the
        # bounded actor frame is loaded separately from the pinned source.
        return self.consumer_helpers.consumer_frame(self.h)
    def retained_current(self):
        b = self.b; state = self.state(b.SOURCE)
        if state['MainPID'] != '0':
            if (b.BASE/'inverse-source-start-result.json').exists(): expected = b.document(b.BASE/'inverse-source-start-result.json')['result']
            elif (b.BASE/'operation.json').exists(): expected = b.document(b.BASE/'operation.json')['source']
            else: expected = None
            actor = self.source_actor(expected)['sdkActor']
            return {'validated': True, 'actors': {b.SOURCE: actor}, 'sourceActorQualified': False, 'financialAuthorityQualified': False,
                    'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
        self.terminal(b.SOURCE)
        op = b.document(b.BASE/'operation.json'); intent_file = b.BASE/'retire-source-stop-intent.json'
        intent = b.document(intent_file)
        need(intent['operationSha256'] == b.sha(b.protected(b.BASE/'operation.json')) and intent['bootId'] == b.boot(),
             'actual_owned_feature_retirement_stop_intent_before_empty_actor_set_required')
        known_gone(op['source']['sdkActor']['processes'])
        return {'validated': True, 'actors': {}, 'ownedTemporaryTerminal': True, 'retirementIntentSha256': b.sha(b.protected(intent_file)),
                'sourceActorQualified': False, 'financialAuthorityQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    def combined(self):
        refs = self.config; result, input_sha = refs['ordinaryResultSha256'], refs['ordinaryInputSha256']
        if self.inverse_mode:
            runtime = self.b.module(OPS/'ypal-alchemy-ordinary-runtime-v1.py', PINNED['ypal-alchemy-ordinary-runtime-v1.py'])
            owner = runtime.Owner(input_sha)
            if owner.h.source.state(runtime.SOURCE)['MainPID'] == '0':
                value = runtime.validate_current_source(result, input_sha, self.retained_current, inverse=True)
                need(value['validated'] is value['terminalInverseOnly'] is True and value['sourceState'] == 'owned-terminal', 'own_ordinary_terminal_source_inverse_proof_required')
                return {'inverseOnly': True, 'terminal': True, 'ordinaryResultSha256': result}
        value = self.intake.validate_runtime(result, input_sha, retained_current=self.retained_current)
        return {'ordinaryResultSha256': result, 'ordinaryInputSha256': input_sha, 'binding': value,
                'source': value['sourceKernelActors'][self.b.COMBINED], 'terminal': False,
                'sourceKind': 'ordinary-standalone', 'oldSourceReceiptRelabelled': False}
    def source_actor(self, expected=None): return self.helpers.HostMixin.source_actor(self, expected)
    def restart_temporary_source(self, intent, original): return self.helpers.HostMixin.restart_temporary_source(self, intent, original)
    def inverse_source(self): return self.helpers.HostMixin.inverse_source(self)
    def sessions(self, temporary=None):
        proof = self.combined(); source = None if proof.get('terminal') else proof['source']
        runtime = self.b.module(OPS/'ypal-alchemy-ordinary-runtime-v1.py', PINNED['ypal-alchemy-ordinary-runtime-v1.py'])
        owner = runtime.Owner(self.config['ordinaryInputSha256'])
        # Its fixed-role mapper owns every current shared73004621 backend,
        # including the exact temporary actor or acknowledged stopped prefix.
        return owner.h.source_sessions(source, self.retained_current)
    def queue_proof(self, since, minimum): return self.helpers.HostMixin.queue_proof(self, since, minimum)


def inverse_leaf(b, result_sha, manifest_sha, input_sha, reader_inverse_refs=None):
    # Unchanged 11b leaf uses this new namespace's explicit catalog phase and
    # current temporary actor; no active original/ordinary writer is requested.
    manifest = b.document(b.MANIFEST, manifest_sha)
    return helpers(b, exact_dependencies(manifest['dependencies'])).inverse_leaf(b, result_sha, manifest_sha, input_sha, reader_inverse_refs)


def known_gone(processes):
    for row in processes:
        need(type(row['pid']) is int and row['pid'] > 1 and type(row['startTicks']) is int and row['startTicks'] > 0,
             'exact_known_temporary_process_epoch_required')
        try: raw = (Path('/proc')/str(row['pid'])/'stat').read_text()
        except (FileNotFoundError, ProcessLookupError): continue
        need(int(raw[raw.rfind(')')+2:].split()[19]) != row['startTicks'], 'known_temporary_epoch_still_alive_even_outside_cgroup')
