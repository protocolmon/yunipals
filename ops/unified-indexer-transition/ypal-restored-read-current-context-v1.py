#!/usr/bin/env python3
"""Read-only READ143 baseline context for the actual acknowledged restore epoch.

Historical READ SQL/plans remain scope evidence, never a new grant ACK. No old
c96 runtime/view/admission constructor is called or patched.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

FORMAT = 'yunipals-ypal-restored-read-current-context-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
INPUT = Path('/var/backups/yunipals-ypal-restored-read-current-input-v1-20261024/input.json')
SOURCE = OPS / 'ypal-source-restored-current-context-v1.py'
SOURCE_SHA = '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae'
OLD = OPS / 'ypal-combined-read-current-context-v1.py'
OLD_SHA = 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc'
READ_HELPERS = OPS / 'ypal-combined-read-admission-v2.py'
READ_HELPERS_SHA = 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd'
RPC_RECEIPT_SHA = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
RESTORE_SHA = 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'
RESTORE_RESULT_SHA = '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'


def need(ok, code):
    if not ok: raise RuntimeError(code)
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def source():
    # Use exactly the already-qualified source context's protected reader.
    import stat
    for path in [*SOURCE.parents, SOURCE]:
        st = path.lstat(); need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
                              'protected_restored_source_context_required')
    raw = SOURCE.read_bytes(); need(len(raw) < 200000 and sha(raw) == SOURCE_SHA, 'exact994_source_context_required')
    value = types.ModuleType('actual_restored_source_context'); value.__file__ = str(SOURCE)
    exec(compile(raw, str(SOURCE), 'exec'), value.__dict__)
    value.protected(SOURCE, SOURCE_SHA); return value


def module(path, expected):
    s = source(); raw = s.protected(path, expected)
    value = types.ModuleType(Path(path).stem); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value


def historical(): return module(OLD, OLD_SHA)
def document(path, expected): return json.loads(source().protected(path, expected))


def validate_runtime(rpc_pin=RPC_RECEIPT_SHA):
    need(rpc_pin == RPC_RECEIPT_SHA, 'exact_current1521_RPC_reference_required')
    value = source().validate_runtime()
    need(value['format'] == 'yunipals-source-restored-current-context-v1-runtime' and value['validated'] is True and
         value['sourceEpoch'] == 'acknowledged-de4-original-pool5-restore' and value['poolMaximum'] == 5 and
         value['operationalRestore']['producerSha256'] == RESTORE_SHA and value['operationalRestore']['receiptSha256'] == RESTORE_RESULT_SHA and
         value['currentRPC']['receiptSha256'] == RPC_RECEIPT_SHA and len(value['nativeTableIdentities']) == 44 and
         all(value[k] is False for k in ['originalWholeValidatorPassed', 'frameworkReadinessQualified', 'currentCanonicalCoverageQualified',
             'readerRoleGraphQualified', 'ArenaAuthorityQualified', 'READ143AuthorityQualified', 'sourceReadinessQualified',
             'financialAuthorityQualified', 'financialWriteAuthorityQualified', 'currentWriterBackendRequalified']) and
         value['databaseWrites'] == value['serviceActions'] == value['providerCalls'] == 0, 'actual_restored5_source_only_binding_required')
    return value


def observe_runtime():
    observed = source().observe_runtime()
    need(observed['binding'] == validate_runtime(), 'same_current_restored_source_binding_required')
    return observed


def validate_baseline_catalog(catalog, arena): return historical().validate_baseline_catalog(catalog, arena)
def validate_feature_catalog_order(operation, arena): return historical().validate_feature_catalog_order(operation, arena)


class ReaderHost:
    """Bounded owner READ ONLY peer; no manager, grant or credential interface."""
    def __init__(self, host, catalog_sql): self._host, self.catalog_sql = host, catalog_sql
    def query(self, sql):
        need(isinstance(sql, str) and len(sql.encode()) <= 200000 and ';' not in sql and '\x00' not in sql and
             re.match(r'^\s*(SELECT|WITH)\b', sql, re.I), 'one_bounded_readonly_selector_required')
        return self._host.query(sql)
    def catalog(self):
        sql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL search_path=pg_catalog;' + self.catalog_sql + ';ROLLBACK;'
        return self._host.sdk.peer_query(sql)


def load_components():
    runtime = validate_runtime(); old = historical(); helpers = module(READ_HELPERS, READ_HELPERS_SHA)
    plan = document(old.OLD_PLAN, old.OLD_PLAN_SHA)
    need(plan['missingCount'] == len(plan['missingPermissions']) == 143 and plan['catalogSqlSha256'] == old.READ_CATALOG_SHA and
         plan['physicalSchema'] == old.NATIVE and plan['physicalSchemaOid'] == '75963410' and
         plan['readSchema'] == old.READ and plan['readSchemaOid'] == '75994954' and
         {row['name']: row['oid'] for row in plan['baselineCatalog']['roles']} == helpers.ROLE_OIDS and
         plan['newRoles'] == plan['loginChanges'] == plan['newDml'] == 0, 'unchanged_historical143_logical_scope_required')
    # Pure validation also proves the exact historical edge kinds and grantees.
    need(len(helpers.statements(plan)) == 143, 'same143_existing_role_read_statements_required')
    sql = source().protected(old.READ_CATALOG, old.READ_CATALOG_SHA).decode().strip()
    restore = source().restore(); recovery, sdk, host, ancestor = restore.load()
    pure = types.SimpleNamespace(ROLE_OIDS=helpers.ROLE_OIDS, edge_key=helpers.edge_key, expected_edges=helpers.expected_edges,
        validate_delta=helpers.validate_delta, validate_reader_delta=helpers.validate_reader_delta, statements=helpers.statements)
    need(validate_runtime() == runtime, 'source_changed_during_component_construction')
    return {'runtime': runtime, 'readerHost': ReaderHost(host, sql), 'historicalReadHelpers': pure,
            'privilegedSourcePrimitives': {'restoreModule': restore, 'recoveryModule': recovery, 'sdk': sdk,
                'host': host, 'ancestorOperation': ancestor, 'currentSource': runtime['source']},
            'historicalReadPlan': plan, 'historicalPlanSha256': old.OLD_PLAN_SHA, 'catalogSql': sql, 'catalogSqlSha256': old.READ_CATALOG_SHA,
            'actualNewReadAdmissionQualified': False, 'actualNewCacheAdmissionQualified': False,
            'terminalInverseSourceQualified': False, 'historicalPlanRewritten': False}


def reader_host(): return load_components()['readerHost']


def arena_admission(config):
    """Explicit current Arena role/auth composition, independent of source PIDs."""
    old = historical()
    need(set(config) == {'receiptSha256', 'phase', 'setupSha256', 'authSha256'} and pin(config['receiptSha256']) and
         config['phase'] in {'admitted', 'passwords', 'login'}, 'actual_Arena_admission_and_explicit_auth_phase_required')
    admission = module(old.ADMISSION, old.ADMISSION_SHA); receipt = document(old.ADMISSION_RESULT, config['receiptSha256'])
    need(receipt['format'] == 'yunipals-arena-ypal-admission-v2' and receipt['commitOutcome'] == 'commit_confirmed' and
         receipt['operatorSha256'] == old.ADMISSION_SHA and receipt['releaseId'] == old.RELEASE, 'actual_Arena13_admission_required')
    passwords = None
    if config['phase'] == 'admitted':
        need(config['setupSha256'] is config['authSha256'] is None, 'NOLOGIN_phase_cannot_claim_credentials')
    else:
        need(pin(config['setupSha256']), 'actual_owned_Arena_setup_required')
        setup = document(old.CREDENTIAL_BASE / 'setup-result.json', config['setupSha256'])
        need(setup['format'] == 'yunipals-arena-ypal-credentials-v2' and setup['operatorSha256'] == old.CREDENTIALS_SHA and
             setup['admissionResultSha256'] == config['receiptSha256'] and setup['roles'] == receipt['roles'] and
             setup['sourceRole'] == receipt['sourceRole'] and setup['credentialsConfigured'] is True and setup['loginEnabled'] is False,
             'same_actual_Arena_setup_chain_required')
        passwords = setup['passwordVerifierSha256']
        if config['phase'] == 'passwords': need(config['authSha256'] is None, 'password_phase_cannot_claim_LOGIN')
        else:
            need(pin(config['authSha256']), 'actual_owned_Arena_LOGIN_authentication_required')
            auth = document(old.CREDENTIAL_BASE / 'auth-result.json', config['authSha256'])
            need(auth['format'] == 'yunipals-arena-ypal-role-auth-v2' and auth['operatorSha256'] == old.CREDENTIALS_SHA and
                 auth['admissionResultSha256'] == config['receiptSha256'] and auth['setupResultSha256'] == config['setupSha256'] and
                 auth['roles'] == receipt['roles'] and auth['sourceRole'] == receipt['sourceRole'] and
                 auth['loginEnabled'] is auth['grantsVerified'] is auth['tcpAuthenticationProven'] is True, 'same_actual_Arena_LOGIN_chain_required')
    verified = admission.verify_current(receipt, phase=config['phase'], password_sha256=passwords)
    need(verified['validated'] is True and verified['phase'] == config['phase'] and verified['roleCount'] == 9 and
         verified['databaseWrites'] == 0 and verified['catalogs']['source']['requiredEdges'] == 13, 'exact_nine_roles_and13_source_reads_required')
    h = admission.runner(); proposal = h.load_proposal(); catalog = admission.current_catalog(h, proposal, 'source')
    role_name, role_oid = receipt['sourceRole']['name'], receipt['sourceRole']['oid']
    admission.validate_catalog(h, proposal, 'source', catalog, {role_name: role_oid}, phase=config['phase'],
                               password_sha256=None if passwords is None else {role_name: passwords[role_name]})
    edges = []
    for edge in catalog['roles'][0]['directRelationAcl']:
        if edge['granteeOid'] != role_oid: continue
        row = next(r for r in catalog['relations'] if r['name'] == edge['relation'])
        edges.append({'kind': 'relation', 'object': str(row['oid']), 'object_name': row['name'], 'grantee': str(edge['granteeOid']),
                      'grantor': str(edge['grantorOid']), 'privilege': edge['privilege'], 'grantable': edge['grantOption'], 'column_number': None})
    need(len(edges) == 13 and all(e['privilege'] == 'SELECT' and not e['grantable'] and e['object_name'].split('.')[0] in old.SCOPES for e in edges),
         'exact_thirteen_owned_Arena_relation_edges_required')
    return {'validated': True, 'file': str(old.ADMISSION_RESULT), 'sha256': config['receiptSha256'], 'operatorSha256': old.ADMISSION_SHA,
            'sourceRole': receipt['sourceRole'], 'phase': config['phase'], 'currentSourceCatalogSha256': sha(encoded(admission.graph(catalog))),
            'ownedSourceReadEdges': sorted(edges, key=encoded), 'sourceReadinessQualified': False, 'oldWholeInvocationGatePassed': False}


def validate_before_baseline(input_sha):
    config = document(INPUT, input_sha)
    need(set(config) == {'format', 'rpcReceiptSha256', 'arenaAdmission'} and config['format'] == FORMAT + '-input', 'exact_new_restored_read_context_input_required')
    old = historical(); need(not os.path.lexists(old.FEATURE_BASE), 'Arena_and_new_READ_baseline_must_precede_feature_operation')
    runtime = validate_runtime(config['rpcReceiptSha256']); arena = arena_admission(config['arenaAdmission']); parts = load_components()
    need(parts['runtime'] == runtime, 'same_restored_source_for_new_baseline_required')
    catalog = parts['readerHost'].catalog(); validate_baseline_catalog(catalog, arena)
    need(validate_runtime(config['rpcReceiptSha256']) == runtime and arena_admission(config['arenaAdmission']) == arena and
         not os.path.lexists(old.FEATURE_BASE), 'source_Arena_or_ordering_changed_during_RR_baseline')
    binding = {'format': FORMAT, 'operatorSha256': sha(source().protected(Path(__file__).absolute(), sha(Path(__file__).read_bytes()))),
               'inputSha256': input_sha, 'runtime': runtime, 'arenaAdmission': arena, 'catalogBefore': catalog,
               'historicalPlanSha256': parts['historicalPlanSha256'], 'missingPermissions': parts['historicalReadPlan']['missingPermissions'],
               'readEdgeCount': 143, 'featureOperationAbsent': True, 'historicalPlanRewritten': False,
               'actualNewReadAdmissionQualified': False, 'actualNewCacheAdmissionQualified': False, 'terminalInverseSourceQualified': False,
               'originalWholeValidatorPassed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    return {**binding, 'reviewHash': sha(encoded(binding))}


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--input-sha'); p.add_argument('--runtime', action='store_true'); args = p.parse_args()
    need(not (args.input_sha and args.runtime), 'separate_runtime_and_baseline_reviews_required')
    if not args.input_sha and not args.runtime:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'runtimeQualified': False, 'readEdgeCount': 143,
                          'newAdmissionQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_read_context_host_required')
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_read_context_review_expired')); signal.alarm(300)
    value = validate_runtime() if args.runtime else validate_before_baseline(args.input_sha)
    print(json.dumps({'format': FORMAT, 'validated': True, 'bindingSha256': sha(encoded(value)), 'readEdgeCount': 143,
                      'newAdmissionQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'qualified': False, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else type(error).__name__,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); raise SystemExit(1)
