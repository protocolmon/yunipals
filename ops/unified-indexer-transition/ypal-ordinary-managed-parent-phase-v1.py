#!/usr/bin/env python3
"""Owned parent phase facts, separate from unrelated peer preservation."""
import copy
import json
import os
from pathlib import Path

FORMAT = 'yunipals-ordinary-managed-parent-phase-v1'
PARENT = 'yunipals-indexer.service'


def need(value, code):
    if not value:raise RuntimeError(code)


def peer_projection(value):
    need(type(value) is dict and set(value) == {'freshActor', 'freshDefinitions', 'freshActivation', 'freshFrame',
         'apiFrame', 'api', 'og', 'preservationOnly', 'otherRuntimeAuthorityQualified', 'retirementQualified'} and
         value['preservationOnly'] is True and value['otherRuntimeAuthorityQualified'] is value['retirementQualified'] is False,
         'exact_actual_ordinary_current_peer_frame_required')
    result = copy.deepcopy(value); og = result['og']
    need(type(og) is dict and set(og) == {'consumers', 'currentFrames', 'legacyParent',
         'installedApplicationClosureQualified', 'retirementQualified'} and
         set(og['consumers']) == set(og['currentFrames']) == {'yunipals-api.service', 'yunipals-collector-api.service',
             'yunipals-islands-api.service', 'yunipals-metadata.service'} and
         og['installedApplicationClosureQualified'] is og['retirementQualified'] is False and
         set(og['legacyParent']) == {'frame', 'activation', 'definitions', 'preservationOnly', 'otherRuntimeAuthorityQualified'} and
         og['legacyParent']['preservationOnly'] is True and og['legacyParent']['otherRuntimeAuthorityQualified'] is False,
         'exact_four_unrelated_consumers_and_explicit_owned_parent_frame_required')
    del og['legacyParent']; og['ownedParentQualifiedSeparately'] = True
    return result


def preserved(owner, original):
    value = original(); value['retainedServingPeers'] = peer_projection(value['retainedServingPeers']); return value


def owned_intent(owner, name):
    value = owner.get(name)
    need(all(value.get(key) == item for key, item in owner.envelope().items()) and
         value.get('operationSha256') == owner.digest('operation.json'),
         'exact_same_boot_input_and_operation_parent_phase_intent_required')
    return value


def file_prefix(owner, op):
    """All original/new bytes and inodes have one genuine recorded location."""
    m = owner.m; hold = m.HOLD; system = m.SYSTEM; records = []; expected = []; file_facts = []; link_facts = []
    for index, (name, row) in enumerate(op['activations'][PARENT]['definitions'].items()):
        original = Path(name); held = hold/(PARENT+'.definition-'+str(index))
        if os.path.lexists(held):
            need(owner.get('hold-definition-'+str(index)+'-intent.json') == {'value': {
                'source': str(original), 'target': str(held), 'identity': row['identity']}},
                'actual_original_parent_definition_move_intent_required')
        records.append((row, [original, held])); expected.append(original)
    if owner.has('managed-unit-prepared.json'):
        row = owner.get('managed-unit-prepared.json')
        need(row['path'] == str(system/PARENT) and row['sha256'] == owner.f.PUBLIC['yunipals-indexer.service.example'],
             'literal_owned_managed_parent_public_unit_bytes_required')
        records.append((row, [system/PARENT, hold/'managed-unit.prepared', hold/'managed-unit.removed'])); expected.append(system/PARENT)
    for row, locations in records:
        matching = [path for path in locations if os.path.lexists(path) and m.identity(path) == row['identity']]
        need(len(matching) == 1 and m.sha(m.protected(matching[0])) == row['sha256'],
             'one_exact_original_or_new_parent_definition_inode_required')
        file_facts.append({'identity': row['identity'], 'location': str(matching[0]), 'sha256': row['sha256']})
    allowed = {str(path) for path in expected}
    for directory in [system, Path('/run/systemd/system')]:
        paths = [directory/PARENT]; drop = directory/(PARENT+'.d')
        if drop.exists():paths += list(drop.glob('*.conf'))
        for path in paths:
            if os.path.lexists(path):
                need(str(path) in allowed and any(m.identity(path) == row['identity'] for row, _ in records),
                     'unowned_parent_definition_prefix_refused')
    old_boot = op['activations'][PARENT]['boot']; boot = owner.h.boot_link(PARENT); links = []
    if old_boot:
        held = hold/(PARENT+'.boot')
        if os.path.lexists(held):
            need(owner.get('hold-boot-'+PARENT+'-intent.json') == {'value': {
                'source': str(boot), 'target': str(held), 'identity': old_boot['identity']}},
                'actual_original_parent_boot_move_intent_required')
        links.append((old_boot, [boot, held]))
    if owner.has('new-boot-prepared.json'):
        row = owner.get('new-boot-prepared.json')
        need(row['path'] == str(boot) and row['link']['target'] == str(system/PARENT), 'fixed_owned_parent_boot_target_required')
        links.append((row['link'], [boot, hold/'managed.new-boot', hold/'managed.boot-removed']))
    for row, locations in links:
        matching = [path for path in locations if os.path.lexists(path) and m.identity(path) == row['identity']]
        need(len(matching) == 1, 'one_exact_owned_parent_boot_inode_required'); m.moved_link_matches(matching[0], row)
        link_facts.append({'identity': row['identity'], 'location': str(matching[0])})
    if os.path.lexists(boot):need(any(m.identity(boot) == row['identity'] for row, _ in links), 'unowned_parent_boot_prefix_refused')
    return {'definitions': file_facts, 'bootLinks': link_facts}


