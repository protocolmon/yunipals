#!/usr/bin/env python3
"""Explicit current runtime and Arena-before-READ baseline context.

No old whole validator is patched or reported passed. This module has no SQL,
service, grant, credential, provider or receipt-write command.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

FORMAT = 'yunipals-ypal-combined-read-current-context-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
INPUT = Path('/var/backups/yunipals-ypal-combined-read-current-input-v1-20261024/input.json')
FEATURE_BASE = Path('/var/backups/yunipals-ypal-feature-handover-v1-20261024')
RPC = OPS / 'ypal-retained-proxy-current-v3.py'
# Actual root-owned capture, independently revalidated by root. No v1/v2 alias.
RPC_SHA = '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf'
RPC_ACK_SHA = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
RPC_COMPONENT_SHA = '57f0520e640ccd50743f02e0891bfb2ab3491e0368f698ea6d6f209d0d43c757'
SOURCE = OPS / 'arena-ypal-native-v1.source.py'
SOURCE_SHA = 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2'
ADMISSION = OPS / 'arena-ypal-native-v2.admission.py'
ADMISSION_SHA = '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e'
ADMISSION_RESULT = Path('/var/backups/yunipals-arena-ypal-admission-v2-20261024/result.json')
CREDENTIALS = OPS / 'arena-ypal-native-v2.credentials.py'
CREDENTIALS_SHA = '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e'
CREDENTIAL_BASE = Path('/var/backups/yunipals-arena-ypal-credentials-v2-20261024')
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
NATIVE = 'unified_ypal_20261023_v1'
READ = 'yunipals_ownership_4e77f52b_v4'
MANIFEST = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
SCOPES = {NATIVE, READ, 'yunipals_indexer_control'}
REGISTERED = Path('/var/backups/yunipals-ypal-combined-release-register-v1-20261023/registered.json')
REGISTERED_SHA = '39b967846a4c84e320766075cd5c9ea478e29b85a38b6aa8306df95e94fe4cb7'
OLD_PLAN = Path('/var/backups/yunipals-ypal-combined-read-admission-input-v1-20261024/plan.json')
OLD_PLAN_SHA = 'fc79c53da5dc2ce3ccc9ce5c86f69ecfb75f0d25b2836d746f90f29e59ce6e0e'
READ_CATALOG = OPS / 'ypal-combined-read-admission-v1.catalog.sql'
READ_CATALOG_SHA = 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991'
VIEW_OWNER = OPS / 'ypal-combined-readview-owner-v1.py'
VIEW_OWNER_SHA = '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058'
PROFILE = OPS / 'ypal-combined-rpc-v1/profile.json'
PROFILE_SHA = 'c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b'


def need(ok, code):
    if not ok: raise RuntimeError(code)
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def protected(path, expected=None):
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'absolute_context_input_required')
    for parent in [*path.parents, path]:
        info = parent.lstat()
        need(info.st_uid == info.st_gid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022,
             'protected_current_context_input_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 8_000_000,
         'bounded_single_context_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        need(identity(os.fstat(fd)) == identity(before), 'context_input_open_changed')
        chunks = []
        while True:
            raw = os.read(fd, 1_000_000)
            if not raw: break
            chunks.append(raw); need(sum(map(len, chunks)) <= 8_000_000, 'bounded_context_input_required')
        raw = b''.join(chunks)
        need(identity(os.fstat(fd)) == identity(before) == identity(path.lstat()) and len(raw) == before.st_size,
             'context_input_read_changed')
    finally: os.close(fd)
    need(expected is None or pin(expected) and sha(raw) == expected, 'exact_current_context_input_required')
    return raw


def document(path, expected): return json.loads(protected(path, expected))
def module(path, expected):
    raw = protected(path, expected)
    value = types.ModuleType(Path(path).stem); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value


def components():
    need(pin(RPC_SHA), 'actual_frozen_RPC_v3_producer_required')
    return module(SOURCE, SOURCE_SHA), module(RPC, RPC_SHA)


def validate_runtime(rpc_receipt_sha):
    """Source/RPC only. Valid both before and after unrelated reader ACL deltas.

    This finite version admits only the original actual c96/pool5 source epoch.
    A separately performed source/pool recovery is not accepted as that actor.
    """
    need(pin(rpc_receipt_sha) and rpc_receipt_sha == RPC_ACK_SHA, 'actual_152178_RPC_v3_acknowledgement_required')
    leaf, rpc = components()
    proof, _ = rpc.qualified_rpc_components(rpc_receipt_sha)
    need(proof['format'] == 'yunipals-ypal-retained-proxy-current-v3' and proof['validated'] is True and
         proof['receiptSha256'] == rpc_receipt_sha and proof['operatorSha256'] == RPC_SHA and
         proof['currentRPCComponentSha256'] == RPC_COMPONENT_SHA and
         proof['rpcScopeOnly'] is proof['freeOnly'] is True and proof['paidAuthority'] is False and
         all(proof[key] is False for key in ('historicalWholeValidatorPassed', 'sourceActorQualified',
             'temporaryYpalSourceAndApiQualified', 'sourceReadinessQualified', 'readerRoleGraphQualified',
             'financialWriteAuthorityQualified')) and
         all(proof[key] == 0 for key in ('providerCalls', 'databaseWrites', 'serviceActions')),
         'independent_current_RPC_only_scope_required')
    source, host, operation, ack = leaf.load()
    need(not os.path.lexists(source.BASE / 'inverse-intent.json'), 'original_source_inverse_must_not_have_started')
    source.static_inputs(host); source.old_private_inputs(operation)
    need(source.base_code() == operation['sourceCode'] and host.role() == operation['sourceRole'],
         'actual_c96_code_private_inputs_and_pool5_role_required')
    host.old_terminal(operation); host.preserved_old_native(operation)
    actor, native = source.bootstrap(host, operation)
    need(actor == ack['source'] and native['schemaOid'] == '75963410' and
         native['app']['build_id'] == '71e2a7f3b7' and native['tables'] == ack['native']['tables'] and
         len(native['tables']) == 44, 'same_actual_c96_epoch_build_and44_native_OIDs_required')
    source.exact_link(source.NEW_LINK, ack['newBoot'])
    registered = document(REGISTERED, REGISTERED_SHA)
    need(registered['registered'] is True and registered['releaseId'] == RELEASE and
         registered['manifestHash'] == MANIFEST and registered['sourceReceiptSha256'] == leaf.SOURCE_ACK and
         registered['activeReleaseChanged'] is False, 'actual_unchanged_registered_release_required')
    profile = document(PROFILE, PROFILE_SHA)
    current = host.query("SELECT jsonb_build_object('id',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash,'manifest',manifest) FROM yunipals_indexer_control.release WHERE id='" + RELEASE + "'")
    need(current == {'id': RELEASE, 'schema': NATIVE, 'build': '71e2a7f3b7', 'manifestHash': MANIFEST,
                     'manifest': profile['manifest']}, 'same_actual_registered_native_manifest_required')
    return {'format': FORMAT + '-runtime', 'validated': True, 'bootId': leaf.boot(),
            'sourceRelease': RELEASE, 'manifestHash': MANIFEST, 'schema': NATIVE,
            'schemaOid': '75963410', 'buildId': '71e2a7f3b7', 'poolMaximum': 5,
            'source': actor, 'nativeTableIdentities': native['tables'],
            'historicalSourceReceiptSha256': leaf.SOURCE_ACK, 'sourceEpoch': 'acknowledged-c96-pool5',
            'currentRPC': proof, 'originalWholeValidatorPassed': False,
            'temporaryYpalSourceAndApiQualified': False, 'readerRoleGraphQualified': False,
            'sourceReadinessQualified': False, 'financialWriteAuthorityQualified': False,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def arena_admission(config):
    """Authenticate actual committed13 source reads in their explicit auth phase."""
    need(set(config) == {'receiptSha256', 'phase', 'setupSha256', 'authSha256'} and pin(config['receiptSha256']) and
         config['phase'] in {'admitted', 'passwords', 'login'}, 'exact_actual_Arena_admission_and_phase_required')
    admission = module(ADMISSION, ADMISSION_SHA)
    receipt = document(ADMISSION_RESULT, config['receiptSha256'])
    need(receipt['format'] == 'yunipals-arena-ypal-admission-v2' and receipt['commitOutcome'] == 'commit_confirmed' and
         receipt['operatorSha256'] == ADMISSION_SHA and receipt['releaseId'] == RELEASE,
         'actual_new_Arena_admission_before_read_baseline_required')
    passwords = None
    if config['phase'] == 'admitted':
        need(config['setupSha256'] is config['authSha256'] is None, 'NOLOGIN_null_password_phase_must_not_claim_setup')
    else:
        need(pin(config['setupSha256']), 'actual_owned_Arena_setup_required')
        setup = document(CREDENTIAL_BASE / 'setup-result.json', config['setupSha256'])
        need(setup['format'] == 'yunipals-arena-ypal-credentials-v2' and setup['operatorSha256'] == CREDENTIALS_SHA and
             setup['admissionResultSha256'] == config['receiptSha256'] and setup['roles'] == receipt['roles'] and
             setup['sourceRole'] == receipt['sourceRole'] and setup['credentialsConfigured'] is True and
             setup['loginEnabled'] is False, 'same_actual_owned_Arena_setup_and_role_OIDs_required')
        passwords = setup['passwordVerifierSha256']
        if config['phase'] == 'passwords': need(config['authSha256'] is None, 'password_phase_cannot_claim_LOGIN')
        else:
            need(pin(config['authSha256']), 'actual_owned_Arena_LOGIN_authentication_required')
            auth = document(CREDENTIAL_BASE / 'auth-result.json', config['authSha256'])
            need(auth['format'] == 'yunipals-arena-ypal-role-auth-v2' and auth['operatorSha256'] == CREDENTIALS_SHA and
                 auth['admissionResultSha256'] == config['receiptSha256'] and auth['setupResultSha256'] == config['setupSha256'] and
                 auth['roles'] == receipt['roles'] and auth['sourceRole'] == receipt['sourceRole'] and
                 auth['loginEnabled'] is auth['grantsVerified'] is auth['tcpAuthenticationProven'] is True,
                 'same_actual_Arena_LOGIN_auth_chain_required')
    verified = admission.verify_current(receipt, phase=config['phase'], password_sha256=passwords)
    need(verified['validated'] is True and verified['phase'] == config['phase'] and verified['roleCount'] == 9 and
         verified['databaseWrites'] == 0 and verified['catalogs']['source']['requiredEdges'] == 13,
         'fresh_exact_Arena_role_graph_and13_source_reads_required')
    helper = admission.runner(); proposal = helper.load_proposal()
    source = admission.current_catalog(helper, proposal, 'source')
    admission.validate_catalog(helper, proposal, 'source', source, {receipt['sourceRole']['name']: receipt['sourceRole']['oid']},
                               phase=config['phase'], password_sha256=None if passwords is None else {receipt['sourceRole']['name']: passwords[receipt['sourceRole']['name']]})
    role = source['roles'][0]; edges = []
    for edge in role['directRelationAcl']:
        if edge['granteeOid'] != receipt['sourceRole']['oid']: continue
        relation = next(row for row in source['relations'] if row['name'] == edge['relation'])
        edges.append({'kind': 'relation', 'object': str(relation['oid']), 'object_name': relation['name'],
                      'grantee': str(edge['granteeOid']), 'grantor': str(edge['grantorOid']),
                      'privilege': edge['privilege'], 'grantable': edge['grantOption'], 'column_number': None})
    need(len(edges) == 13 and all(e['privilege'] == 'SELECT' and not e['grantable'] and
         e['object_name'].split('.')[0] in SCOPES for e in edges), 'exact_thirteen_owned_Arena_relation_edges_required')
    return {'validated': True, 'file': str(ADMISSION_RESULT), 'sha256': config['receiptSha256'],
            'operatorSha256': ADMISSION_SHA, 'sourceRole': receipt['sourceRole'], 'phase': config['phase'],
            'currentSourceCatalogSha256': sha(encoded(admission.graph(source))), 'ownedSourceReadEdges': sorted(edges, key=encoded),
            'sourceReadinessQualified': False, 'oldWholeInvocationGatePassed': False}


def validate_baseline_catalog(catalog, arena):
    """Every new143 baseline must already contain the actual Arena13 reads."""
    need(arena['validated'] is True and len(arena['ownedSourceReadEdges']) == 13 and catalog['databaseOid'] == '17584',
         'actual_arena_qualified_new_read_baseline_required')
    keys = ('kind', 'object', 'object_name', 'grantee', 'grantor', 'privilege', 'grantable')
    key = lambda row: tuple(str(row[k]) for k in keys)
    current = {key(row) for row in catalog['targetEdges']}
    need(all(key(row) in current for row in arena['ownedSourceReadEdges']), 'Arena13_must_precede_new143_catalog_capture')
    return True


def validate_feature_catalog_order(operation, arena):
    """Later managed integration verifies Arena was present at feature capture.

    The authenticated Arena source boundary atomically committed all13 reads.
    The feature's own complete target10 capture includes two of those relations;
    both must already carry that same actual role/grantor before its eight reads.
    """
    need(arena['validated'] is True and len(arena['ownedSourceReadEdges']) == 13,
         'actual_Arena13_admission_chain_required_for_feature_order')
    expected = {row['object_name'].split('.')[-1]: row for row in arena['ownedSourceReadEdges']
                if row['object_name'] in {NATIVE + '._ponder_meta', NATIVE + '._ponder_checkpoint'}}
    need(set(expected) == {'_ponder_meta', '_ponder_checkpoint'}, 'actual_Arena_native_meta_and_checkpoint_edges_required')
    for phase in ('catalogBefore', 'catalogAfter'):
        tables = {row['name']: row for row in operation[phase]['target']['tables']}
        for name, edge in expected.items():
            row = tables[name]
            need(str(row['oid']) == edge['object'] and
                 {'grantee': edge['grantee'], 'grantor': edge['grantor'], 'privilege': 'SELECT', 'grantable': False} in row['acl'],
                 'actual_Arena_admission_must_precede_feature_catalogBefore')
    return {'ArenaAdmissionPredatesFeatureCapture': True, 'admissionSha256': arena['sha256'],
            'sourceRole': arena['sourceRole'], 'featureEightCatalogsPreserveActualArenaEdges': True,
            'oldWholeValidatorPassed': False}


def validate_before_baseline(input_sha):
    config = document(INPUT, input_sha)
    need(set(config) == {'format', 'rpcReceiptSha256', 'arenaAdmission'} and config['format'] == FORMAT + '-input',
         'exact_new_read_current_context_input_required')
    need(not os.path.lexists(FEATURE_BASE), 'Arena_admission_and_new_baselines_must_precede_any_feature_operation')
    runtime = validate_runtime(config['rpcReceiptSha256']); arena = arena_admission(config['arenaAdmission'])
    leaf, _ = components(); _, host, _, _ = leaf.load()
    old_plan = document(OLD_PLAN, OLD_PLAN_SHA)
    raw = protected(READ_CATALOG, READ_CATALOG_SHA)
    need(old_plan['missingCount'] == len(old_plan['missingPermissions']) == 143 and old_plan['catalogSqlSha256'] == READ_CATALOG_SHA,
         'exact_historical143_logical_READ_scope_required')
    # One fresh owner RR catalog through the retained read-only peer. The old
    # baseline remains historical and is never edited into this new observation.
    sql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL search_path=pg_catalog;' + raw.decode() + ';ROLLBACK;'
    # host.query adds its own transaction; the retained view leaf instead sends
    # this exact explicit RR transaction and returns its bounded JSON row list.
    rows = module(VIEW_OWNER, VIEW_OWNER_SHA).query(host, sql)
    need(len(rows) == 1, 'one_actual_RR_baseline_catalog_required'); catalog = rows[0]
    validate_baseline_catalog(catalog, arena)
    need(validate_runtime(config['rpcReceiptSha256']) == runtime and arena_admission(config['arenaAdmission']) == arena and
         not os.path.lexists(FEATURE_BASE), 'runtime_Arena_or_ordering_changed_during_fresh_baseline')
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'inputSha256': input_sha,
               'runtime': runtime, 'arenaAdmission': arena, 'catalogBefore': catalog,
               'historicalPlanSha256': OLD_PLAN_SHA, 'missingPermissions': old_plan['missingPermissions'],
               'readEdgeCount': 143, 'featureOperationAbsent': True, 'historicalPlanRewritten': False,
               'originalWholeValidatorPassed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    return {**binding, 'reviewHash': sha(encoded(binding))}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--input-sha'); args = parser.parse_args()
    if args.input_sha:
        need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_read_context_host_required')
        signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_current_context_review_expired')); signal.alarm(300)
        value = validate_before_baseline(args.input_sha)
        print(json.dumps({'format': FORMAT, 'reviewHash': value['reviewHash'], 'readEdgeCount': 143,
                          'ArenaSourceReads': 13, 'catalogSha256': sha(encoded(value['catalogBefore'])),
                          'baselineCaptured': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}, sort_keys=True))
    else:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'runtimeQualified': False,
                          'RPCProducerBound': pin(RPC_SHA), 'ArenaAdmissionRequiredBeforeBaseline': True,
                          'readEdgeCount': 143, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'qualified': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'private_diagnostics_withheld',
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0, 'automaticRetryAllowed': False}, sort_keys=True))
        raise SystemExit(1)
