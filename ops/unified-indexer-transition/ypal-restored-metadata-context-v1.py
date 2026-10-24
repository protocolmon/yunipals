#!/usr/bin/env python3
"""Static restored-source query primitives and a separate inverse source leaf.

Construction authenticates actual receipts, code and native object identity. It
never means that a source actor, grants, coverage or a consumer is qualified.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import types

FORMAT = 'yunipals-ypal-restored-metadata-context-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
READ = OPS / 'ypal-restored-read-current-context-v1.py'
READ_SHA = 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932'
RESULT_SHA = '0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1'
RESTORE_SHA = 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'
RPC_SHA = '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b'
META = OPS / 'ypal-native-metadata-candidates-v1.py'
META_SHA = '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525'


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def read_context():
    import stat
    for path in [*READ.parents, READ]:
        st = path.lstat(); need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
                              'protected_frozen_restored_READ_context_required')
    raw = READ.read_bytes(); need(len(raw) < 200000 and sha(raw) == READ_SHA, 'exact_e82_static_helper_source_required')
    value = types.ModuleType('frozen_restored_READ_helpers'); value.__file__ = str(READ)
    exec(compile(raw, str(READ), 'exec'), value.__dict__)
    value.source().protected(READ, READ_SHA); return value


def restore_receipt(source, restore, sdk, op):
    receipt = source.document(source.RESULT, RESULT_SHA)
    intent = sdk.document(restore.BASE / 'start-intent.json')
    need(receipt['format'] == restore.FORMAT and receipt['restored'] is True and receipt['operatorSha256'] == RESTORE_SHA and
         receipt['ancestorOperationSha256'] == restore.OP_SHA and receipt['ancestorOperatorSha256'] == restore.RECOVERY_SHA and
         receipt['bootId'] == op['bootId'] == sdk.boot() and receipt['poolMaximum'] == 5 and
         receipt['originalConfigSha256'] == source.CONFIG_SHA and receipt['originalBoot'] == op['boot'] and
         receipt['startIntentSha256'] == sha(sdk.protected(restore.BASE / 'start-intent.json')) and
         intent['operatorSha256'] == RESTORE_SHA and intent['ancestorOperationSha256'] == restore.OP_SHA and intent['bootId'] == receipt['bootId'] and
         receipt['allSixOriginalMountsQualified'] is receipt['safeRecoveryFloorsPreserved'] is True and
         receipt['prior47abInverseResultClaimed'] is receipt['oldC96ActorRelabelled'] is receipt['sourceReadinessQualified'] is receipt['paidAuthorityAdded'] is False,
         'actual_new_de4_restore_receipt_and_own_start_intent_required')
    actor = receipt['source']
    need(actor['unit']['InvocationID'] != op['source']['unit']['InvocationID'] and
         intent['notBeforeUs'] <= int(actor['unit']['ExecMainStartTimestampMonotonic']) <= intent['notBeforeUs'] + 130000000,
         'recorded_restore_epoch_must_follow_its_own_start_intent')
    return receipt


def native_identity(native, receipt):
    expected = receipt['native']
    need(native['schemaOid'] == expected['schemaOid'] == '75963410' and native['tables'] == expected['tables'] and len(native['tables']) == 44 and
         native['cache'] == expected['cache'] and native['app']['build_id'] == '71e2a7f3b7' and
         all(r['owner'] == '73004621' and r['kind'] == 'r' for r in native['tables'].values()),
         'same_actual_native44_and_shared_sync_cache_required')
    return {k: native[k] for k in ['schemaOid', 'tables', 'cache']}


def query_components():
    """Receipt/static-qualified objects, deliberately without a live actor check."""
    read = read_context(); source = read.source(); restore = source.restore()
    recovery, sdk, host, ancestor = restore.load()  # Static constructors, never review()/new_owned().
    receipt = restore_receipt(source, restore, sdk, ancestor)
    old = read.historical(); helpers = read.module(read.READ_HELPERS, read.READ_HELPERS_SHA)
    plan = read.document(old.OLD_PLAN, old.OLD_PLAN_SHA)
    need(plan['missingCount'] == len(plan['missingPermissions']) == len(helpers.statements(plan)) == 143 and
         plan['catalogSqlSha256'] == old.READ_CATALOG_SHA and plan['physicalSchema'] == old.NATIVE and plan['physicalSchemaOid'] == '75963410' and
         plan['readSchema'] == old.READ and plan['readSchemaOid'] == '75994954' and
         {r['name']: r['oid'] for r in plan['baselineCatalog']['roles']} == helpers.ROLE_OIDS and
         plan['newRoles'] == plan['loginChanges'] == plan['newDml'] == 0, 'same_historical143_scope_not_new_admission_required')
    catalog_sql = source.protected(old.READ_CATALOG, old.READ_CATALOG_SHA).decode().strip()
    native = native_identity(host.native(), receipt)
    pure = types.SimpleNamespace(ROLE_OIDS=helpers.ROLE_OIDS, edge_key=helpers.edge_key, expected_edges=helpers.expected_edges,
        validate_delta=helpers.validate_delta, validate_reader_delta=helpers.validate_reader_delta, statements=helpers.statements)
    return {'readerHost': read.ReaderHost(host, catalog_sql), 'historicalReadHelpers': pure, 'historicalReadPlan': plan,
            'historicalPlanSha256': old.OLD_PLAN_SHA, 'catalogSql': catalog_sql, 'catalogSqlSha256': old.READ_CATALOG_SHA,
            'privilegedSourcePrimitives': {'restoreModule': restore, 'recoveryModule': recovery, 'sdk': sdk,
                'host': host, 'ancestorOperation': ancestor, 'recordedSource': receipt['source'], 'restoreReceipt': receipt},
            'nativeIdentity': native, 'sourceContext': source, 'readContext': read,
            'actualNewReadAdmissionQualified': False, 'actualNewCacheAdmissionQualified': False,
            'sourceActorQualified': False, 'terminalInverseSourceQualified': False, 'historicalPlanRewritten': False,
            'frameworkReadinessQualified': False, 'financialAuthorityQualified': False}


def reader_host_static(): return query_components()['readerHost']
def query_host(): return reader_host_static()
def load_static_components(): return query_components()


def gone(processes):
    for row in processes:
        try: raw = (Path('/proc') / str(row['pid']) / 'stat').read_text()
        except (FileNotFoundError, ProcessLookupError): continue
        need(int(raw[raw.rfind(')') + 2:].split()[19]) != row['startTicks'], 'acknowledged_source_PID_epoch_must_be_gone')


def inverse_source():
    parts = query_components(); p = parts['privilegedSourcePrimitives']
    restore, r, sdk, h, op = (p[k] for k in ['restoreModule', 'recoveryModule', 'sdk', 'host', 'ancestorOperation'])
    receipt = p['restoreReceipt']; owner = restore.Owner(r, sdk, h, op)
    owner.prefix()  # Exact original loaded definitions, six mounts, boot and removed-overlay inode.
    need(h.inputs() == op['inputs'], 'unchanged_restored_source_private_and_public_inputs_required')
    rpc = h.rpc_current(); need(rpc['receiptSha256'] == RPC_SHA and rpc['rpcScopeOnly'] is True and rpc['sourceActorQualified'] is False,
                               'current_nine_RPC_only_proof_required')
    actor = h.actor(r.SOURCE, True)
    terminal = actor is None
    if terminal: gone(receipt['source']['processes'])
    else: need(restore.canonical_actor(owner.owned()) == receipt['source'], 'only_acknowledged_restored_source_epoch_allowed')
    native = h.native(); native_identity(native, receipt); owner.floors(native); r.recovery_floor(receipt['native'], native)
    if not terminal: r.epoch_heartbeat(native, owner.get('start-intent.json'))
    h.raw.old_terminal(h.source_op); h.raw.preserved_old_native(h.source_op)
    need(h.actor(r.SOURCE, True) == actor, 'source_changed_during_inverse_source_observation')
    owner.prefix()
    return {'format': FORMAT + '-inverse-source', 'validated': True, 'restoreReceiptSha256': RESULT_SHA,
            'restoreOperatorSha256': RESTORE_SHA, 'sourceState': 'terminal' if terminal else 'acknowledged-active',
            'sourceTerminalQualified': terminal, 'sourceActorQualified': not terminal, 'recordedSource': receipt['source'],
            'nativeIdentity': parts['nativeIdentity'], 'currentRPC': rpc, 'poolMaximum': 5,
            'sameOriginalBootAndSixMountsQualified': True, 'safeRecoveryFloorsPreserved': True,
            'originalWholeValidatorPassed': False, 'currentWriterBackendRequalified': False, 'writerExclusivityQualified': False,
            'frameworkReadinessQualified': False, 'currentCanonicalCoverageQualified': False,
            'readerRoleGraphQualified': False, 'financialAuthorityQualified': False,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def validate_inverse_runtime(): return inverse_source()
def source_inverse_context(): return inverse_source()


def metadata_primitives():
    parts = query_components(); source = parts['sourceContext']; p = parts['privilegedSourcePrimitives']; s = p['host'].s
    meta = read_context().module(META, META_SHA)
    m = s.module(OPS / 'retained-workers-stage-v1.py', meta.RETAINED_SHA)
    installer = s.module(OPS / 'metadata-normalization-runtime-install-v1.py', meta.INSTALLER_SHA)
    installer.installed(m, meta.INSTALL_SHA)
    reader = s.module(meta.READ_OWNER, meta.READ_OWNER_SHA)
    created = source.document(meta.READ_BASE / 'created.json', meta.READ_RESULT_SHA)
    need(created['format'] == reader.FORMAT and created['created'] is True and created['readSchema'] == meta.READ and
         created['readIdentity'] == meta.IDENTITY and created['sourceRelease'] == meta.RELEASE and
         created['sourceReceiptSha256'] == meta.SOURCE_RESULT_SHA and created['selected'] is False and
         created['target']['schemaOid'] == '75994954' and
         parts['readerHost'].query("SELECT oid::text FROM pg_namespace WHERE nspname='" + meta.READ + "'") == '75994954',
         'actual_immutable_created_readview_ancestry_required')
    return {'meta': meta, 's': s, 'h': types.SimpleNamespace(query=parts['readerHost'].query, observer=p['host'].raw.observer),
            'm': m, 'installer': installer, 'reader': reader, 'source_op': p['host'].source_op,
            'source': p['restoreReceipt'], 'created': created, 'sourceContext': source,
            'sourcePrimitives': p, 'sourceAuthorityQualified': False, 'newAdmissionQualified': False}


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--inverse-source', action='store_true'); p.add_argument('--query-context', action='store_true'); a = p.parse_args()
    need(not(a.inverse_source and a.query_context), 'one_explicit_readonly_context_mode_required')
    if not(a.inverse_source or a.query_context):
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'sourceActorQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_metadata_context_host_required')
    import signal
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_metadata_context_observation_expired')); signal.alarm(300)
    value = inverse_source() if a.inverse_source else query_components()
    print(json.dumps({'format': FORMAT, 'validated': True, 'sourceActorQualified': value.get('sourceActorQualified', False),
                      'terminalInverseSourceQualified': value.get('sourceTerminalQualified', False),
                      'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}, sort_keys=True))


if __name__ == '__main__': main()