def inverse_terminal(owner, op):
    """Owned source restarts may coexist with an already terminal parent."""
    owner.managed_known_gone(); actors = {}
    for unit in owner.m.WRITERS:
        if unit == PARENT:continue
        actor = owner.h.actor(unit, True)
        if actor is None:continue
        need(unit in {owner.m.SOURCE, owner.m.SOLANA}, 'unexpected_writer_in_owned_managed_inverse_prefix')
        name = 'inverse-start-'+unit
        if owner.has('drain-'+unit+'-intent.json'):
            intent = owned_intent(owner, name+'-intent.json')
            need(owner.original_actor(unit, intent) == actor, 'exact_owned_original_restart_prefix_required')
            if owner.has(name+'-result.json'):
                result = owner.get(name+'-result.json')
                need(all(result.get(key) == item for key, item in owner.envelope().items()) and result['actor'] == actor and
                     result['intentSha256'] == owner.digest(name+'-intent.json'), 'actual_owned_restored_actor_ACK_required')
        else:need(actor == op['units'][unit], 'undrained_original_actor_must_stay_exact')
        actors[unit] = actor
    sessions = owner.h.sessions(actors, True)
    if owner.m.SOURCE in actors:
        need(bool(sessions['73004621']['owned'][owner.m.SOURCE]), 'positive_owned_inverse_source_kernel_required')
    return {unit: owner.f.canonical_actor(actor) for unit, actor in actors.items()}


