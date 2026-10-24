#!/usr/bin/env python3
"""Finite cache selection after acknowledged native publication/three readers.

The frozen c54 cache preparer stays unchanged. This separately pinned owner
consumes the exact external cutover manifest, never its unfinished old finish
hook. Default is read-only; unknown starts/stops are only inspected, not resent.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import time
import types

FORMAT = 'yunipals-ypal-cache-finish-v2'
BASE = Path('/var/backups/yunipals-ypal-native-cache-finish-v2-20261024')
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
MANIFEST = OPS / 'ypal-native-cutover-v1.manifest.json'


def need(value, code):
    if not value: raise RuntimeError(code)
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(value): return hashlib.sha256(value).hexdigest()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def sync(path):
    fd = os.open(path, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
def save(name, value):
    need('/' not in name and name.endswith('.json'), 'fixed_cache_finish_journal_name_required')
    raw = encoded(value); fd = os.open(BASE / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync(BASE); return sha(raw)


def load(manifest_sha):
    # Validate the protected manifest before compiling even the first helper.
    for item in [MANIFEST, *MANIFEST.parents]:
        st = item.lstat(); need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
                               'protected_exact_cutover_manifest_required')
    raw = MANIFEST.read_bytes(); need(sha(raw) == manifest_sha and len(raw) <= 100000, 'actual_cutover_manifest_pin_required')
    value = json.loads(raw); name = 'ypal-native-cutover-v1.py'; path = OPS / name
    st = path.lstat(); need(stat.S_ISREG(st.st_mode) and st.st_uid == st.st_gid == 0 and st.st_nlink == 1 and not st.st_mode & 0o022,
                           'protected_root_cutover_owner_required')
    source = path.read_bytes(); need(sha(source) == value['files'][name] and len(source) <= 180000, 'exact_manifest_bound_root_cutover_owner_required')
    root = types.ModuleType('manifest_bound_cutover_owner'); root.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), root.__dict__)
    proof = root.load_proof(manifest_sha)
    need(value['files'][Path(__file__).name] == sha(root.public_input(Path(__file__).absolute())), 'invoking_cache_finish_owner_must_be_manifest_bound')
    return root, proof


def context(root, proof, cutover_sha, forward=True):
    need(proof.is_pin(cutover_sha), 'actual_explicit_completed_cutover_pin_required')
    if forward: root.validate_current(cutover_sha, proof.sha(proof.protected(MANIFEST)))
    op = root.operation(proof); c = root.current_context(proof, op)
    receipt = root.document(root.BASE / 'result.json', cutover_sha)
    need(receipt['completed'] is True and receipt['operationSha256'] == sha(root.public_input(root.BASE / 'operation.json')) and
         receipt['sourceManifestSha256'] == c.inputs['sourceManifestSha256'], 'same_owned_complete_cutover_receipt_required')
    return c, op, receipt


def before(c):
    value = c.cache.document(c.cache.BASE / 'before.json')
    c.cache.owned(c.host)
    return value['binding']


def own_actor(c, started):
    value = c.host.actor(True)
    need(value['main'] == started['main'] and value['unit']['InvocationID'] == started['unit']['InvocationID'],
         'same_acknowledged_native_cache_invocation_required')
    return value


def review(root, proof, cutover_sha):
    c, op, receipt = context(root, proof, cutover_sha)
    need(not os.path.lexists(BASE), 'fresh_separate_cache_finish_operation_required')
    c.scope(True); c.cache.stopped(c.host); c.generation_terminal()
    binding = {'format': FORMAT, 'operatorSha256': sha(root.public_input(Path(__file__).absolute())), 'bootId': boot(),
        'sourceManifestSha256': c.inputs['sourceManifestSha256'], 'cutoverSha256': cutover_sha,
        'operationSha256': sha(root.public_input(root.BASE / 'operation.json')), 'cachePreparedSha256': c.inputs['cachePreparedSha256'],
        'generationId': receipt['generationId'], 'cacheOriginalProducerSha256': proof.CACHE_SHA,
        'oldCacheStoppedSha256': sha(root.public_input(c.cache.BASE / 'stopped.json')), 'catalogScope': c.scope(True),
        'originalCacheBoot': before(c)['boot'], 'recurringGenerationMayStart': False}
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'databaseWrites': 0, 'serviceActions': 0}


def operation(root):
    value = root.document(BASE / 'operation.json')
    need(value['binding']['format'] == FORMAT and value['binding']['bootId'] == boot() and value['reviewHash'] == sha(encoded(value['binding'])) and
         value['binding']['operatorSha256'] == sha(root.public_input(Path(__file__).absolute())), 'same_exact_separate_cache_finish_operation_required')
    return value


def capacity(c):
    row = c.query("SELECT jsonb_build_object('max',current_setting('max_connections')::integer,'reserved',current_setting('superuser_reserved_connections')::integer,'total',(SELECT count(*)FROM pg_stat_activity))")
    # Retain the original worker's one offchain pool; no limit or credential is
    # changed. Reserve its full default12 plus two inspection connections.
    need(row['total'] + 14 <= row['max'] - row['reserved'], 'fresh_global_room_for_retained_cache_pool_and_inspection_required')


def start(root, proof, cutover_sha, expected):
    checked = review(root, proof, cutover_sha); need(checked['reviewHash'] == expected, 'exact_fresh_cache_finish_review_required')
    BASE.mkdir(mode=0o700); sync(BASE.parent); save('operation.json', checked)
    c, op, receipt = context(root, proof, cutover_sha)
    c.cache.publish_drop(c.host)
    save('reload-intent.json', {'bootId': boot(), 'dropIdentity': c.cache.inode(c.cache.DROP)})
    c.cache.manager('daemon-reload'); state = c.cache.loaded(c.host, True); save('reload-result.json', {'loaded': True})
    c.cache.stopped(c.host); c.scope(True); capacity(c)
    intent = {'bootId': boot(), 'previousInvocation': state['InvocationID'], 'beforeState': state,
        'minimumStartTicks': time.monotonic_ns() * os.sysconf('SC_CLK_TCK') // 1000000000,
        'cutoverSha256': cutover_sha, 'dropIdentity': c.cache.inode(c.cache.DROP)}
    save('start-intent.json', intent)
    need(c.cache.loaded(c.host, True) == state, 'cache_changed_after_fsynced_native_start_intent')
    c.cache.manager('start'); actor = c.host.actor(True)
    need(actor['main']['startTicks'] >= intent['minimumStartTicks'] and actor['unit']['InvocationID'] != state['InvocationID'], 'fresh_owned_cache_start_required')
    save('started.json', {'actor': actor, 'intentSha256': sha(root.public_input(BASE / 'start-intent.json')), 'managerActionRepeated': False})
    return {'format': FORMAT, 'started': True, 'accepted': False, 'explicitFreshnessAcceptanceRequired': True, 'recurringGenerationStarted': False}


def reconcile_start(root, proof):
    saved = operation(root); c, _, _ = context(root, proof, saved['binding']['cutoverSha256'])
    need(not (BASE / 'started.json').exists(), 'cache_start_already_acknowledged')
    intent = root.document(BASE / 'start-intent.json'); actor = c.host.actor(True)
    need(intent['bootId'] == boot() and intent['cutoverSha256'] == saved['binding']['cutoverSha256'] and
         c.cache.inode(c.cache.DROP) == intent['dropIdentity'] and actor['main']['startTicks'] >= intent['minimumStartTicks'] and
         actor['unit']['InvocationID'] != intent['previousInvocation'], 'same_actual_owned_cache_start_without_repeat_required')
    save('started.json', {'actor': actor, 'intentSha256': sha(root.public_input(BASE / 'start-intent.json')), 'reconciled': True, 'managerActionRepeated': False})
    return {'format': FORMAT, 'started': True, 'reconciled': True, 'serviceActions': 0}


def acceptance_review(root, proof):
    saved = operation(root); c, _, receipt = context(root, proof, saved['binding']['cutoverSha256'])
    need(not (BASE / 'inverse-stop-intent.json').exists(), 'uninversed_native_cache_finish_required')
    started = root.document(BASE / 'started.json')['actor']; actor = own_actor(c, started)
    fresh = c.cache.sql_child(c.host, 'freshness', generation=receipt['generationId'])
    need(fresh['collections'] == [{'collection': name, 'fresh': True} for name in ['ethereum', 'base', 'polygon', 'bnb']],
         'all_four_actual_official_native_cache_freshness_proofs_required')
    c.scope(True); c.generation_terminal(); own_actor(c, actor)
    value = {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(root.public_input(BASE / 'operation.json')),
        'cutoverSha256': saved['binding']['cutoverSha256'], 'actor': actor, 'freshness': fresh,
        'scope': c.scope(True), 'generationId': receipt['generationId']}
    return {'binding': value, 'reviewHash': sha(encoded(value)), 'databaseWrites': 0, 'serviceActions': 0}


def accept(root, proof, expected):
    checked = acceptance_review(root, proof); need(checked['reviewHash'] == expected, 'exact_current_cache_freshness_review_required')
    saved = operation(root); c, op, receipt = context(root, proof, saved['binding']['cutoverSha256']); started = root.document(BASE / 'started.json')['actor']
    for name in proof.PEERS:
        root.positive_reader(c, op, name, root.reader_descriptor(op, name), time.monotonic() + 90,
                             lambda n=name: root.owned_reader(c, op, n))
    own_actor(c, started); c.scope(True); c.generation_terminal()
    identity = before(c)['boot']; parked = c.cache.BASE / 'original-boot-link'; path = c.cache.BOOT
    if not (BASE / 'boot-enable-intent.json').exists():
        need(not os.path.lexists(path) and c.cache.inode(parked, True) == identity, 'same_owned_cache_boot_inode_before_enable')
        save('boot-enable-intent.json', identity)
    need(root.document(BASE / 'boot-enable-intent.json') == identity, 'same_owned_cache_boot_enable_intent')
    if not os.path.lexists(path):
        need(c.cache.inode(parked, True) == identity, 'exact_original_cache_boot_inode_required'); os.rename(parked, path); sync(path.parent); sync(parked.parent)
    need(c.cache.inode(path, True) == identity and not os.path.lexists(parked), 'only_same_original_cache_boot_can_be_enabled')
    if not (BASE / 'boot-reload-result.json').exists():
        need(not (BASE / 'boot-reload-intent.json').exists(), 'unknown_cache_boot_reload_requires_explicit_reconcile')
        save('boot-reload-intent.json', {'bootId': boot()}); c.cache.manager('daemon-reload'); save('boot-reload-result.json', {'acknowledged': True})
    actor = own_actor(c, started)
    need(actor['unit']['UnitFileState'] == 'enabled' and actor['unit']['WantedBy'] == 'multi-user.target', 'owned_cache_boot_must_be_enabled')
    result = {'format': FORMAT, 'completed': True, 'operatorSha256': saved['binding']['operatorSha256'], 'bootId': boot(),
        'operationSha256': sha(root.public_input(BASE / 'operation.json')), 'sourceManifestSha256': c.inputs['sourceManifestSha256'],
        'cutoverSha256': saved['binding']['cutoverSha256'], 'cachePreparedSha256': c.inputs['cachePreparedSha256'],
        'generationId': receipt['generationId'], 'actor': actor, 'boot': identity, 'freshness': checked['binding']['freshness'],
        'recurringGenerationStarted': False, 'allFourFreshAndThreeReadersServing': True, 'originalFrozenFinishCalled': False}
    pin = save('result.json', result)
    return {'format': FORMAT, 'completed': True, 'resultSha256': pin, 'generationId': receipt['generationId']}


def drain_for_inverse(c):
    """Called only by the manifest-bound coordinator's explicit inverse."""
    if not BASE.exists():
        c.cache.stopped(c.host); return {'nativeCacheNeverStarted': True}
    value = c.proof.document(BASE / 'operation.json')
    need(value['binding']['format'] == FORMAT and value['binding']['bootId'] == boot() and value['reviewHash'] == sha(encoded(value['binding'])) and
         value['binding']['sourceManifestSha256'] == c.inputs['sourceManifestSha256'] and
         value['binding']['operatorSha256'] == c.manifest['files'][Path(__file__).name], 'same_owned_cache_finish_before_inverse_required')
    old = before(c); parked = c.cache.BASE / 'original-boot-link'
    if os.path.lexists(c.cache.BOOT):
        need(c.cache.inode(c.cache.BOOT, True) == old['boot'] and not os.path.lexists(parked), 'only_owned_native_cache_boot_may_be_disabled')
        if not (BASE / 'inverse-boot-disable-intent.json').exists(): save('inverse-boot-disable-intent.json', old['boot'])
        need(c.proof.document(BASE / 'inverse-boot-disable-intent.json') == old['boot'], 'same_cache_inverse_boot_intent_required')
        os.rename(c.cache.BOOT, parked); sync(c.cache.BOOT.parent); sync(parked.parent)
        need(not (BASE / 'inverse-boot-reload-intent.json').exists(), 'unknown_cache_inverse_boot_reload_requires_explicit_recovery')
        save('inverse-boot-reload-intent.json', {'bootId': boot()}); c.cache.manager('daemon-reload')
    if (BASE / 'inverse-boot-reload-intent.json').exists() and not (BASE / 'inverse-boot-reload-result.json').exists():
        state = c.host.state()
        need(state['UnitFileState'] == 'disabled' and state['WantedBy'] == '' and state['Job'] == '',
             'unknown_cache_boot_disable_reload_requires_explicit_recovery_not_service_retry')
        save('inverse-boot-reload-result.json', {'configurationObserved': True})
    if not (BASE / 'start-intent.json').exists(): c.cache.stopped(c.host); return {'nativeCacheNeverStarted': True}
    need((BASE / 'started.json').exists(), 'unknown_cache_start_must_be_reconciled_before_inverse')
    actor = c.proof.document(BASE / 'started.json')['actor']
    path = BASE / 'inverse-stop-intent.json'
    if not path.exists():
        state = c.host.state(); already_terminal = state['MainPID'] == '0'
        if already_terminal:
            c.cache.loaded(c.host, True); c.proof.terminal(state, actor['processes'])
            need(state['InvocationID'] == actor['unit']['InvocationID'], 'same_acknowledged_failed_cache_invocation_required')
            now = actor; sessions = c.terminal_sessions(actor, '10')
        else:
            now = own_actor(c, actor); sessions = c.host.sessions(now)
            need(own_actor(c, actor) == now, 'cache_changed_during_fresh_kernel_session_capture')
        save(path.name, {'bootId': boot(), 'actor': now, 'sessions': sessions, 'operationSha256': sha(c.proof.protected(BASE / 'operation.json'))})
        if already_terminal:
            need(c.host.state() == state, 'failed_cache_changed_after_fsynced_terminal_proof'); c.host.terminal(now, sessions)
        else:
            need(own_actor(c, actor) == now, 'cache_changed_after_fsynced_inverse_stop_intent'); c.cache.manager('stop')
    intent = c.proof.document(path)
    need(intent['bootId'] == boot() and intent['operationSha256'] == sha(c.proof.protected(BASE / 'operation.json')), 'same_cache_inverse_stop_intent_required')
    c.host.terminal(intent['actor'], intent['sessions'])
    if not (BASE / 'inverse-stopped.json').exists(): save('inverse-stopped.json', {'stopped': True, 'intentSha256': sha(c.proof.protected(path))})
    return {'nativeCacheStopped': True, 'serviceStopRepeated': False}


