#!/usr/bin/env python3
"""Explicit successor namespace for frozen reader transactions and FD transport.

No old module globals or receipts are changed. A separate current phase facade
must authenticate the fresh READ/cache/metadata/generation/observer receipts.
"""
import argparse
import contextlib
import io
import os
import time
import ast
import copy
import hashlib
import json
from pathlib import Path
import signal
import stat
import sys
import types

FORMAT = 'yunipals-ypal-ordinary-reader-cutover-v6'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-ordinary-reader-cutover-v6-20261025')
MANIFEST = OPS / 'ypal-ordinary-reader-cutover-v6.manifest.json'
PROOF = 'ypal-ordinary-reader-proof-v6.py'
TEMPLATE = OPS / 'ypal-native-cutover-v1.py'
TEMPLATE_SHA = '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b'
PROTOCOL = OPS / 'ypal-ordinary-publication-protocol-v6.py'
PROTOCOL_SHA = '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502'
WIRE_MANIFEST_SHA = 'f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4'


def need(value, reason):
    if not value: raise RuntimeError(reason)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def protected(path, expected=None, maximum=200000):
    path = Path(path)
    for parent in [*path.parents, path]:
        row = parent.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             'protected_explicit_reader_successor_source_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
         'bounded_regular_reader_successor_source_required')
    raw = path.read_bytes(); after = path.lstat()
    need(len(raw) == before.st_size and
         all(getattr(before, key) == getattr(after, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) and
         (expected is None or sha(raw) == expected), 'exact_unchanged_reader_successor_source_required')
    return raw


def statement(text): return ast.parse(text).body[0]


def transported_function(original):
    """Three exact launch seams; held-XID/session/ACK/cleanup body retained."""
    function = copy.deepcopy(original)
    need(function.name in {'child', 'action_preflight'}, 'only_two_fixed_reader_launch_functions_allowed')
    kind = 'postgres' if function.name == 'child' else 'main'
    assignments = [node for node in ast.walk(function) if isinstance(node, ast.Assign) and
                   len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'args']
    need(len(assignments) == 1 and isinstance(assignments[0].value, ast.List), 'single_frozen_setpriv_argument_list_required')
    args = assignments[0].value
    need(ast.unparse(args.elts[-2]) == 'NODE' and
         ast.unparse(args.elts[-1]) == ("str(ENTRY)" if kind == 'postgres' else "str(OPS / 'ypal-native-reader-probe-v1.mjs')"),
         'exact_frozen_Node_and_logical_entry_arguments_required')
    args.elts[-2:] = [ast.Starred(value=ast.parse('public.node_arguments(' + repr(kind) + ')', mode='eval').body, ctx=ast.Load())]
    launches = [node for node in ast.walk(function) if isinstance(node, ast.Call) and ast.unparse(node.func) == 'subprocess.Popen']
    need(len(launches) == 1 and not any(key.arg == 'pass_fds' for key in launches[0].keywords), 'single_frozen_child_spawn_required')
    envs = [key for key in launches[0].keywords if key.arg == 'env']
    need(len(envs) == 1, 'one_existing_private_or_clean_environment_required')
    envs[0].value = ast.Dict(keys=[None, None], values=[envs[0].value, ast.parse('public.environment', mode='eval').body])
    launches[0].keywords.append(ast.keyword(arg='pass_fds', value=ast.parse('public.pass_fds', mode='eval').body))
    # The child protocol still authenticates efca and its unchanged950b bytes.
    # The separate v2 manifest authenticates this owner/facade/transport instead.
    wires = 0
    for node in ast.walk(function):
        if isinstance(node, ast.Dict):
            for index, key in enumerate(node.keys):
                if isinstance(key, ast.Constant) and key.value == 'sourceManifestSha256':
                    need(ast.unparse(node.values[index]) == "context.inputs['sourceManifestSha256']",
                         'single_original_wire_manifest_expression_required')
                    node.values[index] = ast.Constant(WIRE_MANIFEST_SHA); wires += 1
    need(wires == 1, 'exactly_one_frozen_wire_manifest_field_per_launch_required')
    function.body = [ast.With(items=[ast.withitem(context_expr=ast.parse('public_scope(context)', mode='eval').body,
                                                 optional_vars=ast.Name(id='public', ctx=ast.Store()))], body=function.body)]
    return ast.fix_missing_locations(function)


def assemble(template, proof):
    """Construct a NEW explicit namespace, never mutate/import the old owner."""
    need(sha(template) == TEMPLATE_SHA, 'exact_frozen344_transaction_template_required')
    protocol = proof.module(PROTOCOL.name, PROTOCOL_SHA)
    tree = ast.parse(template)
    values = {
        'FORMAT': ("'yunipals-ypal-native-cutover-v1'", repr(FORMAT)),
        'BASE': ("Path('/var/backups/yunipals-ypal-native-cutover-v1-20261024')", repr(str(BASE))),
        'MANIFEST': ("OPS / 'ypal-native-cutover-v1.manifest.json'", "OPS / 'ypal-ordinary-reader-cutover-v6.manifest.json'"),
        'PROOF': ("'ypal-native-cutover-proof-v1.py'", repr(PROOF)),
        'ENTRY':("OPS / 'ypal-native-cutover-v1.mjs'","OPS / 'ypal-ordinary-reader-sql-v6.mjs'"),
        'PARITY_OWNER':("'fixed-boundary-witness-v3.mjs'",repr('fixed-boundary-witness-v5.mjs')),
        'PARITY_OWNER_SHA':(repr('bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c'),repr('359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484'))
    }
    changed = set(); body = []; definitions = {}
    for node in tree.body:
        if isinstance(node, ast.If):
            need(ast.unparse(node.test) == "__name__ == '__main__'", 'only_original_CLI_guard_may_be_omitted')
            continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in values:
                expected, replacement = values[name]
                need(ast.unparse(node.value) == expected, 'exact_frozen_owner_identity_constant_required')
                node = copy.deepcopy(node)
                node.value = ast.parse('Path(' + replacement + ')' if name == 'BASE' else replacement, mode='eval').body
                changed.add(name)
        if isinstance(node, ast.FunctionDef):
            definitions[node.name] = ast.dump(node, include_attributes=False)
            if node.name in {'load_proof', 'separate_witnesses', 'cache_finish_module'}:
                continue
            if node.name == 'recover_metadata':
                node = copy.deepcopy(node)
                captures = [call for call in ast.walk(node) if isinstance(call, ast.Call) and
                            ast.unparse(call) == 'h.actor(metadata_op, True, pristine=False)']
                need(len(captures) == 1, 'one_frozen_active_metadata_inverse_capture_required')
                call = captures[0]; call.func = ast.Name(id='metadata_inverse_actor', ctx=ast.Load())
                call.args = [ast.Name(id=name, ctx=ast.Load()) for name in ('context', 'owner', 'h', 'metadata_op', 'selection')]
                call.keywords = []
            if node.name == 'inputs':
                node = copy.deepcopy(node)
                keys = next((row for row in node.body if isinstance(row, ast.Assign) and
                             len(row.targets) == 1 and isinstance(row.targets[0], ast.Name) and row.targets[0].id == 'keys'), None)
                need(keys is not None and isinstance(keys.value, ast.Set) and
                     {value.value for value in keys.value.elts} == {'sourceManifestSha256', 'cachePreparedSha256',
                        'publisherInstallSha256', 'mainInstallSha256', 'parityWitnessSha256', 'sustainedObserverSha256'},
                     'exact_frozen_six_receipt_input_contract_required')
                keys.value.elts.extend(ast.Constant(value) for value in
                                      ('readPlanSha256', 'readContextInputSha256', 'cacheInputsSha256','transportQualificationSha256'))
            if node.name in {'child', 'action_preflight'}:
                node = transported_function(node)
                if node.name == 'child': node = protocol.reader_parent_window(node)
        if isinstance(node,ast.FunctionDef) and node.name=='owned_peer_session':
            node=copy.deepcopy(node);changes=0
            for value in ast.walk(node):
                if isinstance(value,ast.Constant) and isinstance(value.value,str) and 'client_addr::text' in value.value:
                    value.value=value.value.replace('client_addr::text','host(client_addr)');changes+=1
            need(changes==1,'exact_owned_peer_host_address_SQL_seam_required')
        body.append(node)
    need(changed == set(values), 'exact_new_V5_owner_wire_and_witness_constants_required')
    module = types.ModuleType('explicit_ypal_native_cutover_v2')
    module.__file__ = str(Path(__file__).absolute())

    def public_scope(context):
        from contextlib import contextmanager
        @contextmanager
        def opened():
            proof.transport_current()
            transport = proof.transport_module()
            with transport.public_transport() as public:
                yield public
            proof.transport_current()
        return opened()

    def load_proof(pin):
        need(pin == proof.manifest_sha, 'same_explicit_new_root_manifest_required')
        return proof

    def separate_witnesses(context):
        return proof.separate_witnesses(module, context)

    def cache_finish_module(context):
        return proof.cache_finish_module(module, context)

    def metadata_inverse_actor(context, owner, host, operation, selection):
        return proof.metadata_inverse_actor(context, owner, host, operation, selection)

    module.__dict__.update(public_scope=public_scope, load_proof=load_proof, separate_witnesses=separate_witnesses,
                           cache_finish_module=cache_finish_module, metadata_inverse_actor=metadata_inverse_actor)
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), module.__file__, 'exec'), module.__dict__)
    module.reuse_evidence = {'templateSha256': TEMPLATE_SHA, 'newOwnerConstants': sorted(changed),
        'launchFunctions': ['child', 'action_preflight'], 'additionalReceiptInputs':
            ['readPlanSha256', 'readContextInputSha256', 'cacheInputsSha256','transportQualificationSha256'], 'unchangedFunctionCount': len(definitions) - 8,
        'inverseMetadataCaptureSeam': 'exact_selected_active_or_terminal_without_dispatch',
        'unchangedFunctionsSha256': sha(json.dumps({name: sha(body.encode()) for name, body in definitions.items()
             if name not in {'child', 'action_preflight', 'inputs', 'load_proof', 'separate_witnesses', 'cache_finish_module', 'recover_metadata','owned_peer_session'}}, sort_keys=True).encode()),
        'wireManifestSha256': WIRE_MANIFEST_SHA, 'historicalModulePatched': False,
        'sourceDependentConstructorInherited': False, 'originalWholeValidatorPassed': False}
    return module


