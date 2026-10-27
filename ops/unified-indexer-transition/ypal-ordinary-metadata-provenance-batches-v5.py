#!/usr/bin/env python3
"""Finite provenance batches using the genuine selected V5 metadata owner."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import types

FORMAT = 'yunipals-ypal-ordinary-metadata-provenance-batches-v5'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
INPUT = Path('/var/backups/yunipals-ypal-ordinary-metadata-provenance-input-v5-20261025/input.json')
BASE = Path('/var/backups/yunipals-ypal-ordinary-metadata-provenance-batches-v5-20261025')
COMMON = OPS / 'ypal-ordinary-consumer-handover-v5.py'
COMMON_SHA = 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'
OWNER = OPS / 'ypal-ordinary-metadata-handover-v5.py'
OWNER_SHA = '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f'
GUARD = OPS / 'ypal-ordinary-source-authority-v1.py'
GUARD_SHA = '730d678a46777a8c86ec0d1350ba6bc7d6854614fe381e39e98a9c56bfdce7e1'
COMPLETION = OPS / 'ypal-ordinary-metadata-select-completion-v1.py'
COMPLETION_SHA = '9a1dd6344bacac8dfcad75cc67f769c0ba46aec9db6f752f2b672cde9a59b8b5'
METADATA_INPUT_SHA = 'bc618a8559a94d4a34d5a6da91c98d2241161f2edd91e540857a5089e5bbe306'
OPERATION_SHA = '8aa248a21585cfffd2dc936968f214a2b007b3460f866e2d1346c1432d42a70d'
INDEX_DEFINITION = "CREATE INDEX canonical_event__block_number_transaction_index_log_index_index ON unified_ypal_20261023_v1.canonical_event USING btree ((((args)::jsonb ->> 'tokenId'::text)), block_number, transaction_index, log_index) WHERE (source_id = 'metadata:base'::text)"
INDEX_SQL = """SELECT jsonb_build_object('databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
'tableOid',i.indrelid::text,'indexOid',i.indexrelid::text,'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
'method',am.amname,'keys',i.indnkeyatts,'definition',pg_get_indexdef(i.indexrelid))
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
WHERE i.indrelid=75963666 AND i.indexrelid=77273352"""
INDEX_EXPECTED = {'databaseOid': '17584', 'tableOid': '75963666', 'indexOid': '77273352',
                  'valid': True, 'ready': True, 'live': True, 'method': 'btree', 'keys': 4,
                  'definition': INDEX_DEFINITION}
CHAIN = ('operation.json', 'drained.json', 'adopt-intent.json', 'adopt-child.json', 'adopt-result.json',
         'adopted.json', 'native-drop-intent.json', 'native-drop-created.json', 'native-start-intent.json',
         'native-started.json', 'native-observed.json', 'boot-publish-intent.json', 'selected.json')


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) and value != '0' * 64


def protected(path, digest=None, private=False):
    path = Path(path)
    for parent in [*path.parents, path]:
        info = parent.lstat()
        need(info.st_uid == info.st_gid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022,
             'protected_provenance_runner_path_required')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
         (not private or stat.S_IMODE(before.st_mode) == 0o600), 'protected_single_link_runner_file_required')
    raw = path.read_bytes()
    after = path.lstat()
    keys = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    need(len(raw) <= 2000000 and all(getattr(before, key) == getattr(after, key) for key in keys) and
         (digest is None or sha(raw) == digest), 'exact_provenance_runner_file_required')
    return raw


def module(path, digest):
    raw = protected(path, digest)
    value = types.ModuleType(path.stem)
    value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    need(protected(path, digest) == raw, 'runner_dependency_changed_during_import')
    return value


def config(value):
    need(type(value) is dict and set(value) == {'format', 'metadataInputSha256', 'metadataOperationSha256',
         'selectedReceiptSha256', 'selectionCompletionSha256', 'firstIndex', 'maxBatches', 'maxSeconds'} and value['format'] == FORMAT + '-input',
         'exact_actual_provenance_runner_input_required')
    need(value['metadataInputSha256'] == METADATA_INPUT_SHA and value['metadataOperationSha256'] == OPERATION_SHA and
         pin(value['selectedReceiptSha256']) and pin(value['selectionCompletionSha256']), 'actual_selected_original_metadata_operation_required')
    need(type(value['firstIndex']) is type(value['maxBatches']) is type(value['maxSeconds']) is int and
         0 <= value['firstIndex'] < 128 and 1 <= value['maxBatches'] <= 128 - value['firstIndex'] and
         720 <= value['maxSeconds'] <= 3600, 'bounded_original_5000_row_128_index_run_required')
    return value


def source_files():
    return {path.name: sha(protected(path, digest)) for path, digest in
            [(COMMON, COMMON_SHA), (OWNER, OWNER_SHA), (GUARD, GUARD_SHA), (COMPLETION, COMPLETION_SHA)]}


def construct(value):
    common = module(COMMON, COMMON_SHA)
    module(OWNER, OWNER_SHA)  # Authenticate the immutable genuine operation producer as well as its common body.
    initial = common.load_input(value['metadataInputSha256'])
    guard = module(GUARD, GUARD_SHA).Authority(initial['ordinaryRuntime']['resultSha256'],
        initial['ordinaryRuntime']['inputSha256'], initial['readConfig'])
    n = common.metadata_namespace(initial['candidateReceiptSha256'])
    return common, initial, guard, n


def host(common, initial, guard, n, input_sha):
    guard.preflight()
    h = n.construct_context(initial['readConfig'], lambda: guard.metadata_refresh(initial['readConfig']),
        primitives=common.metadata_primitives(initial['candidateInputSha256']),
        admission_ref=common.admission_reference(initial['readConfig']))
    h.execution_context = {'inputSha256': input_sha, 'sourcesSha256': initial['sourcesSha256']}
    common.execution_context(h, h.execution_context)
    return h


def receipt(h, path, digest=None):
    raw = h.s.protected(path)
    actual = sha(raw)
    need(digest is None or digest == actual, 'same_original_provenance_receipt_required')
    return h.s.document(path, actual), actual


def selection(n, h, value):
    op = n.operation(h, value['metadataOperationSha256'])
    records = {name: receipt(h, n.BASE / name) for name in CHAIN}
    need(records['operation.json'][1] == value['metadataOperationSha256'] and
         records['selected.json'][1] == value['selectedReceiptSha256'], 'actual_operation_and_selected_receipts_required')
    selected = records['selected.json'][0]
    need(set(selected) == {'nativeActor', 'boot', 'selected', 'provenanceComplete'} and
         selected['selected'] is True and selected['provenanceComplete'] is False,
         'genuine_original_selected_metadata_receipt_required')
    start, started = records['native-start-intent.json'][0], records['native-started.json'][0]
    need(start['bootId'] == h.s.boot() == op['bootId'] and type(start['monotonicUs']) is int and
         int(started['unit']['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'],
         'actual_metadata_start_epoch_must_follow_original_intent')
    need(selected['nativeActor'] == {**started, 'unit': {**started['unit'], 'UnitFileState': 'enabled', 'WantedBy': 'multi-user.target'}} and
         n.link(n.BOOT) == selected['boot'] == op['oldBoot'] == records['boot-publish-intent.json'][0],
         'same_original_selected_actor_and_boot_publication_required')
    need(h.actor(op, True) == selected['nativeActor'], 'same_selected_native_metadata_actor_required')
    observed = records['native-observed.json'][0]
    need(observed['nativeWorkerFunctional'] is True and observed['elapsedSeconds'] == 20 and len(observed['samples']) == 3 and
         all(row['scan']['ingestion_mode'] == 'native' and row['probe'] is True and
             row['approval']['read_identity'] == h.meta.IDENTITY and row['approval']['state'] == 'ready' for row in observed['samples']),
         'genuine_native_metadata_acceptance_observations_required')
    adopted = records['adopted.json'][0]
    need(adopted['officialAcknowledgementPresent'] is True and adopted['result'] == records['adopt-result.json'][0] and
         adopted['result']['adopted'] is True and adopted['result']['releaseId'] == h.meta.RELEASE and
         adopted['result']['readIdentity'] == h.meta.IDENTITY and
         str(adopted['result']['legacyNextBlock']) == str(records['drained.json'][0]['scan']['next_block']) and
         records['adopt-intent.json'][0]['command'] == 'native-adopt' and records['adopt-intent.json'][0]['bootId'] == h.s.boot(),
         'actual_original_adoption_chain_required')
    need(not any(path.name.startswith('inverse') or path.name == 'restored.json' for path in n.BASE.iterdir()),
         'metadata_inverse_prefix_forbids_provenance_dispatch')
    completion = module(COMPLETION, COMPLETION_SHA)
    h._completion_base = n.BASE
    result, result_sha = receipt(h, completion.BASE / 'result.json', value['selectionCompletionSha256'])
    intent = completion.own_intent(h)
    intent_sha = sha(h.s.protected(completion.BASE / 'start-intent.json'))
    need(result == {'format': completion.FORMAT, 'operatorSha256': COMPLETION_SHA,
        'originalOperationSha256': value['metadataOperationSha256'], 'actualSelectedReceiptSha256': value['selectedReceiptSha256'],
        'ownStartIntentSha256': intent_sha, 'completed': True, 'originalFailedSelectReclassified': False,
        'originalSelectCliAcknowledgementClaimed': False} and completion.start_actor(n, h, op) == selected['nativeActor'],
        'actual_new_completion_ACK_and_same_selected_epoch_required')
    need(intent['binding']['originalOperationSha256'] == value['metadataOperationSha256'],
         'same_original_operation_in_new_selection_completion_required')
    chain = {name: item[1] for name, item in records.items()}
    chain.update(selectionCompletionSha256=result_sha, selectionCompletionStartIntentSha256=intent_sha,
                 selectionCompletionActorSha256=sha(h.s.protected(completion.BASE / 'started-actor.json'))
                 if os.path.lexists(completion.BASE / 'started-actor.json') else None)
    return op, selected, chain


def index_current(h):
    value = h.query(INDEX_SQL)
    need(value == INDEX_EXPECTED, 'actual_valid_ready_live_native_token_lookup_index_required')
    return value


def attempt_files(base, index):
    prefix = 'provenance-' + str(index)
    return sorted(path.name for path in base.iterdir() if path.name.startswith(prefix + '-') or path.name.startswith(prefix + '.'))


def prior(n, h, index):
    hashes = {}
    for number in range(index):
        name = 'provenance-' + str(number)
        observed, digest = receipt(h, n.BASE / (name + '-observed.json'))
        result, result_sha = receipt(h, n.BASE / (name + '-result.json'))
        intent, intent_sha = receipt(h, n.BASE / (name + '-intent.json'))
        need(observed['officialResult'] == result and intent['command'] == 'native-provenance' and intent['bootId'] == h.s.boot() and
             (result.get('busy') is True or type(result.get('stamped')) is int and 0 <= result['stamped'] <= 5000),
             'all_prior_original_provenance_attempts_need_actual_acknowledgement')
        hashes[name] = {'observedSha256': digest, 'resultSha256': result_sha, 'intentSha256': intent_sha}
    return hashes


def review(n, h, guard, value, input_sha):
    op, selected, chain = selection(n, h, value)
    old = prior(n, h, value['firstIndex'])
    for number in range(value['firstIndex'], value['firstIndex'] + value['maxBatches']):
        need(not attempt_files(n.BASE, number), 'existing_provenance_prefix_requires_separate_reconciliation_never_resend')
    index = index_current(h)
    guard.metadata_refresh(h.read_config)
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'inputSha256': input_sha, 'input': value, 'bootId': h.s.boot(), 'sources': source_files(),
        'metadataChain': chain, 'priorAcknowledgements': old, 'index': index,
        'sourceBindingSha256': sha(encoded(guard.binding)), 'sourceFrameSha256': sha(encoded(guard.expected))}
    return binding, op, selected


def mkdir(path):
    path.mkdir(mode=0o700)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
         'exclusive_private_runner_directory_required')
    sync(path.parent)


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save(folder, name, value):
    raw = encoded(value)
    fd = os.open(folder / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync(folder)
    return sha(raw)


def execute(n, h, guard, value, binding, op, selected, folder):
    start = time.monotonic()
    save(folder, 'intent.json', {'binding': binding, 'reviewSha256': sha(encoded(binding)), 'startedMonotonic': start,
        'automaticRetryAllowed': False, 'batchSizeLimit': 5000, 'originalIndexLimit': 128})
    results, reason = [], 'batch-limit'
    failure = None
    try:
        for number in range(value['firstIndex'], value['firstIndex'] + value['maxBatches']):
            if time.monotonic() - start > value['maxSeconds'] - 720:
                reason = 'dispatch-deadline'
                break
            need(not attempt_files(n.BASE, number), 'existing_provenance_prefix_requires_separate_reconciliation_never_resend')
            current_op, current_selected, chain = selection(n, h, value)
            need(current_op == op and current_selected == selected and chain == binding['metadataChain'],
                 'original_operation_selection_or_boot_changed_before_batch')
            index_current(h)
            guard.metadata_refresh(h.read_config)
            if time.monotonic() - start > value['maxSeconds'] - 720:
                reason = 'dispatch-deadline'
                break
            save(folder, str(number) + '-dispatch-intent.json', {'index': number, 'metadataOperationSha256': value['metadataOperationSha256'],
                'selectedReceiptSha256': value['selectedReceiptSha256'], 'sourceAuthorityFresh': True})
            # No business-body substitution: retain official child, 5000 bound,
            # canonical point checks and original exclusive journals verbatim.
            result = n.provenance(h, op, number)
            observed, observed_sha = receipt(h, n.BASE / ('provenance-' + str(number) + '-observed.json'))
            need(h.actor(op, True) == selected['nativeActor'] and n.link(n.BOOT) == selected['boot'],
                 'selected_metadata_actor_or_boot_changed_after_batch')
            guard.metadata_refresh(h.read_config)
            current_op, current_selected, chain = selection(n, h, value)
            need(current_op == op and current_selected == selected and chain == binding['metadataChain'],
                 'original_operation_or_selection_changed_after_batch')
            item = {'index': number, 'result': result, 'originalObservedSha256': observed_sha}
            save(folder, str(number) + '-observed.json', item)
            results.append(item)
            if result.get('busy') is True:
                need(observed['busy'] is True, 'genuine_busy_observation_required')
                reason = 'busy'
                break
            if result.get('complete') is True:
                need(observed['completeForCurrentPublishedArchiveBase'] is True and observed['publicationProof']['allPublishedCanonical'] is True,
                     'only_original_full_publication_proof_can_establish_completion')
                reason = 'original-publication-complete'
                break
            if result['stamped'] == 0:
                reason = 'zero-progress'
                break
        index_current(h)
    except BaseException as error:
        failure = error
    try:
        post = guard.finish()
    except BaseException as error:
        post = {'qualified': False, 'errorClass': type(error).__name__}
        if failure is None:
            failure = error
    if failure is not None:
        save(folder, 'failed.json', {'completed': False, 'errorClass': type(failure).__name__,
            'fixedCode': str(failure) if type(failure) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(failure)) else 'private_diagnostics_withheld',
            'acknowledgedBatches': results, 'postflight': post, 'automaticRetryAllowed': False})
        raise failure
    result = {'format': FORMAT, 'completed': True, 'stopReason': reason, 'acknowledgedBatches': results,
        'completeForCurrentPublishedArchiveBase': reason == 'original-publication-complete', 'postflight': post,
        'elapsedSeconds': time.monotonic() - start, 'automaticRetryAllowed': False, 'unmatchedRowsDeleted': False,
        'serviceActions': 0, 'metadataOperationSha256': value['metadataOperationSha256']}
    digest = save(folder, 'result.json', result)
    return {'format': FORMAT, 'completed': True, 'resultSha256': digest, 'acknowledgedBatchCount': len(results),
        'stamped': sum(row['result'].get('stamped', 0) for row in results), 'stopReason': reason,
        'completeForCurrentPublishedArchiveBase': result['completeForCurrentPublishedArchiveBase'], 'automaticRetryAllowed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-sha')
    parser.add_argument('--apply')
    parser.add_argument('--run-id')
    args = parser.parse_args()
    if args.input_sha is None:
        need(args.apply is None and args.run_id is None, 'actual_runner_input_required_before_review_or_effects')
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
        return
    need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_provenance_host_required')
    need(pin(args.input_sha), 'actual_runner_input_hash_required')
    value = config(json.loads(protected(INPUT, args.input_sha, private=True)))
    need(args.apply is None or pin(args.apply) and args.run_id is not None and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', args.run_id),
         'exact_review_and_exclusive_named_run_required')
    os.umask(0o077)
    common, initial, guard, n = construct(value)
    with n.lock():
        h = host(common, initial, guard, n, value['metadataInputSha256'])
        binding, op, selected = review(n, h, guard, value, args.input_sha)
        review_sha = sha(encoded(binding))
        if args.apply is None:
            guard.finish()
            print(json.dumps({'format': FORMAT, 'reviewSha256': review_sha, 'effects': False, 'binding': binding}, sort_keys=True))
            return
        need(args.apply == review_sha, 'same_actual_selected_metadata_batch_review_required')
        if not os.path.lexists(BASE):
            mkdir(BASE)
        info = BASE.lstat()
        need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == info.st_gid == 0 and
             stat.S_IMODE(info.st_mode) == 0o700, 'private_runner_root_required')
        folder = BASE / args.run_id
        mkdir(folder)
        print(json.dumps(execute(n, h, guard, value, binding, op, selected, folder), sort_keys=True))


if __name__ == '__main__':
    # Extra time permits the original bounded660s child and a genuine postflight
    # to finish. Any alarm leaves original intent/child files for reconciliation.
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_runner_unknown_outcome_do_not_retry'))
    signal.alarm(5400)
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'private_diagnostics_withheld',
            'automaticRetryAllowed': False}))
        raise SystemExit(1)
    finally:
        signal.alarm(0)
