#!/usr/bin/env python3
"""Register the acknowledged combined namespace; never select a reader/source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

FORMAT = 'yunipals-ypal-combined-release-register-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-combined-release-register-v1-20261023')
SOURCE = OPS / 'ypal-combined-source-v1-stage/start-source.py'
SOURCE_SHA = '3a70a1167f7e8ffcc73689bc8f0b668319ad1801801c4b403fc791998a7686f6'
SOURCE_ACK_SHA = 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
SOURCE_OPERATION = 'a80ce9cca2da0dd5e40958db16e65f46e82ea859e861cfb110407e4bf93b9336'
RUNNER = OPS / 'ypal-combined-release-register-v1.mjs'
RUNNER_SHA = '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca'
RELEASE_ID = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
MANIFEST_HASH = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
PROFILE_SHA = 'c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b'
NODE = '/opt/node-v24.18.1/bin/node'
RELEASE = Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6')


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def load():
    raw = SOURCE.read_bytes()
    need(sha(raw) == SOURCE_SHA, 'exact_source_controller_required')
    s = types.ModuleType('combined_source_owner'); s.__file__ = str(SOURCE)
    exec(compile(raw, str(SOURCE), 'exec'), s.__dict__)
    need(sha(s.protected(SOURCE)) == SOURCE_SHA, 'protected_source_controller_required')
    ack = s.document(s.BASE / 'result.json', SOURCE_ACK_SHA)
    need(ack['completed'] is True and ack['operatorSha256'] == SOURCE_SHA and
         ack['operationSha256'] == SOURCE_OPERATION and ack['schema'] == s.SCHEMA and
         ack['buildId'] == s.BUILD and ack['native']['schemaOid'] == '75963410' and
         ack['nativeCoverageAccepted'] is False and ack['readerOrWorkerSelectionsChanged'] is False,
         'exact_acknowledged_bootstrap_required')
    op = s.load_operation(SOURCE_OPERATION)
    h = s.Host(ack['rpcOwnerSha256'], ack['rpcResultSha256'], ack['hostBuildResultSha256'])
    return s, h, op, ack


def binding(s, h, op, ack):
    need(not (s.BASE / 'inverse-intent.json').exists(), 'source_inverse_must_not_have_started')
    s.check_preserved(h, op)
    h.old_terminal(op); h.preserved_old_native(op)
    actor, native = s.bootstrap(h, op)
    need(actor == ack['source'] and native['schemaOid'] == ack['native']['schemaOid'] and
         native['tables'] == ack['native']['tables'], 'same_acknowledged_source_and_table_identities_required')
    s.exact_link(s.NEW_LINK, ack['newBoot'])
    need(isinstance(RUNNER_SHA, str) and re.fullmatch('[a-f0-9]{64}', RUNNER_SHA) and
         sha(s.protected(RUNNER)) == RUNNER_SHA, 'frozen_registration_runner_required')
    need(sha(s.protected(OPS / 'ypal-combined-rpc-v1/profile.json')) == PROFILE_SHA, 'exact_admitted_manifest_file_required')
    return {'sourceReceiptSha256': SOURCE_ACK_SHA, 'sourceControllerSha256': SOURCE_SHA,
            'sourceOperationSha256': SOURCE_OPERATION, 'source': actor,
            'schema': s.SCHEMA, 'schemaOid': native['schemaOid'], 'tableIdentitiesSha256': sha(encoded(native['tables'])),
            'buildId': s.BUILD, 'manifestHash': MANIFEST_HASH, 'releaseId': RELEASE_ID,
            'profileSha256': PROFILE_SHA, 'runnerSha256': RUNNER_SHA,
            'routesReceiptSha256': ack['rpcResultSha256'], 'bootId': s.boot(),
            'liveYPALAndRoutesPreserved': True, 'oldSourceRemainsStopped': True}


def official(h, phase, expected=None):
    need(phase in {'review', 'rehearse', 'commit', 'reconcile'} and
         (expected is None if phase == 'review' else re.fullmatch('0x[a-f0-9]{64}', expected or '')),
         'fixed_official_registration_phase_required')
    sentinel = '/run/yunipals-combined-release-no-password-file'
    need(not os.path.lexists(sentinel), 'absent_peer_password_file_required')
    args = [*h.m.peer(), '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC',
            'PGPASSFILE=' + sentinel, NODE, '--import', str(RELEASE / 'apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs'),
            str(RUNNER), phase, *([expected] if expected else [])]
    value = json.loads(h.m.run(args, timeout=45))
    need(value['phase'] == phase and value['releaseId'] == RELEASE_ID and value['manifestHash'] == MANIFEST_HASH and
         value['activated'] is False and value['providerRequests'] == 0 and
         value['databaseCommitted'] is (phase == 'commit'), 'fixed_official_registration_ack_required')
    return value


def review(s, h, op, ack):
    first = binding(s, h, op, ack); value = official(h, 'review')
    need(value['targetRegistered'] is False, 'fresh_unregistered_candidate_required')
    need(binding(s, h, op, ack) == first, 'source_changed_during_registration_review')
    result = {'format': FORMAT, 'binding': first, 'official': value,
              'operatorSha256': sha(s.protected(Path(__file__).absolute())),
              'activeReleaseChanged': False, 'consumersChanged': False, 'nativeDataWritten': False, 'providerRequests': 0}
    return {**result, 'reviewHash': sha(encoded(result))}


def before(s, h, op, ack, expected):
    value = s.document(BASE / 'before.json')
    fields = {k: v for k, v in value.items() if k != 'reviewHash'}
    need(value['reviewHash'] == expected == sha(encoded(fields)) and
         value['operatorSha256'] == sha(s.protected(Path(__file__).absolute())), 'exact_saved_registration_review_required')
    need(binding(s, h, op, ack) == value['binding'], 'source_changed_since_registration_review')
    return value


def rehearse(s, h, op, ack, expected):
    need(not os.path.lexists(BASE), 'fresh_registration_operation_required')
    value = review(s, h, op, ack)
    need(value['reviewHash'] == expected, 'fresh_registration_review_hash_required')
    BASE.mkdir(mode=0o700); s.sync(BASE.parent)
    s.save(BASE / 'before.json', value)
    s.save(BASE / 'rehearsal-intent.json', {'reviewHash': expected, 'bootId': s.boot()})
    result = official(h, 'rehearse', value['official']['reviewHash'])
    need(official(h, 'review') == value['official'], 'rehearsal_catalog_must_remain_exact')
    need(binding(s, h, op, ack) == value['binding'], 'source_changed_during_rehearsal')
    output = {'format': FORMAT, 'rehearsed': True, 'reviewHash': expected, 'official': result,
              'catalogUnchanged': True, 'databaseCommitted': False}
    s.save(BASE / 'rehearsed.json', output)
    return output


def acknowledge(s, h, op, ack, value, result, reconciled=False):
    need(binding(s, h, op, ack) == value['binding'], 'source_changed_before_registration_ack')
    check = official(h, 'reconcile', value['official']['reviewHash'])
    need(check['registered'] is True, 'exact_candidate_registration_required')
    output = {'format': FORMAT, 'registered': True, 'reviewHash': value['reviewHash'],
              'releaseId': RELEASE_ID, 'schema': op['schema'], 'buildId': op['buildId'],
              'manifestHash': MANIFEST_HASH, 'sourceReceiptSha256': SOURCE_ACK_SHA,
              'official': result, 'confirmed': check, 'reconciledAfterUnknownAck': reconciled,
              'activeReleaseChanged': False, 'consumersChanged': False, 'nativeDataWritten': False,
              'providerRequests': 0, 'paidAuthority': False, 'registeredCandidateRetainedOnSourceRollback': True}
    s.save(BASE / 'registered.json', output)
    return output


def commit(s, h, op, ack, expected):
    value = before(s, h, op, ack, expected)
    rehearsal = s.document(BASE / 'rehearsed.json')
    need(rehearsal['rehearsed'] is True and rehearsal['reviewHash'] == expected and rehearsal['catalogUnchanged'] is True,
         'successful_exact_rollback_rehearsal_required')
    need(not any((BASE / name).exists() for name in ['commit-intent.json', 'registered.json', 'failed.json']),
         'one_registration_commit_attempt_only')
    need(official(h, 'review') == value['official'], 'catalog_changed_before_registration')
    s.save(BASE / 'commit-intent.json', {'reviewHash': expected, 'officialReviewHash': value['official']['reviewHash'],
                                     'bootId': s.boot(), 'automaticRetryAllowed': False})
    try:
        return acknowledge(s, h, op, ack, value, official(h, 'commit', value['official']['reviewHash']))
    except BaseException:
        s.save(BASE / 'failed.json', {'format': FORMAT, 'reviewHash': expected, 'commitOutcomeMayBeUnknown': True,
                                    'automaticRetryAllowed': False, 'nextAction': 'readonly_reconcile_only'})
        raise


def reconcile(s, h, op, ack, receipt_sha):
    # SIGKILL may leave only the fsynced intent, after PostgreSQL committed.
    # Authenticate that intent directly; a caught-error marker is optional.
    intent = s.document(BASE / 'commit-intent.json')
    need(not (BASE / 'registered.json').exists(), 'owned_unknown_commit_ack_required')
    if receipt_sha != sha(s.protected(BASE / 'commit-intent.json')):
        failure = s.document(BASE / 'failed.json', receipt_sha)
        need(failure['commitOutcomeMayBeUnknown'] is True and failure['reviewHash'] == intent['reviewHash'],
             'owned_failure_or_durable_commit_intent_required')
    value = before(s, h, op, ack, intent['reviewHash'])
    need(intent['reviewHash'] == value['reviewHash'] and intent['officialReviewHash'] == value['official']['reviewHash'] and
         intent['bootId'] == s.boot(), 'same_owned_commit_attempt_required')
    result = official(h, 'reconcile', value['official']['reviewHash'])
    return acknowledge(s, h, op, ack, value, result, True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--rehearse'); group.add_argument('--commit'); group.add_argument('--reconcile')
    args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_production_owner_required')
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(RuntimeError('bounded_registration_expired')))
    signal.alarm(150)
    s, h, op, ack = load()
    with s.transition_lock():
        fn, expected = (rehearse, args.rehearse) if args.rehearse else (commit, args.commit) if args.commit else (reconcile, args.reconcile) if args.reconcile else (review, None)
        value = fn(s, h, op, ack, *([expected] if expected else []))
        print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False}))
        raise SystemExit(1)