def restore_old(c, root, op):
    """Only after global103 +metadata RPC recovery; preserve original config."""
    c.inverse_scope(False)
    if not (root.BASE / 'cache-old-start-intent.json').exists(): c.cache.stopped(c.host)
    need(root.document(root.BASE / 'inverse-global-restored.json')['currentGeneration'] == '103' and
         root.document(root.BASE / 'metadata-restored.json')['actualRPCModeAndOwnedOriginalWriter'] is True, 'global_and_metadata_recovery_must_precede_old_cache_start')
    if os.path.lexists(c.cache.DROP):
        expected = c.cache.document(c.cache.BASE / 'drop-published.json')
        if not (root.BASE / 'cache-drop-unlink-intent.json').exists(): root.save('cache-drop-unlink-intent.json', expected)
        need(root.document(root.BASE / 'cache-drop-unlink-intent.json') == expected and c.cache.inode(c.cache.DROP) == expected,
             'only_exact_acknowledged_cache_drop_inode_may_be_removed')
        c.cache.DROP.unlink(); sync(c.cache.DROP.parent)
    if not (root.BASE / 'cache-old-load-result.json').exists():
        need(not (root.BASE / 'cache-old-load-intent.json').exists(), 'unknown_cache_old_definition_reload_requires_explicit_reconcile')
        root.save('cache-old-load-intent.json', {'bootId': boot()}); c.cache.manager('daemon-reload'); c.cache.loaded(c.host, False)
        root.save('cache-old-load-result.json', {'originalDefinitionsLoaded': True})
    intent_path = root.BASE / 'cache-old-start-intent.json'; state = c.host.state()
    if state['MainPID'] == '0':
        need(not intent_path.exists(), 'unknown_old_cache_start_cannot_be_repeated')
        c.cache.stopped(c.host); c.inverse_scope(False)
        root.save(intent_path.name, {'bootId': boot(), 'before': state, 'minimumStartTicks': time.monotonic_ns() * os.sysconf('SC_CLK_TCK') // 1000000000})
        need(c.host.state() == state, 'old_cache_changed_after_restore_start_intent'); c.cache.manager('start')
    actor = c.host.actor(False, False); intent = root.document(intent_path)
    need(intent['bootId'] == boot() and actor['main']['startTicks'] >= intent['minimumStartTicks'] and
         actor['unit']['InvocationID'] != intent['before']['InvocationID'], 'actual_owned_original_cache_resume_required')
    started_path = root.BASE / 'cache-old-started.json'
    if started_path.exists():
        acknowledged = root.document(started_path)
        need(acknowledged['actor']['main'] == actor['main'] and acknowledged['actor']['unit']['InvocationID'] == actor['unit']['InvocationID'] and
             acknowledged['intentSha256'] == sha(root.public_input(intent_path)), 'same_acknowledged_original_cache_resume_required')
    else: root.save(started_path.name, {'actor': actor, 'intentSha256': sha(root.public_input(intent_path)), 'managerActionRepeated': False})
    old = before(c); parked = c.cache.BASE / 'original-boot-link'
    if not (root.BASE / 'cache-old-boot-restore-intent.json').exists():
        need(c.cache.inode(parked, True) == old['boot'] and not os.path.lexists(c.cache.BOOT), 'same_original_cache_boot_before_restore')
        root.save('cache-old-boot-restore-intent.json', old['boot'])
    if not os.path.lexists(c.cache.BOOT):
        need(c.cache.inode(parked, True) == old['boot'], 'same_original_cache_boot_inode_before_restore')
        os.rename(parked, c.cache.BOOT); sync(parked.parent); sync(c.cache.BOOT.parent)
    need(c.cache.inode(c.cache.BOOT, True) == old['boot'], 'exact_original_cache_boot_restored')
    if not (root.BASE / 'cache-old-enable-result.json').exists():
        need(not (root.BASE / 'cache-old-enable-intent.json').exists(), 'unknown_old_cache_enable_reload_requires_explicit_reconcile')
        root.save('cache-old-enable-intent.json', {'bootId': boot()}); c.cache.manager('daemon-reload'); root.save('cache-old-enable-result.json', {'acknowledged': True})
    current = c.host.actor(False, False)
    need(current['main'] == actor['main'] and current['unit']['InvocationID'] == actor['unit']['InvocationID'], 'same_restored_cache_actor_after_boot_enable_required')
    result = {'format': FORMAT, 'restored': True, 'bootId': boot(), 'oldCacheActor': current, 'oldBoot': old['boot'],
        'globalGeneration': '103', 'read143GraphPreserved': True, 'sameOldPIDClaimed': False}
    restored_path = root.BASE / 'cache-restored.json'
    if not restored_path.exists(): root.save(restored_path.name, result)
    else: need(root.document(restored_path) == result, 'same_acknowledged_original_cache_restoration_required')
    return result


def validate_cache_leaf(result_sha, source_manifest_sha, feature_refs=None):
    """Facts for a NEW managed source owner, never old-source authority."""
    root, proof = load(source_manifest_sha); need(proof.is_pin(result_sha), 'actual_explicit_cache_finish_result_pin_required')
    saved = operation(root)
    result = root.document(BASE / 'result.json', result_sha)
    need(result['format'] == FORMAT and result['completed'] is True and result['bootId'] == boot() and
         result['operatorSha256'] == saved['binding']['operatorSha256'] and
         result['operationSha256'] == sha(root.public_input(BASE / 'operation.json')) and
         result['sourceManifestSha256'] == source_manifest_sha and not (BASE / 'inverse-stop-intent.json').exists(),
         'exact_uninversed_owned_native_cache_leaf_required')
    readers = root.validate_reader_leaf(result['cutoverSha256'], source_manifest_sha, feature_refs)
    op = root.operation(proof); c = root.reader_leaf_context(proof, op, feature_refs)
    actor = own_actor(c, root.document(BASE / 'started.json')['actor'])
    need(actor == result['actor'] and c.cache.inode(c.cache.BOOT, True) == result['boot'], 'same_acknowledged_cache_worker_and_boot_inode_required')
    fresh = c.cache.sql_child(c.host, 'freshness', generation=result['generationId'])
    need(fresh['collections'] == [{'collection': name, 'fresh': True} for name in ['ethereum', 'base', 'polygon', 'bnb']],
         'actual_current_official_four_collection_cache_freshness_required')
    roles = c.scope(True); need(own_actor(c, actor) == actor, 'cache_actor_changed_during_phase_leaf')
    return {'format': 'yunipals-ypal-native-cache-phase-leaf-v1', 'validated': True, 'receiptSha256': result_sha,
        'operatorSha256': saved['binding']['operatorSha256'], 'sourceManifestSha256': source_manifest_sha,
        'cutoverSha256': result['cutoverSha256'], 'generationId': result['generationId'], 'cacheActor': actor,
        'cacheBoot': result['boot'], 'currentFourCollectionsFresh': True, 'readersLeafSha256': sha(encoded(readers)),
        'actualCatalogSha256': roles['actualCatalogSha256'], 'completeCacheGuardCatalogQualified': True,
        'sourceActorQualified': False, 'sourceReadinessQualified': False, 'observerAuthorityQualified': False,
        'financialAuthorityQualified': False, 'fullGlobalRoleGraphQualified': False, 'originalWholeValidatorsPassed': False,
        'laterGenerationLineageOr24HourRefreshQualified': False, 'databaseWrites': 0, 'serviceActions': 0}


def reload_review(root, proof, phase):
    need(phase in {'native-load', 'native-enable', 'inverse-disable'}, 'fixed_cache_configuration_recovery_phase_required')
    saved = operation(root); c, _, _ = context(root, proof, saved['binding']['cutoverSha256'], False)
    c.inverse_scope(not (root.BASE / 'cache-inverse-catalog.json').exists()); c.host.private()
    native, enabled = True, phase == 'native-enable'; identity = before(c)['boot']
    need(c.cache.inode(c.cache.DROP) == c.cache.document(c.cache.BASE / 'drop-published.json'), 'same_owned_cache_drop_before_reload_recovery')
    if enabled: need(c.cache.inode(c.cache.BOOT, True) == identity, 'same_owned_cache_boot_for_enable_recovery')
    else: need(not os.path.lexists(c.cache.BOOT) and c.cache.inode(c.cache.BASE / 'original-boot-link', True) == identity, 'same_parked_cache_boot_for_reload_recovery')
    state = c.host.state(); need(state['Job'] == '' and state['ControlPID'] == '0', 'no_pending_cache_manager_job_before_reload_recovery')
    if state['MainPID'] != '0': own_actor(c, root.document(BASE / 'started.json')['actor'])
    else: c.cache.stopped(c.host)
    intent_name = {'native-load': 'reload-intent.json', 'native-enable': 'boot-reload-intent.json', 'inverse-disable': 'inverse-boot-reload-intent.json'}[phase]
    need((BASE / intent_name).exists(), 'actual_owned_cache_reload_intent_required')
    pending = {**before(c)['originalActor']['definitions'], str(c.cache.DROP): sha(root.public_input(c.cache.DROP))}
    pending_proof = root.pending_definitions(c.cache.UNIT, pending)
    binding = {'format': FORMAT, 'bootId': boot(), 'operationSha256': sha(root.public_input(BASE / 'operation.json')), 'phase': phase,
        'originalIntentSha256': sha(root.public_input(BASE / intent_name)), 'state': state, 'drop': c.cache.inode(c.cache.DROP), 'bootEnabledExpected': enabled,
        'pendingDefinitions': pending_proof}
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'databaseWrites': 0, 'serviceActions': 0}


def recover_reload(root, proof, phase, expected, execute=False):
    checked = reload_review(root, proof, phase); need(checked['reviewHash'] == expected, 'exact_fresh_cache_reload_recovery_review_required')
    saved = operation(root); c, _, _ = context(root, proof, saved['binding']['cutoverSha256'], False)
    enabled = phase == 'native-enable'
    def loaded():
        state = c.cache.loaded(c.host, True)
        need(state['UnitFileState'] == ('enabled' if enabled else 'disabled') and state['WantedBy'] == ('multi-user.target' if enabled else ''),
             'actual_cache_activation_configuration_not_yet_loaded')
    if execute:
        number = sum(1 for p in BASE.glob('reload-recovery-' + phase + '-*-intent.json')) + 1
        need(number <= 3, 'bounded_explicit_cache_reload_recovery_count_exceeded')
        name = 'reload-recovery-' + phase + '-' + str(number)
        need(not (BASE / (name + '-intent.json')).exists(), 'fresh_explicit_cache_reload_recovery_intent_required')
        save(name + '-intent.json', checked)
        need(reload_review(root, proof, phase) == checked, 'cache_configuration_changed_after_explicit_reload_recovery_intent')
        c.cache.manager('daemon-reload')
    loaded()
    primary = {'native-load': 'reload-result.json', 'native-enable': 'boot-reload-result.json', 'inverse-disable': 'inverse-boot-reload-result.json'}[phase]
    if not (BASE / primary).exists(): save(primary, {'reconciled': True, 'configurationLoaded': True, 'managerRequestRepeatedOnlyByExplicitReloadReview': execute})
    return {'format': FORMAT, 'reloadObserved': True, 'serviceStartOrStopActions': 0, 'databaseWrites': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--source-manifest-sha', required=True)
    parser.add_argument('--cutover-sha'); group = parser.add_mutually_exclusive_group()
    parser.add_argument('--reload-phase', choices=['native-load', 'native-enable', 'inverse-disable'])
    group.add_argument('--start'); group.add_argument('--accept'); group.add_argument('--accept-review', action='store_true')
    group.add_argument('--reconcile-start', action='store_true'); group.add_argument('--reload-review', action='store_true')
    group.add_argument('--reload-config'); group.add_argument('--reconcile-reload'); args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_main_host_required')
    root, proof = load(args.source_manifest_sha)
    generation_owner = proof.module('ypal-native-generation-v1.py', proof.DEPENDENCIES['ypal-native-generation-v1.py'])
    with root.transition_lock(), generation_owner.lock():
        if args.reload_review: value = reload_review(root, proof, args.reload_phase)
        elif args.reload_config: value = recover_reload(root, proof, args.reload_phase, args.reload_config, True)
        elif args.reconcile_reload: value = recover_reload(root, proof, args.reload_phase, args.reconcile_reload)
        elif args.reconcile_start: value = reconcile_start(root, proof)
        elif args.accept_review: value = acceptance_review(root, proof)
        elif args.accept: value = accept(root, proof, args.accept)
        elif args.start: value = start(root, proof, args.cutover_sha, args.start)
        else: value = review(root, proof, args.cutover_sha)
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__, 'privateDiagnosticsWithheld': True, 'automaticRetryAllowed': False}))
        raise SystemExit(1)