def core(manifest_sha):
    manifest = json.loads(protected(MANIFEST, manifest_sha, 100000))
    need(manifest.get('format') == 'yunipals-ypal-ordinary-reader-source-v6' and
         manifest['files'][Path(__file__).name] == sha(protected(Path(__file__).absolute())),
         'exact_new_external_coordinator_manifest_required')
    raw = protected(OPS / PROOF, manifest['files'][PROOF])
    facade = types.ModuleType('explicit_current_reader_proof'); facade.__file__ = str(OPS / PROOF)
    exec(compile(raw, facade.__file__, 'exec'), facade.__dict__)
    proof = facade.Proof(manifest_sha)
    return assemble(protected(TEMPLATE, TEMPLATE_SHA), proof),proof


def acknowledgement(result_sha,manifest_sha):
    """Recorded publication/reader ancestry only; no live actor or graph claim."""
    root,proof=core(manifest_sha);operation,publication,_=root.published(proof)
    result=root.document(BASE/'result.json',result_sha)
    need(result['format']==FORMAT and result['completed']is result['readersCutOver']is result['nativeGenerationPublished']is True and
         result['operatorSha256']==operation['binding']['operatorSha256']==sha(protected(Path(__file__).absolute())) and
         result['operationSha256']==sha(root.public_input(BASE/'operation.json')) and result['sourceManifestSha256']==manifest_sha and
         result['publicationSha256']==sha(root.public_input(root.PUBLICATION/'published.json')),
         'actual_completed_new_reader_operation_and_publication_chain_required')
    inputs=operation['binding']['inputs']
    phase=proof.module_context('phase');cache_config=phase.common().intake().document(phase.INPUT,inputs['cacheInputsSha256'])
    read_config={'admissionSha256':cache_config['readAdmissionSha256'],'readPlanSha256':inputs['readPlanSha256'],'readContextInputSha256':inputs['readContextInputSha256']}
    phase.common().authenticate_recorded_read(read_config)
    return {'validated':True,'immutableReaderAcknowledgementOnly':True,'receiptSha256':result_sha,
       'operatorSha256':result['operatorSha256'],'manifestSha256':manifest_sha,'operationSha256':result['operationSha256'],
       'readSchema':proof.READ,'readIdentity':proof.IDENTITY,'sourceRelease':proof.RELEASE,'readConfig':read_config,
       'cachePreparedSha256':inputs['cachePreparedSha256'],'cacheInputsSha256':inputs['cacheInputsSha256'],
       'publicationSha256':result['publicationSha256'],'published':True,'readerActors':result['readerActors'],
       'currentReadersQualified':False,'currentWriterQualified':False,'sourceActorQualified':False,
       'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def validate_current(result_sha,manifest_sha):
    root,proof=core(manifest_sha)
    return root.validate_current(result_sha,manifest_sha)


def validate_cache_ready(result_sha,cache_prepared_sha,generation_sha):
    """Existing cache publication prerequisite; actual three-reader ACK only."""
    result=json.loads(protected(BASE/'result.json',result_sha,3000000))
    need(result['cachePreparedSha256']==cache_prepared_sha and result['generationCandidateSha256']==generation_sha,
         'same_actual_cutover_cache_and_generation_prerequisite_refs_required')
    return validate_current(result_sha,result['sourceManifestSha256'])


def validate_reader_leaf(result_sha,manifest_sha,feature_refs=None):
    root,proof=core(manifest_sha)
    return root.validate_reader_leaf(result_sha,manifest_sha,feature_refs)


def validate_cache_leaf(result_sha,manifest_sha,feature_refs=None):
    root,proof=core(manifest_sha)
    return proof.cache_finish_module(root,types.SimpleNamespace(proof=proof,inputs={'sourceManifestSha256':manifest_sha})).validate_cache_leaf(result_sha,manifest_sha,feature_refs)


def validate_inverse_leaf(result_sha,manifest_sha):
    root,proof=core(manifest_sha)
    name='ypal-native-inverse-leaf-v1.py';digest='d5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28'
    # The accepted inverse validator is compiled in a NEW explicit namespace.
    # Its current catalog method is V5 and source-independent; action gates stay
    # in the forward/inverse owners and are never replaced by this read-only leaf.
    common=proof.module_context('common');factory=common.module(common.FACTORY,common.FACTORY_SHA)
    raw=proof.protected(OPS/name)
    need(sha(raw)==digest,'exact_completed_inverse_template_required')
    def completed_catalog(context):
        need(context.logins_enabled()is False,'completed_inverse_requires_reversed_two_LOGIN_bits')
        reference=context.phase.admission_ref
        graph=proof.module('ypal-ordinary-read-admission-v5b.py',proof.pins['ypal-ordinary-read-admission-v5b.py']).validate_catalog_current(reference['receiptSha256'])
        need(graph['validated']is graph['catalogOnly']is True and graph['readEdgeCount']==71 and
             graph['receiptSha256']==reference['receiptSha256'] and graph['planSha256']==reference['planSha256'] and
             graph['contextInputSha256']==reference['contextInputSha256'] and graph['sourceActorQualified']is graph['financialAuthorityQualified']is False,
             'actual_source_independent_READ143_plus_V5_logical_catalog_required')
        current=context.catalog();baseline=context.host.read_rehearsal['after']
        columns=context.host.read_host.catalog()['allColumnAcl']
        need(context.host.read.acl_catalog(current)==context.host.read.acl_catalog(baseline) and columns==context.sql_ack['postProof']['allColumnAcl'],
             'exact_restored_READ143_plus71_NOLOGIN_no_cache4_and_all_columns_required')
        context.columns_current();guard=context.guard_scope(False)
        need(context.catalog()==current,'restored_catalog_changed_during_guard_validation')
        return {'format':FORMAT+'-inverse-catalog','validated':True,'readAdmissionSha256':reference['receiptSha256'],
             'readPlanSha256':reference['planSha256'],'readContextInputSha256':reference['contextInputSha256'],
             'catalogSha256':sha(common.encoded(context.host.read.acl_catalog(current))),'allColumnAclSha256':sha(common.encoded(columns)),
             'cacheGuard':guard,'twoLOGINReversed':True,'cache4Reversed':True,'read143Preserved':True,'V5EquivalentReadsPreserved':True,
             'sourceActorQualified':False,'currentWriterQualified':False,'financialAuthorityQualified':False,
             'originalWholeValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    changes={'cache-format':0}
    def transform(node):
        if isinstance(node,ast.FunctionDef)and node.name=='recovered_cache':
            for value in ast.walk(node):
                if isinstance(value,ast.Constant)and value.value=='yunipals-ypal-cache-finish-v3':
                    value.value='yunipals-ypal-ordinary-cache-finish-v6';changes['cache-format']+=1
        return node
    leaf=factory.namespace(raw,digest,Path(__file__).absolute(),{'FORMAT':FORMAT+'-inverse-leaf','ROOT_SHA':sha(protected(Path(__file__).absolute())),'MANIFEST_SHA':manifest_sha},
       {'load_root':lambda _:(root,proof),'completed_catalog':completed_catalog},transform)
    need(changes=={'cache-format':1},'one_completed_cache_receipt_domain_seam_required')
    return leaf.inspect(root,proof,result_sha,manifest_sha)


def main():
    need(len(sys.argv)==1 or sys.argv[1:]==['--static'],
         'publication_V6_operations_require_actual_caller_context_and_timing_gate')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'callerRequired':True,
                     'productionTimingQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_cutover_owner_deadline_unknown_effect_reconcile_only'))
    signal.alarm(1800)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and str(error).replace('_', '').isalnum() else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
    finally: signal.alarm(0)