def current(owner, op):
    state = owner.h.state(PARENT)
    if not owner.has('install-intent.json'):
        need(not owner.has('parent-start-intent.json') and not owner.has('managed-unit-prepared.json') and
             not owner.has('new-boot-prepared.json') and owner.h.activation(PARENT) == op['activations'][PARENT] and
             owner.m.definition_frame(state) == op['unitDefinitionFrames'][PARENT] and owner.h.actor(PARENT, True) is None and
             state['MainPID'] == state['ControlPID'] == '0' and state['ActiveState'] in {'inactive', 'failed'} and state['Job'] in {'', '0'},
             'unchanged_terminal_original_parent_before_owned_install_required')
        return {'format': FORMAT, 'phase': 'original-terminal', 'currentManagedQualified': False}
    owned_intent(owner, 'install-intent.json'); identities = file_prefix(owner, op)
    inverse = owner.has('inverse-intent.json')
    if inverse:owned_intent(owner, 'inverse-intent.json')
    if not owner.has('parent-start-intent.json'):
        need(owner.h.actor(PARENT, True) is None and state['MainPID'] == state['ControlPID'] == '0' and
             state['ActiveState'] in {'inactive', 'failed'} and state['Job'] in {'', '0'},
             'owned_install_prefix_parent_must_stay_terminal_without_start_intent')
        return {'format': FORMAT, 'phase': 'owned-inverse-install' if inverse else 'owned-install', **identities,
                'currentManagedQualified': False}
    intent = owned_intent(owner, 'parent-start-intent.json'); installed = owner.get('installed.json')
    need(all(installed.get(key) == item for key, item in owner.envelope().items()) and intent['activation'] == installed['activation'],
         'actual_installed_ACK_before_owned_parent_start_required')
    if state['MainPID'] != '0':
        need(not inverse or not owner.has('inverse-drained.json'), 'parent_cannot_reappear_after_owned_inverse_drain')
        owner.installed(); actor = owner.owned_parent_for_stop()
        need(int(state['ExecMainStartTimestampMonotonic']) >= intent['notBeforeUs'] and actor['unit']['NRestarts'] == '0',
             'same_once_owned_parent_start_boundary_required')
        for name in ['parent-first-observation.json', 'parent-observed.json']:
            if owner.has(name):
                observed = owner.get(name)
                need(all(observed.get(key) == item for key, item in owner.envelope().items()) and
                     observed['startIntentSha256'] == owner.digest('parent-start-intent.json') and
                     owner.f.canonical_actor(observed['actor']) == owner.f.canonical_actor(actor),
                     'same_actual_once_observed_parent_epoch_required')
        qualified = False
        if not inverse and (owner.f.BASE/'result.json').exists():
            result_sha = owner.f.sha(owner.f.protected(owner.f.BASE/'result.json')); proof = owner.foundation.current(result_sha)
            need(proof['currentWriterQualified'] is proof['managedProcessTreeQualified'] is proof['allSixMountsQualified'] is True and
                 proof['currentManagedEpoch'] == owner.f.canonical_actor(actor) and proof['observation']['positiveKernelSessions'] >= 1,
                 'genuine_completed_foundation_parent_tree_mounts_and_positive_kernel_required')
            qualified = True
        return {'format': FORMAT, 'phase': 'owned-started', **identities, 'actor': owner.f.canonical_actor(actor),
                'currentManagedQualified': qualified}
    if inverse:
        need(state['ControlPID'] == '0' and state['ActiveState'] in {'inactive', 'failed'} and
             state['Job'] in {'', '0'} and owner.h.actor(PARENT, True) is None,
             'owned_inverse_parent_must_stay_terminal_and_jobless')
        actors = inverse_terminal(owner, op)
        if owner.has('inverse-result.json'):
            result = owner.get('inverse-result.json')
            need(all(result.get(key) == item for key, item in owner.envelope().items()) and result['restored'] is True and
                 result['operationSha256'] == owner.digest('operation.json') and
                 {unit: owner.f.canonical_actor(actor) for unit, actor in result['actors'].items()} == actors,
                 'actual_completed_inverse_and_same_restored_actors_required')
            owner.restored_files(op)
        return {'format': FORMAT, 'phase': 'owned-inverse-terminal', **identities, 'restoredActors': actors,
                'currentManagedQualified': False}
    need(state['ControlPID'] == '0' and state['ActiveState'] in {'inactive', 'failed', 'activating'} and
         (state['ActiveState'] != 'activating' or state['SubState'] == 'auto-restart') and
         int(state['ExecMainStartTimestampMonotonic']) >= intent['notBeforeUs'] and owner.h.actor(PARENT, True) is None,
         'exact_owned_failed_or_inverse_terminal_parent_prefix_required')
    owner.managed_known_gone(); owner.terminal_backends()
    return {'format': FORMAT, 'phase': 'owned-inverse-terminal' if inverse else 'owned-start-terminal', **identities,
            'currentManagedQualified': False}


def stable(owner, original, op):
    before = current(owner, op); native = original(op)
    need(current(owner, op) == before, 'owned_parent_phase_changed_during_unrelated_peer_and_native_checks'); return native


if __name__ == '__main__':
    print(json.dumps({'format': FORMAT, 'staticOnly': True, 'currentManagedQualified': False,
                      'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
