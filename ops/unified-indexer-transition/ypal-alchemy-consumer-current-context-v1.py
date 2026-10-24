#!/usr/bin/env python3
"""Current source intake and separate historical query components; read only.

No consumer constructor, grant, LOGIN, selector or source action is dispatched.
The old e82/994 runtime is historical, never a successful current predicate.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import sys
import types
import time

FORMAT = 'yunipals-ypal-alchemy-consumer-current-context-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SOURCE = OPS / 'ypal-alchemy-source-completion-v1.py'
SOURCE_SHA = '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0'
RESULT_SHA = 'dd98ef06f05d88c1e0af0ff7bf9329f79bfb171cce1e10690a628c678f7e2ea6'
START_SHA = '32d974038f921b11f5f8fb810f636762f2a3277412a1f7983dce5ea775a1f3ba'
STATIC = OPS / 'ypal-restored-metadata-context-v1.py'
STATIC_SHA = 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
REGISTERED_CONTEXT = OPS / 'ypal-source-restored-current-context-v1.py'
REGISTERED_CONTEXT_SHA = '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae'
READ_CREATED = Path('/var/backups/yunipals-ypal-combined-readview-owner-v1-20261023/created.json')
READ_CREATED_SHA = '17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3'
UNIT = 'yunipals-ypal-combined-source.service'
RETRY = 'all_required_backends_need_unique_positive_stable_kernel_attribution'
DATA = {
    'sourceRelease': '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
    'manifestHash': '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
    'schema': 'unified_ypal_20261023_v1', 'schemaOid': '75963410', 'buildId': '71e2a7f3b7',
    'readSchema': 'yunipals_ownership_4e77f52b_v4', 'readSchemaOid': '75994954',
    'readIdentity': '0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'
}


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def module(path, expected):
    path = Path(path)
    for parent in [*path.parents, path]:
        row = parent.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             'protected_fixed_current_source_dependency_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 200000,
         'bounded_single_link_current_source_dependency_required')
    identity = lambda row: tuple(getattr(row, key) for key in
        ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))
    raw = path.read_bytes()
    need(sha(raw) == expected and identity(before) == identity(path.lstat()),
         'exact_current_source_dependency_before_evaluation_required')
    value = types.ModuleType('current_intake_' + path.stem)
    value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    need(identity(before) == identity(path.lstat()) and sha(path.read_bytes()) == expected,
         'same_current_source_dependency_after_evaluation_required')
    return value


def current(completion, attempts=None):
    """Retry the complete real leaf only for its precise socket-pool CAS error."""
    if attempts is None:
        attempts = []
    for attempt in range(3):
        try:
            value = completion.current()
            need(value['validated'] is value['currentWriterQualified'] is True and
                 value['completionResultSha256'] == RESULT_SHA and
                 value['original440PaidStartAcknowledged'] is value['financialAuthorityQualified'] is False,
                 'actual_owned_completion_current_proof_required')
            attempts.append({'attempt': attempt + 1, 'validated': True, 'fixedCode': None})
            return value
        except RuntimeError as error:
            attempts.append({'attempt': attempt + 1, 'validated': False,
                             'fixedCode': RETRY if str(error) == RETRY else 'nonretryable_current_leaf_refusal'})
            if str(error) != RETRY or attempt == 2:
                raise
            time.sleep(0.25)


def _completion():
    return module(SOURCE, SOURCE_SHA).load()


def _registration_context():
    # Only protected()/document() and fixed receipt/profile constants are used.
    # Its old active-source and old free-RPC predicates are never invoked.
    return module(REGISTERED_CONTEXT, REGISTERED_CONTEXT_SHA)


def registered_data(c):
    s = _registration_context()
    registered = s.document(s.REGISTERED, s.REGISTERED_SHA)
    profile = s.document(s.PROFILE, s.PROFILE_SHA)
    created = s.document(READ_CREATED, READ_CREATED_SHA)
    need(registered['registered'] is True and registered['releaseId'] == DATA['sourceRelease'] and
         registered['manifestHash'] == DATA['manifestHash'] and registered['sourceReceiptSha256'] == s.C96 and
         registered['activeReleaseChanged'] is False and created['created'] is True and created['selected'] is False and
         created['readSchema'] == DATA['readSchema'] and created['readIdentity'] == DATA['readIdentity'] and
         created['sourceRelease'] == DATA['sourceRelease'] and created['target']['schemaOid'] == DATA['readSchemaOid'],
         'actual_registered_and_created_readview_ancestry_required')
    release, physical, read = DATA['sourceRelease'], DATA['schema'], DATA['readSchema']
    value = c.h.source.query("SELECT jsonb_build_object('registered',(SELECT jsonb_build_object('id',id,'schema',physical_schema,"
        "'build',build_id,'manifestHash',manifest_hash,'manifest',manifest) FROM yunipals_indexer_control.release WHERE id='" + release +
        "'),'sources',(SELECT jsonb_agg(jsonb_build_object('id',id,'chainId',chain_id,'manifestHash',manifest_hash,'definition',definition::jsonb)"
        " ORDER BY id) FROM " + physical + ".indexer_source),'readSchemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + read +
        "'),'marker',(SELECT to_jsonb(m)-'created_at' FROM " + read + "._unified_read_release m WHERE singleton))")
    expected_sources = sorted([{'id': row['id'], 'chainId': row['chainId'], 'manifestHash': DATA['manifestHash'],
                                'definition': row} for row in profile['manifest']['sources']], key=lambda row: row['id'])
    need(len(expected_sources) == 12 and value == {
        'registered': {'id': release, 'schema': physical, 'build': DATA['buildId'],
                       'manifestHash': DATA['manifestHash'], 'manifest': profile['manifest']},
        'sources': expected_sources, 'readSchemaOid': DATA['readSchemaOid'], 'marker': created['target']['marker']},
        'same_actual_registered_manifest_twelve_sources_and_read_marker_required')
    return value


def observe_runtime():
    c = _completion()
    need(c.digest('result.json') == RESULT_SHA and c.digest('start-intent.json') == START_SHA,
         'exact_actual_completion_ACK_and_own_start_intent_required')
    before_attempts, after_attempts = [], []
    first = current(c, before_attempts)
    receipt = c.record('result.json')
    need(receipt['completed'] is True and receipt['startIntentSha256'] == START_SHA and
         receipt['original440PaidStartAcknowledged'] is False,
         'actual_completion_receipt_chain_required')
    native = c.h.source.native()
    expected = receipt['native']
    need(native['schemaOid'] == expected['schemaOid'] == DATA['schemaOid'] and
         native['tables'] == expected['tables'] and len(native['tables']) == 44 and
         all(row['owner'] == '73004621' and row['kind'] == 'r' for row in native['tables'].values()) and
         native['cache'] == expected['cache'] and native['app']['build_id'] == DATA['buildId'] and
         c.owner.c.fowner.m.RELEASE == DATA['sourceRelease'] and c.owner.c.fowner.m.MANIFEST == DATA['manifestHash'],
         'same_registered_current_native44_cache_and_build_required')
    actor = receipt['source']
    registered = registered_data(c)
    second = current(c, after_attempts)
    need(first['sourcePID'] == second['sourcePID'] == actor['parent']['pid'],
         'current_source_epoch_changed_during_intake')
    operation = c.owner.operation()
    binding = {'format': FORMAT + '-runtime', 'validated': True, **DATA,
        'sourceEpoch': 'acknowledged-alchemy-completion', 'poolMaximum': 5,
        'intakeOnly': True, 'forwardConsumerMutationQualified': False,
        'writerHandoverQualified': False,
        'completionProducerSha256': SOURCE_SHA, 'completionReceiptSha256': RESULT_SHA,
        'completionStartIntentSha256': START_SHA, 'source': copy.deepcopy(actor),
        'sourceKernelActors': {UNIT: copy.deepcopy(actor)},
        'nativeTableIdentities': copy.deepcopy(native['tables']), 'syncCacheIdentity': copy.deepcopy(native['cache']),
        'registeredDataSha256': sha(encoded(registered)), 'createdReadviewReceiptSha256': READ_CREATED_SHA,
        'chainRouting': copy.deepcopy(operation['chainRouting']),
        'operationalWindowPlanSha256': operation['planSha256'],
        'expiresMs': operation['financialPlan']['expiresMs'],
        'automaticReturnAtMs': operation['financialPlan']['expiresMs'] - 300000,
        'currentWriterQualified': True, 'originalWholeValidatorPassed': False,
        'oldRestoredSourceContextPassed': False, 'frameworkReadinessQualified': False,
        'currentCanonicalCoverageQualified': False, 'readerRoleGraphQualified': False,
        'READ143AuthorityQualified': False, 'sourceReadinessQualified': False,
        'financialAuthorityQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    return {'binding': binding, 'observation': {'native': native,
        'currentLeafAttemptsBefore': before_attempts, 'currentLeafAttemptsAfter': after_attempts,
        'sourceReadinessQualified': second['sourceReadinessQualified'],
        'positiveKernelSessions': second['positiveKernelSessions']}, 'bindingSha256': sha(encoded(binding))}


def validate_runtime():
    """Stable binding after fresh real source qualification; excludes progress."""
    return observe_runtime()['binding']


def historical_components():
    """Exact SQL/query/metadata ancestry, deliberately without current writer proof.

    Callers must explicitly compose validate_runtime/observe_runtime. In
    particular, the nested historical e82/994 objects are not current adapters.
    """
    parts = module(STATIC, STATIC_SHA).query_components()
    need(parts['sourceActorQualified'] is parts['financialAuthorityQualified'] is False and
         parts['historicalReadPlan']['missingCount'] == 143,
         'source_independent_historical_query_scope_required')
    return {'format': FORMAT + '-historical-components', 'components': parts,
        'historicalSqlScopeCount': 143, 'sourceActorQualified': False, 'currentWriterQualified': False,
        'oldRestoredSourceContextPassed': False, 'actualNewReadAdmissionQualified': False,
        'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--runtime', action='store_true')
    group.add_argument('--historical-components', action='store_true')
    args = parser.parse_args()
    if not args.runtime and not args.historical_components:
        print(json.dumps({'format': FORMAT, 'sourceOnly': True, 'currentWriterQualified': False,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_intake_host_required')
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_current_source_intake_expired')); signal.alarm(180)
    if args.runtime:
        value = observe_runtime()
        output = {'validated': True, 'bindingSha256': value['bindingSha256'],
                  'sourceReadinessQualified': value['observation']['sourceReadinessQualified'],
                  'nativeRelations': len(value['binding']['nativeTableIdentities']), 'currentWriterQualified': True,
                  'currentLeafAttemptsBefore': value['observation']['currentLeafAttemptsBefore'],
                  'currentLeafAttemptsAfter': value['observation']['currentLeafAttemptsAfter']}
    else:
        value = historical_components()
        output = {'validated': True, 'historicalSqlScopeCount': value['historicalSqlScopeCount'], 'currentWriterQualified': False}
    print(json.dumps({'format': FORMAT, **output, 'oldRestoredSourceContextPassed': False,
                      'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error)
        print(json.dumps({'format': FORMAT, 'validated': False,
            'fixedCode': code if type(error) is RuntimeError and code.replace('_', '').isalnum() else type(error).__name__,
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); raise SystemExit(1)
