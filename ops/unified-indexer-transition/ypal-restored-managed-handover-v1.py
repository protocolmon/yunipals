#!/usr/bin/env python3
"""Restored-epoch managed EVM/Solana handover. Source preparation, not authority.

The managed writer owns its own epochs. Historical de4/c96 and the independent
observer are never labelled as the current managed writer. Real prerequisite
receipts and exact reviewed producer references are mandatory.
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

FORMAT = 'yunipals-ypal-restored-managed-handover-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-restored-managed-handover-v1-20261024')
INPUT = Path('/var/backups/yunipals-ypal-restored-managed-input-v1-20261024/input.json')
INVERSE_INPUT = Path('/var/backups/yunipals-ypal-restored-managed-inverse-input-v1-20261024/input.json')
MANIFEST = OPS / 'ypal-restored-managed-handover-v1.manifest.json'
STAGE = OPS / 'ypal-restored-managed-indexer-v1'
HOLD = Path('/etc/systemd/system/.ypal-restored-managed-handover-v1')
TEMPLATE = OPS / 'ypal-managed-handover-v1.py'
TEMPLATE_SHA = 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea'
CURRENT = OPS / 'ypal-restored-read-current-context-v1.py'
CURRENT_SHA = 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932'
STATIC = OPS / 'ypal-restored-metadata-context-v1.py'
STATIC_SHA = 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
OBSERVER = OPS / 'ypal-restored-ordinary-observer-v1.py'
OBSERVER_SHA = '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3'
RPC = OPS / 'ypal-retained-proxy-current-v3.py'
RPC_SHA = '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf'
RPC_ACK = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
RESTORE_ACK = '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'
DEADLINE = OPS / 'ypal-rpc-deadline-host-build-v1/rpc-preflight.ts'
DEADLINE_SHA = '690b6dda7357390ae4d6bb063b30776cdd6da3a8beefa54d4d60b0092f392192'
HOST_BUILD = Path('/var/backups/yunipals-rpc-deadline-host-build-v1-20261024/result.json')
HOST_BUILD_SHA = '551f6a98bb2725444d8a65887912f442967cc5b657cdf082029e007672c769f7'
HOST_BUILD_OWNER_SHA = 'e9e84e7450debf66295279c92ffd67d0a5e8a28a2b3afc3599338c11ce271f90'
ALL_COLUMNS = OPS / 'ypal-restored-read-admission-v1.columns.sql'
ALL_COLUMNS_SHA = '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf'
PINS = {'launcher.mjs': 'd3e849e2f05a7c33c7164d649c6f1db28f6a70202b3308dada3989be634bc321',
        'service.public.env': '0fe3a64a989f61fe5394e9089dc3c3302f6bc7321f901b31b9f22e776952d33a',
        'yunipals-indexer.service.example': '33d47b7f75ee40c40af0b71c18cefe9ebce08f64f877e3051f5f71bb1e009cda'}
SOURCE = 'yunipals-ypal-combined-source.service'
PARENT = 'yunipals-indexer.service'
SOLANA = 'yunipals-solana.service'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
MANIFEST_HASH = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
SCHEMA = 'unified_ypal_20261023_v1'
BUILD = '71e2a7f3b7'
KNOWN_CODE = {'readerCachePhase': 'ypal-restored-reader-cache-phase-v1.py',
              'feature': 'ypal-restored-feature-handover-v1.py', 'arena': 'arena-ypal-restored-v1.py',
              'readerInverse': 'ypal-native-inverse-leaf-v1.py'}


def need(ok, code):
    if not ok: raise RuntimeError(code)
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): return isinstance(value, str) and value != '0' * 64 and re.fullmatch('[a-f0-9]{64}', value) is not None


def protected(path, expected=None, maximum=8000000):
    import stat
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'absolute_fixed_managed_source_input_required')
    for p in [*path.parents, path]:
        row = p.lstat(); need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022, 'protected_managed_source_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd); need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum, 'bounded_managed_source_file_required')
        raw = os.read(fd, maximum + 1)
        identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns, v.st_nlink)
        need(identity(before) == identity(os.fstat(fd)) == identity(path.lstat()) and len(raw) == before.st_size and
             (expected is None or pin(expected) and sha(raw) == expected), 'exact_managed_source_bytes_required')
        return raw
    finally: os.close(fd)


def module(path, expected):
    need(pin(expected), 'actual_managed_dependency_pin_required'); raw = protected(path, expected)
    value = types.ModuleType('managed_' + Path(path).stem.replace('-', '_')); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    protected(path, expected); return value


def document(path, expected=None): return json.loads(protected(path, expected))


def heartbeat_floor(native):
    heartbeat = native['app']['heartbeat_at']; clock = native['clock']
    need(type(clock) is int and not isinstance(heartbeat, bool) and str(heartbeat).isdigit() and
         0 <= int(heartbeat) <= clock, 'actual_database_clock_and_predecessor_heartbeat_required')
    return {'preStartDatabaseClock': clock, 'predecessorHeartbeat': int(heartbeat)}


def epoch_heartbeat(native, intent, ready=True):
    now = int(native['clock']); heartbeat = int(native['app']['heartbeat_at'])
    need(str(native['app']['is_locked']) == '1' and str(native['app'].get('is_dev', '0')) == '0' and
         (not ready or str(native['app']['is_ready']) == '1') and
         0 <= now - heartbeat <= 180000 and heartbeat >= intent['preStartDatabaseClock'] and
         heartbeat > intent['predecessorHeartbeat'], 'new_writer_heartbeat_must_follow_durable_start_database_clock')
    return True


def require_positive_backends(proof, name):
    source = proof['73004621']['owned'].get(name, [])
    need(len(source) >= 1 and not proof['73004621']['other'], 'positive_kernel_owned_source_backends_without_foreign_writer_required')
    return source


def live_solana_progress(before, after):
    need(after['manifest'] == before['manifest'] and
         int(after['ledgerCurrent']['credits']) >= int(before['ledgerCurrent']['credits']) and
         int(after['state']['publishedRunId'] or 0) >= int(before['state']['publishedRunId'] or 0),
         'undrained_Solana_budget_and_publication_must_not_rewind')


def review_binding(value):
    # Live HTTP/indexed times, cursor progress, resource availability and native
    # clocks are independently requalified, never treated as immutable inputs.
    # Their exact receipt/producer references remain bound by input+manifest.
    binding={k:v for k,v in value.items()if k not in {'native','solana','sessions','resources','acceptance'}}
    binding['nativeIdentity']={k:value['native'][k]for k in ['schemaOid','tables','cache']}
    binding['solanaManifest']=value['solana']['manifest']
    return binding


def namespace():
    """Pure fixed business primitives, not the frozen runtime constructor."""
    raw = protected(TEMPLATE, TEMPLATE_SHA); tree = ast.parse(raw)
    host_methods = {'peer_query', 'query', 'state', 'definitions', 'boot_link', 'activation', 'peer', 'actor',
        'readiness', 'sql_solana', 'private_inputs', 'retained_solana_auth', 'sessions', 'sessions_gone',
        'failed_parent_quiet', 'manager', 'availability', 'managed', 'managed_settings'}
    owner_methods = {'get', 'put', 'operation', 'step', 'stop_exact', 'owned_new_definition', 'finish_stop',
                     'inverse_stop', 'cancel_owned_restart', 'original_actor'}
    replacements = {'FORMAT': repr(FORMAT), 'BASE': 'Path(' + repr(str(BASE)) + ')', 'INPUT': 'Path(' + repr(str(INPUT)) + ')',
        'MANIFEST': 'Path(' + repr(str(MANIFEST)) + ')', 'STAGE': 'Path(' + repr(str(STAGE)) + ')',
        'HOLD': 'Path(' + repr(str(HOLD)) + ')', 'SOURCE_ACK': repr(RESTORE_ACK), 'PINS': repr(PINS), 'UNITS': 'WRITERS'}
    body = []; changed = set()
    for node in tree.body:
        if isinstance(node, ast.If) and ast.unparse(node.test) == "__name__ == '__main__'": continue
        if isinstance(node, ast.FunctionDef) and node.name in {'main', 'validate_source_leaf', 'validate_current', 'validate_restored_source_leaf'}: continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in replacements:
                node.value = ast.parse(replacements[name], mode='eval').body; changed.add(name)
        if isinstance(node, ast.ClassDef):
            allowed = host_methods if node.name == 'Host' else owner_methods
            node.name = 'Frozen' + node.name
            node.body = [v for v in node.body if isinstance(v, ast.FunctionDef) and v.name in allowed]
        body.append(node)
    need(changed == set(replacements), 'finite_frozen_business_primitive_namespace_required')
    result = types.ModuleType('restored_managed_business'); result.__file__ = str(Path(__file__).absolute())
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), result.__file__, 'exec'), result.__dict__)
    result.NAMESPACE[result.PROJECT + '/lib/unified/rpc-preflight.ts'] = str(DEADLINE)
    return result


def validate_producer_manifest(value):
    need(set(value) == {'format', 'producers'} and value['format'] == FORMAT + '-sources' and set(value['producers']) == set(KNOWN_CODE), 'finite_real_managed_prerequisite_producers_required')
    for key, row in value['producers'].items():
        need(set(row) == {'file', 'sha256'} and pin(row['sha256']) and Path(row['file']).name == row['file'] and row['file'].endswith('.py'), 'exact_protected_prerequisite_producer_required')
        need(row['file'] == KNOWN_CODE[key], 'only_fixed_current_reader_cache_feature_and_Arena_facades_allowed')
    return value


# Host and Owner are defined by build() so no frozen runtime constructor can run
# at import time, including on a stopped-source inverse path.
def build(manifest_sha, input_sha):
    base = namespace(); static = module(STATIC, STATIC_SHA); current = module(CURRENT, CURRENT_SHA)
    manifest = validate_producer_manifest(document(MANIFEST, manifest_sha)); config = document(INPUT, input_sha)
    need(config['format'] == FORMAT + '-input' and config['restoreResultSha256'] == RESTORE_ACK and
         config['rpcReceiptSha256'] == RPC_ACK and set(config['writers']) == set(base.WRITERS), 'actual_restored_epoch_complete_writer_input_required')
    parts = static.query_components(); primitives = parts['privilegedSourcePrimitives']

    class Host(base.FrozenHost):
        def __init__(self):
            self.manifest_sha, self.input_sha = manifest_sha, input_sha; self.manifest, self.config = manifest, config
            self.parts, self.primitives = parts, primitives
            self.s = primitives['host'].s; self.raw = primitives['host'].raw
            self.source_op = primitives['host'].source_op; self.restore_receipt = primitives['restoreReceipt']
            self.observer = module(OBSERVER, OBSERVER_SHA)
        def native(self): return primitives['host'].native()
        def private_inputs(self):
            need(base.NODE in config['privateAndCodeInputs'], 'actual_reviewed_Node_executable_digest_required')
            return super().private_inputs()
        def launch_readability(self):
            paths = {str(STAGE / name): digest for name,digest in PINS.items() if name != 'yunipals-indexer.service.example'}
            code = "import hashlib,json,os,pathlib,sys;assert os.getuid()==970 and os.getgid()==964;v=json.load(sys.stdin);print(json.dumps({p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()for p in v},sort_keys=True))"
            actual = json.loads(base.command(['/usr/bin/setpriv','--reuid=970','--regid=964','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs','/usr/bin/env','-i','PATH=/usr/bin:/bin','/usr/bin/python3','-I','-B','-c',code],encoded(paths)))
            need(actual == paths, 'UID970_must_read_exact_public_launcher_without_import_before_drain')
            return actual
        def routes(self):
            proof = module(RPC, RPC_SHA).validate_rpc_current(RPC_ACK)
            need(proof['validated'] is proof['rpcScopeOnly'] is proof['freeOnly'] is True and proof['paidAuthority'] is False and proof['sourceActorQualified'] is False,
                 'actual_independent_nine_RPC_free_only_scope_required'); return proof
        def source_current(self):
            value = current.validate_runtime()
            need(value['sourceRelease'] == RELEASE and value['manifestHash'] == MANIFEST_HASH and value['schemaOid'] == '75963410' and value['buildId'] == BUILD and
                 value['operationalRestore']['receiptSha256'] == RESTORE_ACK and value['poolMaximum'] == 5, 'actual_initial_de4_original_pool5_epoch_required')
            return value
        def observer_current(self):
            value = self.observer.validate_current(config['observer']['resultSha256'])
            need(value['validated'] is value['observerCurrentQualified'] is value['ordinarySustainedObserver'] is True and
                 value['sourceActorQualified'] is value['currentWriterQualified'] is value['paidAuthority'] is False and
                 value['dataIdentity']['sourceRelease'] == RELEASE and value['dataIdentity']['schemaOid'] == '75963410', 'unchanged_sustained_logical_dataset_observer_required')
            return {k:value[k] for k in ['operatorSha256', 'receiptSha256', 'actor', 'bootLink', 'dataIdentity', 'initialSourceContext']}
        def deadline(self):
            need(sha(protected(DEADLINE)) == DEADLINE_SHA, 'exact_adopted_deadline_factory_required')
            result = document(HOST_BUILD, HOST_BUILD_SHA)
            need(result['operatorSha256'] == HOST_BUILD_OWNER_SHA and result['format'] == 'yunipals-rpc-deadline-host-build-v1' and result['completed'] is True,
                 'actual_isolated_deadline_host_build_receipt_required')
            producer = module(OPS / 'ypal-rpc-deadline-host-build-v1/probe.py', HOST_BUILD_OWNER_SHA)
            actual = producer.validate_build(result['actual'])
            need(actual['effectivePoolMax'] == 5 and actual['uid'] == 970 and actual['gid'] == 964 and
                 result['currentSourceAndPeersUnchanged'] is result['nativeAndCacheIdentityPreserved'] is result['safeRecoveryFloorsPreserved'] is result['ownTransientCollected'] is True and
                 result['sourceActions'] == result['databaseWrites'] == result['providerCalls'] == 0 and
                 result['sourceReadinessQualified'] is result['runningTransportChanged'] is False, 'same_actual_zero_effect_host_build_and_original_pool5_required')
            return {'producerSha256': HOST_BUILD_OWNER_SHA, 'receiptSha256': HOST_BUILD_SHA, 'factorySha256': DEADLINE_SHA,
                    'actualBuildId': actual['buildId'], 'effectivePoolMax': actual['effectivePoolMax']}
        def catalog(self):
            raw = protected(OPS / 'ypal-combined-read-admission-v1.catalog.sql', base.CATALOG_SHA)
            return self.query(raw.decode())
        def columns(self):
            raw = protected(OPS / 'ypal-managed-handover-v1.columns.sql', base.COLUMN_SQL_SHA); value = self.query(raw.decode())
            expected = {name:row['oid'] for name,row in self.restore_receipt['native']['tables'].items()}
            actual = {row['relation']:row['relationOid'] for row in value['columns'] if row['schema'] == SCHEMA}
            need(value['databaseOid'] == '17584' and actual == expected and len(actual) == 44, 'same_native44_full_column_catalog_required')
            base.columns_preserved(value,value)
            # The predecessor SQL covers all columns in native/read/control;
            # READ91b additionally retains every explicit column ACL in every
            # non-system schema, including unrelated roles and PUBLIC.
            value['allDatabaseColumnACLs'] = self.query(protected(ALL_COLUMNS, ALL_COLUMNS_SHA).decode())
            return value
        def leaves(self):
            out = {}
            feature_ref = {'retirementSha256':config['feature']['result_sha'], 'manifestSha256':config['feature']['manifest_sha'], 'inputSha256':config['feature']['input_sha']}
            for kind in ['feature','readers','cache','arena']:
                ref = manifest['producers']['readerCachePhase' if kind in {'readers','cache'} else kind]
                code = module(OPS / ref['file'], ref['sha256'])
                if kind == 'feature': value = code.validate_feature_leaf(**config[kind])
                elif kind == 'arena': value = code.validate_phase_leaf(**config[kind])
                else:
                    method = code.validate_reader_leaf if kind == 'readers' else code.validate_cache_leaf
                    value = method(config[kind]['resultSha256'],config[kind]['sourceManifestSha256'],feature_ref)
                need(value['validated'] is True and value['sourceActorQualified'] is False and value['financialAuthorityQualified'] is False, 'real_source_independent_consumer_phase_leaves_required')
                out[kind] = value
            need(out['feature']['temporarySourceRetired'] is True, 'temporary_pack_ingestor_must_be_owned_retired_before_single_parent')
            return out
        def inverse_leaves(self, inverse_input_sha):
            value = document(INVERSE_INPUT, inverse_input_sha)
            need(set(value) == {'format', 'operationSha256', 'manifestSha256', 'readers', 'feature'} and
                 value['format'] == FORMAT + '-inverse-input' and value['manifestSha256'] == self.manifest_sha and
                 value['operationSha256'] == sha(protected(BASE / 'operation.json')), 'actual_owned_reader_and_feature_inverse_refs_required')
            out = {}
            for kind, method in [('readerInverse', 'validate_inverse_leaf'), ('feature', 'validate_inverse_leaf')]:
                ref = manifest['producers'][kind]; code = module(OPS / ref['file'], ref['sha256'])
                args = value['readers' if kind == 'readerInverse' else 'feature']
                need(set(args) == ({'result_sha', 'manifest_sha'} if kind == 'readerInverse' else {'result_sha', 'manifest_sha', 'input_sha'}) and
                     all(pin(v) for v in args.values()), 'explicit_exact_recovered_reader_and_feature_receipt_hashes_required')
                proof = getattr(code, method)(**args, **({'reader_inverse_refs':value['readers']} if kind == 'feature' else {}))
                need(proof['validated'] is True and proof['sourceActorQualified'] is False and
                     proof['financialAuthorityQualified'] is False, 'source_independent_actual_inverse_phase_leaf_required')
                out[kind] = proof
            temporary = out['feature']['temporarySourceActor']
            need(temporary['unit']['Id'] == 'yunipals-booster-ypal-source.service' and temporary['parent'] in temporary['processes'],
                 'actual_owned_restored_temporary_source_kernel_actor_required')
            return out

    class Owner(base.FrozenOwner):
        def __init__(self, host): self.h=host
        def operation(self):
            value=super().operation();need(value['format']==FORMAT,'own_restored_managed_operation_format_required');return value
        def stop_exact(self, unit, actor, name):
            result=super().stop_exact(unit,actor,name);static.gone(actor['processes']);return result
        def finish_stop(self, unit, actor, name):
            result=super().finish_stop(unit,actor,name)
            if actor:static.gone(actor['processes'])
            return result
        def native_floor(self, before, after):
            primitives['recoveryModule'].recovery_floor(before, after)
            return after
        def stable(self, op):
            need(self.h.private_inputs() == op['privateInputs'] and self.h.routes() == op['routes'] and
                 self.h.catalog() == op['catalog'] and self.h.columns() == op['columns'] and
                 self.h.observer_current() == op['observer'], 'managed_phase_private_roles_columns_routes_or_observer_changed')
            self.native_floor(op['native'], self.h.native())
        def writer_stable(self, op):
            # Source role/program/private inputs remain exact. Consumer ACLs and
            # selector changes belong to the caller's explicit phase proof.
            need(self.h.private_inputs()==op['privateInputs'] and self.h.routes()==op['routes'] and
                 self.h.observer_current()==op['observer'] and self.h.deadline()==op['deadlineBuild'],
                 'exact_writer_private_role_code_RPC_observer_and_transport_required')
            self.native_floor(op['native'],self.h.native())
        def review(self):
            h=self.h; current_source=h.source_current(); leaves=h.leaves(); h.readiness()
            need(h.actor(SOURCE) == current_source['source'], 'same_actual_de4_source_actor_before_managed_drain')
            need(h.actor(PARENT,True) is None, 'managed_parent_must_initially_be_terminal')
            h.launch_readability(); deadline=h.deadline(); units={};activations={};frames={}
            for unit in base.WRITERS:
                actor=h.actor(unit,True); activation=h.activation(unit); expected=config['writers'][unit]
                need({p:v['sha256']for p,v in activation['definitions'].items()} == expected['definitionHashes'], 'actual_reviewed_legacy_writer_definitions_required')
                if unit not in {SOURCE,SOLANA}:need(actor is None,'other_legacy_ingestors_must_be_owned_retired_before_parent')
                if actor:need(actor['parent']['argv']==expected['argv'] and actor['parent']['cwd']==expected['cwd'],'exact_reviewed_source_or_Solana_command_required')
                units[unit]=actor;activations[unit]=activation;frames[unit]=base.definition_frame(h.state(unit))
            native=h.native();self.native_floor(native,native)
            solana=h.sql_solana();base.check_solana(solana)
            need(solana['state']['lastErrorPresent'] is False,'actual_Solana_error_requires_diagnosis_before_parent')
            sessions=h.sessions({u:a for u,a in units.items()if a},all_native=True)
            observer=h.observer_current();private=h.private_inputs();catalog=h.catalog();columns=h.columns();resources=h.s.resources()
            prior=base.pointer(leaves['readers']['recordedRead143Cache4AndTwoLOGINCatalog'])
            need(sha(encoded(prior)) == leaves['readers']['recordedAfterLOGINCatalogSha256'], 'actual_reader_whole_after_LOGIN_catalog_pin_required')
            arena_edges=leaves['arena']['ownedReadEdges'];keys=lambda e:tuple(str(e.get(k))for k in ['kind','object','grantee','grantor','privilege','grantable'])
            need(len(arena_edges)==13 and {keys(e)for e in arena_edges}<={keys(e)for e in prior['targetEdges']},'Arena13_must_already_precede_fresh_READ143_baseline')
            additions=[]
            for name in ['booster_type','booster_original','booster_request','booster_monster','booster_refund','booster_engine_state','booster_event','booster_checkpoint']:
                row=native['tables'][name]
                additions.append({'kind':'relation','object':row['oid'],'object_name':SCHEMA+'.'+name,'grantee':'73187672','grantor':row['owner'],'privilege':'SELECT','grantable':False,'column_number':None})
            base.phase_catalog(prior,catalog,additions)
            value={'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute())),'bootId':base.boot(),
                'inputSha256':input_sha,'manifestSha256':manifest_sha,'initialSource':current_source,'units':units,'activations':activations,
                'unitDefinitionFrames':frames,'native':native,'solana':solana,'sessions':sessions,'observer':observer,
                'privateInputs':private,'catalog':catalog,'columns':columns,'routes':h.routes(),'acceptance':leaves,'deadlineBuild':deadline,'resources':resources,
                'metadataKernelActor':h.actor(base.METADATA),'zeroOutageClaimed':False,'oldC96ActorRelabelled':False,'oldDe4ActorRelabelled':False}
            need(h.source_current()==current_source and h.observer_current()==observer and h.private_inputs()==private and h.catalog()==catalog and h.columns()==columns,
                 'initial_managed_review_inputs_changed')
            binding=review_binding(value)
            return {**value,'reviewBinding':binding,'reviewHash':sha(encoded(binding))}
        def drain(self, expected):
            need(not os.path.lexists(BASE)and not os.path.lexists(HOLD),'fresh_owned_managed_operation_required')
            op=self.review();need(op['reviewHash']==expected,'exact_fresh_managed_review_required')
            BASE.mkdir(mode=0o700);base.sync(BASE.parent);HOLD.mkdir(mode=0o700);base.sync(HOLD.parent);self.put('operation.json',op)
            for unit in [SOURCE,SOLANA]:
                if op['units'][unit]:self.stop_exact(unit,op['units'][unit],'drain-'+unit)
            for unit in base.WRITERS:need(self.h.actor(unit,True)is None,'all_EVM_Solana_ingestors_must_be_terminal')
            sol=self.h.sql_solana();need(sol['workerLock']=={'granted':0,'waiting':0},'stopped_Solana_worker_lock_required')
            native=self.h.native();self.native_floor(op['native'],native);self.stable(op)
            value={'format':FORMAT,'operationSha256':sha(protected(BASE/'operation.json')),'native':native,'solana':sol,'observer':self.h.observer_current()}
            self.put('drained.json',value);return {'drained':True,'observerUnchanged':True,'databaseWrites':0}
        def move(self, source, target, record, label, finish=False):
            intent={'source':str(source),'target':str(target),'identity':record};path=BASE/(label+'-intent.json')
            if path.exists():need(finish and self.get(path.name)==intent,'explicit_equal_move_finish_required')
            else:self.put(path.name,intent)
            if os.path.lexists(source):
                need(base.identity(source)==record and not os.path.lexists(target),'exact_owned_inode_and_absent_destination_required')
                primitives['recoveryModule'].publish_no_replace(source,target);base.sync(source.parent);base.sync(target.parent)
            else:need(finish and base.identity(target)==record,'same_owned_completed_move_required')
            if not(BASE/(label+'-result.json')).exists():self.put(label+'-result.json',intent)
        def publish(self,name,path,raw):
            temporary=HOLD/(name+'.prepared');base.save(temporary,raw,0o644)
            record={'path':str(path),'sha256':sha(raw),'identity':base.identity(temporary)};self.put(name+'-prepared.json',record)
            self.move(temporary,path,record['identity'],'publish-'+name)
            self.put(name+'-published.json',record)
        def install(self):
            op=self.operation();self.stable(op);d=self.get('drained.json')
            base.stopped_solana(d['solana'],self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId'])))
            for unit in base.WRITERS:
                need(self.h.actor(unit,True)is None,'no_ingestor_before_managed_definition_publication')
                boot=op['activations'][unit]['boot']
                if boot:self.move(self.h.boot_link(unit),HOLD/(unit+'.boot'),boot['identity'],'hold-boot-'+unit)
            for i,(path,row)in enumerate(op['activations'][PARENT]['definitions'].items()):
                self.move(Path(path),HOLD/(PARENT+'.definition-'+str(i)),row['identity'],'hold-parent-definition-'+str(i))
            self.publish('managed-unit',base.SYSTEM/PARENT,protected(STAGE/'yunipals-indexer.service.example',PINS['yunipals-indexer.service.example']))
            # Only original authenticated provider CIDRs; no new hostname/key or budget.
            egress=base.ref(config['solanaEgress']);need(egress['format']=='yunipals-ypal-managed-egress-v1'and set(egress['literalCidrs'])==base.CIDRS,'same_reviewed_Helius_literal_egress_required')
            directory=base.SYSTEM/(PARENT+'.d')
            if not directory.exists():directory.mkdir(mode=0o755);base.sync(base.SYSTEM);self.put('managed-drop-directory-created.json',base.identity(directory))
            self.publish('managed-egress',directory/'90-managed-helius.conf',('[Service]\n'+''.join('IPAddressAllow='+c+'\n'for c in sorted(base.CIDRS))).encode())
            temporary=HOLD/(PARENT+'.new-boot');temporary.symlink_to(str(base.SYSTEM/PARENT));base.sync(HOLD)
            record=base.link_record(temporary);self.put('new-boot-prepared.json',record);self.move(temporary,self.h.boot_link(PARENT),record['identity'],'publish-parent-boot')
            self.step('load-managed',{},lambda:self.h.manager('daemon-reload'));self.h.managed_settings()
            activation=self.h.activation(PARENT)
            expected={str(base.SYSTEM/PARENT):self.get('managed-unit-prepared.json'),
                      str(directory/'90-managed-helius.conf'):self.get('managed-egress-prepared.json')}
            need(activation['definitions']=={path:{'sha256':row['sha256'],'identity':row['identity']}for path,row in expected.items()} and
                 activation['boot']==self.get('new-boot-prepared.json'), 'only_exact_owned_managed_definitions_and_boot_may_be_installed')
            self.put('installed.json',{PARENT:activation})
            need(self.h.observer_current()==op['observer'],'independent_observer_must_remain_exact_during_install')
            return {'installedInactive':True,'observerUnchanged':True,'transportAdoptionPendingStart':True}
        def start_parent(self):
            op=self.operation();self.stable(op);self.h.managed_settings()
            for unit in base.WRITERS:need(self.h.actor(unit,True)is None,'exclusive_terminal_ingestors_before_parent_start')
            d=self.get('drained.json');native=self.h.native();self.native_floor(d['native'],native)
            base.stopped_solana(d['solana'],self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId'])))
            installed=self.get('installed.json')[PARENT]
            intent={'notBeforeUs':base.mono(),'predecessorInvocation':op['units'][PARENT]['unit']['InvocationID']if op['units'][PARENT]else'',
                'definitions':installed['definitions'],'boot':installed['boot'],**heartbeat_floor(native),'automaticRetryAllowed':False}
            self.put('parent-start-intent.json',intent)
            self.start_cas(op,installed);self.h.manager('start',PARENT)
            return self.accept_parent()
        def start_cas(self, op, installed):
            need(self.h.activation(PARENT)==installed,'exact_owned_parent_activation_required_at_final_start_CAS')
            # Conflicts must never turn a start into authority to stop a newly
            # appeared old writer. This runs AFTER the durable intent and all
            # slow native/private/schedule observations, immediately before start.
            self.retired_writers(op)
            need(self.h.actor(PARENT,True)is None,'all_writer_groups_must_stay_terminal_at_final_start_CAS')
        def active_prefix(self):
            if (BASE / 'restart-parent-start-intent.json').exists():
                need((BASE / 'restart-result.json').exists(), 'owned_restart_unknown_ACK_requires_explicit_accept_restart')
                return 'restart-'
            return ''
        def retired_writers(self, op):
            for unit in base.WRITERS:
                if unit == PARENT: continue
                need(self.h.actor(unit, True) is None and self.h.activation(unit)['boot'] is None and
                     self.h.definitions(unit) == op['activations'][unit]['definitions'], 'all_retired_writer_groups_definitions_and_boots_required')
                row = op['activations'][unit]['boot']
                if row: base.moved_link_matches(HOLD / (unit + '.boot'), row)
        def accept_parent(self, prefix=''):
            need(prefix in {'', 'restart-'}, 'finite_owned_start_prefix_required')
            op=self.operation();self.stable(op);intent=self.get(prefix+'parent-start-intent.json');actor=self.h.managed(intent)
            proof=self.h.sessions({PARENT:actor},all_native=True);require_positive_backends(proof,PARENT)
            native=self.h.native();self.native_floor(op['native'],native);epoch_heartbeat(native,intent)
            self.h.readiness();d=self.get('drained.json');sol=self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId']));base.prefix_preserved(d['solana'],sol)
            self.retired_writers(op)
            serving=self.h.availability();need(self.h.managed(intent)==actor and self.h.observer_current()==op['observer'],'writer_or_observer_changed_during_acceptance')
            elapsed=base.mono()-self.get(('restart-drain-'+PARENT if prefix else 'drain-'+SOURCE)+'-intent.json')['notBeforeUs'];bound=config['maximumColdStartSeconds']
            need(type(bound)is int and 1<=bound<=300 and elapsed<=bound*1000000,'bounded_cold_start_window_exceeded_inverse_required')
            result={'format':FORMAT,'completed':True,'operatorSha256':op['operatorSha256'],'operationSha256':sha(protected(BASE/'operation.json')),
                'bootId':base.boot(),'managed':actor,'native':native,'solana':sol,'sourceRelease':RELEASE,'schemaOid':'75963410','buildId':BUILD,
                'observer':op['observer'],'observerRewritten':False,'initialSourceReceiptSha256':RESTORE_ACK,'oldC96ActorRelabelled':False,'oldDe4ActorRelabelled':False,
                'transportFactorySha256':DEADLINE_SHA,'hostBuildReceiptSha256':HOST_BUILD_SHA,'actualReadOnlyServing':serving,
                'availabilityObservationGapUpperBoundUs':elapsed,'actualHTTPOutageDurationClaimed':False,'zeroOutageClaimed':False,
                'scheduledSolanaAccepted':bool(prefix),'supervisedRestartAccepted':bool(prefix),'recurringGenerationAccepted':False,'goalComplete':False,'databaseWrites':0,'paidAuthorityAdded':False}
            if prefix:
                result['initialResultSha256'] = sha(protected(BASE / 'result.json'))
                result['scheduledResultSha256'] = sha(protected(BASE / 'scheduled-result.json'))
                result['restartDrainSha256'] = sha(protected(BASE / 'restart-drained.json'))
            self.put(prefix+'result.json',result);return result

        def source_leaf(self, result_sha):
            op=self.operation();receipt=document(BASE/'result.json',result_sha)
            need(receipt['format']==FORMAT and receipt['completed']is True and receipt['operatorSha256']==op['operatorSha256'] and
                 receipt['operationSha256']==sha(protected(BASE/'operation.json')) and not(BASE/'inverse-intent.json').exists(), 'exact_uninversed_managed_writer_ACK_required')
            self.writer_stable(op);prefix=self.active_prefix();epoch_receipt=self.get(prefix+'result.json')
            if prefix: need(epoch_receipt['initialResultSha256']==result_sha and epoch_receipt['operatorSha256']==op['operatorSha256'] and
                            epoch_receipt['operationSha256']==receipt['operationSha256'], 'restart_epoch_must_link_exact_original_managed_ACK')
            intent=self.get(prefix+'parent-start-intent.json');actor=self.h.managed(intent)
            need(actor==epoch_receipt['managed'],'managed_current_epoch_requires_its_own_accepted_ACK_not_auto_relabel')
            native=self.h.native();self.native_floor(receipt['native'],native);epoch_heartbeat(native,intent)
            sessions=self.h.sessions({PARENT:actor},all_native=True);require_positive_backends(sessions,PARENT)
            ready=self.h.readiness();self.retired_writers(op);need(self.h.managed(intent)==actor,'managed_epoch_changed_during_source_leaf')
            return {'format':FORMAT+'-source-leaf','validated':True,'receiptSha256':result_sha,'operatorSha256':op['operatorSha256'],
                'operationSha256':receipt['operationSha256'],'currentEpochReceiptSha256':sha(protected(BASE/(prefix+'result.json'))),
                'currentManagedEpoch':actor,'sourceRelease':RELEASE,'manifestHash':MANIFEST_HASH,
                'schema':SCHEMA,'schemaOid':'75963410','buildId':BUILD,'nativeTables':native['tables'],'nativeReadiness':ready,
                'transportFactorySha256':DEADLINE_SHA,'hostBuildReceiptSha256':HOST_BUILD_SHA,'currentWriterQualified':True,'sourceReadinessQualified':True,
                'initialRestoreReceiptSha256':RESTORE_ACK,'historicalRestoreActorClaimedCurrent':False,'oldC96ActorRelabelled':False,
                'financialAuthorityQualified':False,'consumerOrArenaAuthorityQualified':False,'observerWriterAuthorityClaimed':False,'databaseWrites':0,'providerCalls':0}
        def scheduled(self, result_sha):
            self.source_leaf(result_sha); drained=self.get('drained.json')
            after=self.h.sql_solana(int(drained['solana']['ledgerPrefix']['throughId']))
            fresh=self.h.query("SELECT jsonb_build_object('id',id,'startedAt',started_at,'manifestChecksum',manifest_checksum,'requestCount',request_count,'rowSha256',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')) FROM solana_indexer.scan_run r WHERE id="+str(int(after['state']['publishedRunId']or 0)))
            need(fresh['rowSha256']==after['publishedRun']['rowSha256'], 'same_immutable_genuine_Solana_published_run_required')
            base.scheduled_publication(drained['solana'],after,fresh);self.source_leaf(result_sha)
            value={'format':FORMAT,'resultSha256':result_sha,'operationSha256':sha(protected(BASE/'operation.json')),
                'scheduledSolanaAccepted':True,'newPublishedRun':after['publishedRun'],'wholeExistingLedgerPrefixPreserved':True,
                'newKeysOrPaidAuthority':False,'providerCallsByOwner':0}
            self.put('scheduled-result.json',value);return value
        def restart(self, result_sha):
            op=self.operation();self.stable(op);self.source_leaf(result_sha)
            need(self.get('scheduled-result.json')['resultSha256']==result_sha and self.get('scheduled-result.json')['scheduledSolanaAccepted']is True and
                 not(BASE/'restart-drain-parent-intent.json').exists() and not(BASE/'restart-parent-start-intent.json').exists(),
                 'one_explicit_parent_restart_only_after_genuine_scheduled_publication')
            actor=self.h.managed(self.get('parent-start-intent.json'));self.stop_exact(PARENT,actor,'restart-drain-'+PARENT)
            native=self.h.native();self.native_floor(op['native'],native);solana=self.h.sql_solana()
            need(solana['workerLock']=={'granted':0,'waiting':0},'restarted_parent_Solana_lock_must_be_released')
            self.put('restart-drained.json',{'native':native,'solana':solana,'observer':self.h.observer_current()})
            installed=self.get('installed.json')[PARENT]
            intent={'notBeforeUs':base.mono(),'predecessorInvocation':actor['unit']['InvocationID'],
                'definitions':installed['definitions'],'boot':installed['boot'],**heartbeat_floor(native),'automaticRetryAllowed':False}
            self.put('restart-parent-start-intent.json',intent)
            need(self.h.observer_current()==op['observer'],'post_intent_restart_observer_changed')
            self.start_cas(op,installed)
            self.h.manager('start',PARENT);return self.accept_parent('restart-')
        def final_current(self, result_sha):
            self.stable(self.operation());source=self.source_leaf(result_sha);restart=self.get('restart-result.json');scheduled=self.get('scheduled-result.json')
            need(restart['supervisedRestartAccepted']is restart['scheduledSolanaAccepted']is scheduled['scheduledSolanaAccepted']is True and
                 restart['initialResultSha256']==scheduled['resultSha256']==result_sha and
                 restart['scheduledResultSha256']==sha(protected(BASE/'scheduled-result.json')), 'genuine_scheduled_publication_and_owned_restart_ACKs_required')
            leaves=self.h.leaves();need(self.h.observer_current()==self.operation()['observer'],'unchanged_sustained_observer_required_at_final_acceptance')
            return {'format':FORMAT+'-current','validated':True,'source':source,'actualConsumerAcceptance':leaves,
                'scheduledSolanaAccepted':True,'supervisedRestartAccepted':True,'singleManagedEVMAndSolanaRuntime':True,
                'oldBootPathsRetired':True,'observerRewritten':False,'financialAuthorityQualified':False,
                'recurringGenerationAccepted':False,'goalComplete':False,'databaseWrites':0,'providerCalls':0}
        def inverse_drained(self, finish=False):
            op=self.operation();intent={'format':FORMAT,'operationSha256':sha(protected(BASE/'operation.json')),'bootId':base.boot()}
            if(BASE/'inverse-intent.json').exists():need(finish and self.get('inverse-intent.json')==intent,'explicit_same_operation_inverse_finish_required')
            else:self.put('inverse-intent.json',intent)
            # Stop only the exact new managed unit; the independently owned
            # observer is retained and its scope confers no writer authority.
            if(BASE/'installed.json').exists():
                name='inverse-stop-'+PARENT
                if(BASE/(name+'-intent.json')).exists():
                    stop=self.get(name+'-intent.json');self.finish_stop(PARENT,stop['value']['actor'],name)
                else:self.inverse_stop(PARENT,name)
            for unit in [SOURCE,SOLANA]:
                name='drain-'+unit
                if op['units'][unit] and(BASE/(name+'-intent.json')).exists()and not(BASE/(name+'-result.json')).exists():self.finish_stop(unit,op['units'][unit],name)
                elif op['units'][unit] and not(BASE/(name+'-intent.json')).exists():need(self.h.actor(unit)==op['units'][unit],'undrained_old_actor_is_not_new_stop_authority')
            if not(BASE/'inverse-quiet.json').exists():
                actors={u:self.h.actor(u,True)for u in [SOURCE,SOLANA,PARENT]}
                need(actors[PARENT]is None,'new_parent_must_be_terminal_for_inverse')
                if actors[SOURCE]is not None:
                    need(not(BASE/('drain-'+SOURCE+'-intent.json')).exists()and actors[SOURCE]==op['units'][SOURCE] and
                         all(self.h.activation(u)==op['activations'][u]for u in base.WRITERS),'only_exact_undrained_original_source_may_remain')
                    self.stable(op);self.h.source_current();self.h.readiness()
                    value={'format':FORMAT+'-inverse-undrained','restored':True,'operatorSha256':op['operatorSha256'],
                        'operationSha256':sha(protected(BASE/'operation.json')),'originalSourceRetained':True,'newSourceEpochClaimed':False,
                        'managedWriterStarted':False,'sourceRestarted':False,'databaseWrites':0,'serviceActions':0}
                    self.put('inverse-result.json',value);return value
                if actors[SOLANA]is not None:
                    need(not(BASE/('drain-'+SOLANA+'-intent.json')).exists()and actors[SOLANA]==op['units'][SOLANA], 'only_exact_undrained_Solana_actor_may_remain')
                sol=self.h.sql_solana();frozen=actors[SOLANA]is None
                if frozen:need(sol['workerLock']=={'granted':0,'waiting':0},'no_Solana_worker_lock_before_inverse_static_restore')
                self.put('inverse-quiet.json',{'native':self.h.native(),'solana':sol,'solanaFrozen':frozen})
            quiet=self.get('inverse-quiet.json');self.native_floor(quiet['native'],self.h.native())
            now_sol=self.h.sql_solana(int(quiet['solana']['ledgerPrefix']['throughId']))
            if quiet['solanaFrozen']:base.stopped_solana(quiet['solana'],now_sol)
            else:live_solana_progress(quiet['solana'],now_sol)
            # Reconcile only acknowledged original/owned inodes; never unlink
            # a foreign definition or overwrite a racing destination.
            for name in ['managed-unit','managed-egress']:
                record_path=BASE/(name+'-prepared.json')
                if not record_path.exists():continue
                row=self.get(record_path.name);path=Path(row['path']);held=HOLD/(name+'.removed')
                if os.path.lexists(path)and base.identity(path)==row['identity']:
                    need(sha(protected(path))==row['sha256'],'owned_managed_definition_modified')
                    self.move(path,held,row['identity'],'inverse-remove-'+name,finish)
                elif os.path.lexists(held):need(finish and base.identity(held)==row['identity'],'same_held_removed_managed_definition_required')
                else:
                    original=next((v for p,v in op['activations'][PARENT]['definitions'].items()if p==str(path)),None)
                    need(os.path.lexists(HOLD/(name+'.prepared'))or finish and original and base.identity(path)==original['identity'],'unknown_managed_file_publication_prefix')
            boot_path=BASE/'new-boot-prepared.json'
            if boot_path.exists():
                row=self.get(boot_path.name);path=self.h.boot_link(PARENT);held=HOLD/(PARENT+'.new-boot-removed')
                if base.link_record(path)==row:self.move(path,held,row['identity'],'inverse-remove-parent-boot',finish)
                else:need(finish and(base.link_record(held)==row or base.link_record(path)==op['activations'][PARENT]['boot'])or os.path.lexists(HOLD/(PARENT+'.new-boot')),'unknown_parent_boot_prefix')
            for i,(path,row)in enumerate(op['activations'][PARENT]['definitions'].items()):
                held=HOLD/(PARENT+'.definition-'+str(i));path=Path(path)
                if os.path.lexists(held):self.move(held,path,row['identity'],'inverse-restore-parent-definition-'+str(i),finish)
                else:need(base.identity(path)==row['identity']and sha(protected(path))==row['sha256'],'exact_original_parent_definition_required')
            for unit in base.WRITERS:
                row=op['activations'][unit]['boot'];path=self.h.boot_link(unit);held=HOLD/(unit+'.boot')
                if row:
                    if os.path.lexists(held):self.move(held,path,row['identity'],'inverse-restore-boot-'+unit,finish)
                    base.moved_link_matches(path,row)
                else:need(not os.path.lexists(path),'original_absent_boot_link_must_remain_absent')
            if not(BASE/'inverse-reload-intent.json').exists():self.step('inverse-reload',{},lambda:self.h.manager('daemon-reload'))
            for unit in base.WRITERS:
                need(self.h.activation(unit)==op['activations'][unit]and base.definition_frame(self.h.state(unit))==op['unitDefinitionFrames'][unit],'original_loaded_definitions_boot_and_dependencies_required')
            source=static.inverse_source()
            need(source['sourceState']=='terminal'and source['sourceTerminalQualified']is True,'original_standalone_must_remain_terminal_for_reader_and_feature_inverse')
            need(self.h.observer_current()==op['observer'],'independent_observer_changed_during_managed_inverse_drain')
            result={'format':FORMAT+'-inverse-drained','operatorSha256':op['operatorSha256'],'operationSha256':sha(protected(BASE/'operation.json')),
                'bootId':base.boot(),'managedTerminal':True,'originalDefinitionsAndBootRestored':True,'standaloneTerminal':True,
                'sourceInverseProof':source,'solanaFrozen':quiet['solanaFrozen'],'readerOrFeatureRollbackQualified':False,'standaloneRestarted':False,'ready':False,
                'observerUnchanged':True,'oldC96ActorRelabelled':False,'oldDe4ActorRelabelled':False,'databaseWrites':0,'providerCalls':0}
            self.put('inverse-drained.json',result);return result

        def restored_source(self):
            """The exact de4 program/namespace body, under this owner's NEW intent.

            This is not de4.validate_source_current and never returns a de4 ACK.
            Its original static prefix remains authenticated while the new
            source epoch is bound to our own durable start intent.
            """
            owner=self
            class RestoredProgram(primitives['restoreModule'].Owner):
                def get(self, name):
                    need(name=='start-intent.json','only_new_standalone_start_intent_allowed')
                    return owner.get('standalone-start-intent.json')
                def producer(self): return owner.operation()['operatorSha256']
            body=RestoredProgram(primitives['recoveryModule'],primitives['sdk'],primitives['host'],primitives['ancestorOperation'])
            actor=body.owned();op=self.operation();intent=self.get('standalone-start-intent.json')
            need(actor['unit']['InvocationID']!=op['units'][SOURCE]['unit']['InvocationID'] and
                 intent['operationSha256']==sha(protected(BASE/'operation.json')) and
                 intent['bootId']==base.boot(), 'new_managed_inverse_source_epoch_not_original_de4_claim_required')
            return primitives['restoreModule'].canonical_actor(actor)

        def restored_sessions(self, source, leaves):
            actors={SOURCE:source,'yunipals-booster-ypal-source.service':leaves['feature']['temporarySourceActor']}
            solana=self.h.actor(SOLANA,True)
            if solana:actors[SOLANA]=solana
            # The separate metadata inverse leaf has already authenticated its
            # own writer; include the actual current kernel actor in the shared
            # role mapping without requiring all role16388 sessions to be zero.
            actors[base.METADATA]=self.h.actor(base.METADATA)
            proof=self.h.sessions(actors,all_native=True);require_positive_backends(proof,SOURCE)
            need(proof['73004621']['owned']['yunipals-booster-ypal-source.service'], 'positive_owned_restored_temporary_source_backend_required')
            return proof

        def restored_solana(self, op):
            need(self.h.activation(SOLANA)==op['activations'][SOLANA] and
                 base.definition_frame(self.h.state(SOLANA))==op['unitDefinitionFrames'][SOLANA],
                 'original_Solana_static_boot_and_loaded_program_must_stay_exact')
            if op['units'][SOLANA] is None:
                need(self.h.actor(SOLANA,True)is None,'originally_terminal_Solana_must_remain_terminal')
                return None
            if(BASE/('drain-'+SOLANA+'-intent.json')).exists():
                intent=self.get('standalone-Solana-start-intent.json');actor=self.original_actor(SOLANA,intent)
                need(actor==self.get('standalone-Solana-start-result.json')['actor'], 'restored_Solana_needs_its_own_current_epoch_ACK')
                need(all(p.get('startupInjectionAbsent')is True for p in actor['processes']), 'restored_Solana_must_not_inherit_startup_injection')
                return actor
            actor=self.h.actor(SOLANA);need(actor==op['units'][SOLANA],'exact_undrained_original_Solana_actor_required');return actor

        def inverse_restart(self, inverse_input_sha, finish=False):
            op=self.operation();quiet=self.get('inverse-quiet.json');drained=self.get('inverse-drained.json')
            need(drained['format']==FORMAT+'-inverse-drained' and drained['operatorSha256']==op['operatorSha256'] and
                 drained['operationSha256']==sha(protected(BASE/'operation.json')) and drained['bootId']==base.boot() and
                 drained['originalDefinitionsAndBootRestored']is drained['standaloneTerminal']is True,
                 'own_original_static_terminal_checkpoint_required_before_business_inverse')
            leaves=self.h.inverse_leaves(inverse_input_sha);binding=leaves['readerInverse']['bindingSha256']
            need(pin(binding),'actual_complete_source_free_reader_inverse_binding_required')
            ref={'inverseInputSha256':inverse_input_sha,'readerInverseBindingSha256':binding,
                 'temporarySourceActor':leaves['feature']['temporarySourceActor']}
            path=BASE/'standalone-start-intent.json'
            if path.exists():
                intent=self.get(path.name)
                need(finish and {k:intent[k]for k in ref}==ref,'unknown_standalone_start_ACK_requires_exact_explicit_finish')
            else:
                source=static.inverse_source();need(source['sourceTerminalQualified']is True,'original_config_source_must_be_terminal_before_once_restart')
                need(self.h.actor(PARENT,True)is None and self.h.private_inputs()==op['privateInputs'] and
                     self.h.routes()==op['routes'] and self.h.observer_current()==op['observer'], 'source_private_routes_observer_or_parent_changed_before_inverse_restart')
                native=self.h.native();self.native_floor(quiet['native'],native)
                intent={'format':FORMAT+'-standalone-start','operatorSha256':op['operatorSha256'],
                    'ancestorOperationSha256':primitives['restoreModule'].OP_SHA,'operationSha256':sha(protected(BASE/'operation.json')),
                    'bootId':base.boot(),'notBeforeUs':base.mono(),**heartbeat_floor(native),**ref,'automaticRetryAllowed':False}
                self.put(path.name,intent)
                need(self.h.actor(SOURCE,True)is None and self.h.actor(PARENT,True)is None and
                     self.h.inverse_leaves(inverse_input_sha)['readerInverse']['bindingSha256']==binding and
                     self.h.inverse_leaves(inverse_input_sha)['feature']['temporarySourceActor']==ref['temporarySourceActor'],
                     'post_intent_original_source_and_business_inverse_CAS_required')
                self.h.manager('start',SOURCE)
            actor=self.restored_source();native=self.h.native();self.native_floor(quiet['native'],native)
            epoch_heartbeat(native,intent,ready=False)
            self.restored_sessions(actor,leaves)
            # Resume only an originally running Solana unit that this operation
            # actually drained. A lost start ACK is observed, never reissued.
            old_sol=op['units'][SOLANA]
            if old_sol:
                name='standalone-Solana-start';drain=BASE/('drain-'+SOLANA+'-intent.json')
                if drain.exists():
                    if(BASE/(name+'-intent.json')).exists():
                        need(finish,'unknown_Solana_start_ACK_requires_explicit_finish')
                        sol_actor=self.original_actor(SOLANA,self.get(name+'-intent.json'))
                    else:
                        need(self.h.actor(SOLANA,True)is None,'no_foreign_original_Solana_replacement_allowed')
                        if quiet['solanaFrozen']:base.stopped_solana(quiet['solana'],self.h.sql_solana(int(quiet['solana']['ledgerPrefix']['throughId'])))
                        sol_intent={'notBeforeUs':base.mono(),'predecessor':old_sol,'bootId':base.boot()}
                        self.put(name+'-intent.json',sol_intent)
                        need(self.h.actor(SOLANA,True)is None,'post_intent_Solana_terminal_CAS_required')
                        self.h.manager('start',SOLANA);sol_actor=self.original_actor(SOLANA,sol_intent)
                    if not(BASE/(name+'-result.json')).exists():self.put(name+'-result.json',{'actor':sol_actor})
                else:need(self.h.actor(SOLANA)==old_sol,'undrained_original_Solana_must_remain_exact')
            else:need(self.h.actor(SOLANA,True)is None,'originally_terminal_Solana_must_remain_terminal')
            sol_actor=self.restored_solana(op)
            after=self.h.inverse_leaves(inverse_input_sha)
            need(after['readerInverse']['bindingSha256']==binding and after['feature']['temporarySourceActor']==ref['temporarySourceActor'] and
                 self.restored_source()==actor and self.h.private_inputs()==op['privateInputs'] and self.h.routes()==op['routes'] and
                 self.h.observer_current()==op['observer'], 'business_inverse_and_new_source_must_stay_exact_after_once_restart')
            sol=self.h.sql_solana(int(quiet['solana']['ledgerPrefix']['throughId']))
            if quiet['solanaFrozen']:base.prefix_preserved(quiet['solana'],sol)
            else:live_solana_progress(quiet['solana'],sol)
            sessions=self.restored_sessions(actor,after)
            result={'format':FORMAT+'-inverse','restored':True,'operatorSha256':op['operatorSha256'],'bootId':base.boot(),
                'operationSha256':sha(protected(BASE/'operation.json')),'inverseDrainedSha256':sha(protected(BASE/'inverse-drained.json')),
                'startIntentSha256':sha(protected(path)),'source':actor,'native':native,'solana':sol,'restoredSolanaActor':sol_actor,**ref,
                'readerAndFeatureRecoveredBeforeAndAfterStart':True,'currentWriterKernelProof':sessions,
                'originalDefinitionAndBootInodesRestored':True,'originalPoolMaximum':5,'originalTransportRestored':True,
                'oldC96ActorRelabelled':False,'oldDe4ActorRelabelled':False,'sourceReadinessQualified':False,
                'financialAuthorityQualified':False,'databaseWrites':0,'providerCalls':0}
            self.put('inverse-result.json',result);return result

        def restored_source_leaf(self, inverse_sha):
            op=self.operation();result=document(BASE/'inverse-result.json',inverse_sha)
            need(result['format']==FORMAT+'-inverse' and result['restored']is True and result['operatorSha256']==op['operatorSha256'] and
                 result['operationSha256']==sha(protected(BASE/'operation.json')) and result['bootId']==base.boot() and
                 result['startIntentSha256']==sha(protected(BASE/'standalone-start-intent.json')),
                 'actual_new_managed_inverse_epoch_ACK_required')
            leaves=self.h.inverse_leaves(result['inverseInputSha256']);actor=self.restored_source()
            need(actor==result['source'] and leaves['readerInverse']['bindingSha256']==result['readerInverseBindingSha256'] and
                 leaves['feature']['temporarySourceActor']==result['temporarySourceActor'] and self.h.actor(PARENT,True)is None and
                 self.h.private_inputs()==op['privateInputs'] and self.h.routes()==op['routes'] and self.h.observer_current()==op['observer'],
                 'same_new_standalone_epoch_and_current_recovered_business_scope_required')
            need(self.restored_solana(op)==result['restoredSolanaActor'],'same_owned_restored_Solana_epoch_required_at_current_source_leaf')
            native=self.h.native();self.native_floor(result['native'],native);epoch_heartbeat(native,self.get('standalone-start-intent.json'),ready=False)
            self.restored_sessions(actor,leaves)
            need(self.restored_source()==actor,'restored_source_changed_during_current_leaf')
            return {'format':FORMAT+'-restored-source-current','validated':True,'receiptSha256':inverse_sha,'operatorSha256':op['operatorSha256'],
                'currentWriterQualified':True,'source':actor,'sourceRelease':RELEASE,'manifestHash':MANIFEST_HASH,
                'schema':SCHEMA,'schemaOid':'75963410','buildId':BUILD,'nativeTables':native['tables'],'poolMaximum':5,
                'initialDe4ReceiptAncestry':RESTORE_ACK,'historicalRestoreActorClaimedCurrent':False,
                'sourceReadinessQualified':False,'financialAuthorityQualified':False,'databaseWrites':0,'providerCalls':0}

    return base, Host(), Owner


def validate_source_leaf(result_sha, manifest_sha, input_sha):
    _, h, owner = build(manifest_sha, input_sha); return owner(h).source_leaf(result_sha)


def validate_current(result_sha, manifest_sha, input_sha):
    _, h, owner = build(manifest_sha, input_sha); return owner(h).final_current(result_sha)


def validate_restored_source_leaf(inverse_sha, manifest_sha, input_sha):
    _, h, owner = build(manifest_sha, input_sha); return owner(h).restored_source_leaf(inverse_sha)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest-sha');parser.add_argument('--input-sha')
    phase=parser.add_mutually_exclusive_group()
    phase.add_argument('--source-review',action='store_true');phase.add_argument('--review',action='store_true');phase.add_argument('--drain')
    phase.add_argument('--install',action='store_true');phase.add_argument('--start',action='store_true');phase.add_argument('--accept',action='store_true')
    phase.add_argument('--scheduled');phase.add_argument('--restart');phase.add_argument('--accept-restart',action='store_true')
    phase.add_argument('--source-leaf');phase.add_argument('--validate')
    phase.add_argument('--inverse-drain',action='store_true');phase.add_argument('--finish-inverse-drain',action='store_true')
    phase.add_argument('--inverse-restart');phase.add_argument('--finish-inverse-restart');phase.add_argument('--restored-source-leaf');args=parser.parse_args()
    if not any(vars(args).values()):
        print(json.dumps({'format':FORMAT,'sourceOnly':True,'managedWriterQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(pin(args.manifest_sha) and pin(args.input_sha) and os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','explicit_fixed_host_input_and_producer_manifest_required')
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_managed_review_expired'));signal.alarm(300)
    base,h,owner_type=build(args.manifest_sha,args.input_sha)
    owner=owner_type(h)
    with base.lock():
        if args.source_review:
            result={'format':FORMAT,'validated':True,'sourceOnly':True,'sourceBindingSha256':sha(encoded(h.source_current())),'observerBindingSha256':sha(encoded(h.observer_current())),'deadlineBuild':h.deadline(),'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        elif args.drain:result=owner.drain(args.drain)
        elif args.install:result=owner.install()
        elif args.start:result=owner.start_parent()
        elif args.accept:result=owner.accept_parent()
        elif args.scheduled:result=owner.scheduled(args.scheduled)
        elif args.restart:result=owner.restart(args.restart)
        elif args.accept_restart:result=owner.accept_parent('restart-')
        elif args.source_leaf:result=owner.source_leaf(args.source_leaf)
        elif args.validate:result=owner.final_current(args.validate)
        elif args.inverse_drain or args.finish_inverse_drain:result=owner.inverse_drained(args.finish_inverse_drain)
        elif args.inverse_restart or args.finish_inverse_restart:result=owner.inverse_restart(args.inverse_restart or args.finish_inverse_restart,bool(args.finish_inverse_restart))
        elif args.restored_source_leaf:result=owner.restored_source_leaf(args.restored_source_leaf)
        else:result=owner.review()
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
