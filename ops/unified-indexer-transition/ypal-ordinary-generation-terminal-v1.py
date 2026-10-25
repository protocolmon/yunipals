#!/usr/bin/env python3
"""Actual terminal one-shot proof when systemd has cleared execution fields."""
import hashlib
import json
import math
import re

FORMAT = 'yunipals-ypal-ordinary-generation-terminal-v1'
UNIT = 'yunipals-ypal-ordinary-generation-attempt-v2.service'
APP = 'yunipals_ypal_ordinary_generation_attempt_v2_20261025'
START = '7d4958e842da4a758f6c1cdc7b36dcc5'
STARTED = '39f53479d3a045ac8e11786248231fbf'
STOPPED = '7ad2d189f7e94e70a38c781354912448'
FIELDS = ['Id','LoadState','ActiveState','SubState','MainPID','ControlPID','Job','FragmentPath','DropInPaths','User','Group',
          'Restart','NRestarts','Result','InvocationID','ExecMainPID','ExecMainCode','ExecMainStatus',
          'ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic','InactiveEnterTimestampMonotonic',
          'Type','CollectMode','RemainAfterExit','KillMode','SuccessExitStatus','TimeoutStopUSec']
JOURNAL_FIELDS = ['UNIT','INVOCATION_ID','MESSAGE_ID','JOB_TYPE','JOB_RESULT','_BOOT_ID','_PID','_UID','_COMM','_TRANSPORT',
                  '__MONOTONIC_TIMESTAMP','__REALTIME_TIMESTAMP']


def need(value, code):
    if not value:raise RuntimeError(code)
def encoded(value):return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def decimal(value):return type(value) is str and re.fullmatch('(0|[1-9][0-9]*)', value) is not None
def boot(value):
    need(type(value) is str and re.fullmatch('[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', value),
         'actual_boot_identity_required')
    return value.replace('-', '')


def validate(state, start, runtime, started, result, journal, current_boot, now_monotonic_us, clock_ticks):
    """No state property is normalized, substituted or represented as retained."""
    need(type(state) is dict and set(state) == set(FIELDS) and state['Id'] == UNIT and
         state['LoadState'] == 'loaded' and state['ActiveState'] == 'inactive' and state['SubState'] == 'dead' and
         state['MainPID'] == state['ControlPID'] == '0' and state['Job'] == '' and
         state['FragmentPath'] == '/etc/systemd/system/'+UNIT and state['DropInPaths'] == '' and
         state['User'] == state['Group'] == 'root' and state['Restart'] == 'no' and state['NRestarts'] == '0' and
         state['Result'] == 'success' and state['ExecMainCode'] == state['ExecMainStatus'] == '0' and
         state['Type'] == 'exec' and state['CollectMode'] == 'inactive' and state['RemainAfterExit'] == 'no' and
         state['KillMode'] == 'control-group' and state['SuccessExitStatus'] == '' and state['TimeoutStopUSec'] == '20s',
         'actual_successful_owned_terminal_exec_unit_required')
    cleared = state['InvocationID'] == ''
    need(cleared and all(state[key] == '0' for key in ['ExecMainPID','ExecMainStartTimestampMonotonic',
         'ExecMainExitTimestampMonotonic','InactiveEnterTimestampMonotonic']), 'explicit_actual_cleared_terminal_state_required')
    main = started['main']; current_boot = boot(current_boot)
    need(type(main) is dict and set(main) == {'bootId','pid','startTicks'} and boot(main['bootId']) == current_boot and
         type(main['pid']) is int and main['pid'] > 1 and type(main['startTicks']) is int and main['startTicks'] > 0 and
         runtime['mainPid'] == main['pid'] and runtime['unit'] == UNIT and runtime['applicationName'] == APP and
         re.fullmatch('[a-f0-9]{32}', runtime['invocation']) and started['invocation'] == result['invocation'] == runtime['invocation'] and
         started['unitSha256'] == start['definitionSha256'] and start['publicationAllowed'] is False and
         runtime['automaticRetry'] is result['automaticRetry'] is False and result['childExit'] == 0 and result['failure'] is None and
         result['ownedTermination'] is None, 'same_real_boot_process_epoch_worker_and_success_result_required')
    need(type(start['monotonicUs']) is int and start['monotonicUs'] > 0 and type(now_monotonic_us) is int and
         now_monotonic_us >= start['monotonicUs'] and type(clock_ticks) is int and 1 <= clock_ticks <= 1000000 and
         type(runtime['maximumSeconds']) is int and 1470 <= runtime['maximumSeconds'] <= 2400 and
         type(runtime['startedUnix']) in {int, float} and math.isfinite(runtime['startedUnix']) and runtime['startedUnix'] > 0 and
         type(result['elapsedSeconds']) in {int, float} and math.isfinite(result['elapsedSeconds']) and
         0 < result['elapsedSeconds'] <= runtime['maximumSeconds'], 'actual_monotonic_realtime_and_bounded_worker_duration_required')
    need(type(journal) is list and 3 <= len(journal) <= 4096, 'bounded_complete_actual_unit_manager_journal_required')
    rows = []
    for row in journal:
        need(type(row) is dict and decimal(row.get('__MONOTONIC_TIMESTAMP')) and decimal(row.get('__REALTIME_TIMESTAMP')),
             'actual_manager_journal_clock_fields_required')
        if int(row['__MONOTONIC_TIMESTAMP']) < start['monotonicUs']:continue
        need(int(row['__MONOTONIC_TIMESTAMP']) <= now_monotonic_us and row.get('UNIT') == UNIT and
             row.get('_PID') == '1' and row.get('_UID') == '0' and row.get('_COMM') == 'systemd' and
             row.get('_TRANSPORT') == 'journal' and boot(row.get('_BOOT_ID')) == current_boot and
             row.get('INVOCATION_ID') == runtime['invocation'], 'trusted_root_manager_same_unit_boot_and_no_foreign_later_invocation_required')
        if 'JOB_RESULT' in row:need(row['JOB_RESULT'] == 'done', 'no_failed_or_cancelled_owned_manager_job_required')
        rows.append({key: row[key] for key in JOURNAL_FIELDS if key in row})
    ordered = sorted(rows, key=lambda row: int(row['__MONOTONIC_TIMESTAMP']))
    need(rows == ordered and len({(row['__MONOTONIC_TIMESTAMP'],row.get('MESSAGE_ID')) for row in rows}) == len(rows),
         'chronological_unique_actual_manager_records_required')
    picked = []
    for message in [START, STARTED, STOPPED]:
        values = [row for row in rows if row.get('MESSAGE_ID') == message]
        need(len(values) == 1, 'one_actual_start_started_and_successful_stop_required'); picked.append(values[0])
    first, active, terminal = picked
    need(first.get('JOB_TYPE') == active.get('JOB_TYPE') == 'start' and active.get('JOB_RESULT') == 'done' and
         start['monotonicUs'] <= int(first['__MONOTONIC_TIMESTAMP']) <= int(active['__MONOTONIC_TIMESTAMP']) < int(terminal['__MONOTONIC_TIMESTAMP']) and
         int(first['__REALTIME_TIMESTAMP']) <= int(active['__REALTIME_TIMESTAMP']) < int(terminal['__REALTIME_TIMESTAMP']),
         'genuine_successful_manager_start_and_stop_after_owned_intent_required')
    tick_us = 1000000/clock_ticks; process_us = main['startTicks']*tick_us
    need(start['monotonicUs']-tick_us <= process_us <= int(active['__MONOTONIC_TIMESTAMP'])+tick_us,
         'actual_acknowledged_main_process_ticks_within_owned_start_window_required')
    elapsed_wall = int(terminal['__REALTIME_TIMESTAMP'])/1000000-runtime['startedUnix']
    elapsed_mono = (int(terminal['__MONOTONIC_TIMESTAMP'])-int(first['__MONOTONIC_TIMESTAMP']))/1000000
    journal_wall = (int(terminal['__REALTIME_TIMESTAMP'])-int(first['__REALTIME_TIMESTAMP']))/1000000
    need(int(active['__REALTIME_TIMESTAMP'])/1000000 <= runtime['startedUnix'] <= int(terminal['__REALTIME_TIMESTAMP'])/1000000 and
         0 <= elapsed_wall-result['elapsedSeconds'] <= 5 and abs(elapsed_mono-journal_wall) <= 1 and
         elapsed_mono <= runtime['maximumSeconds']+30, 'actual_worker_duration_and_manager_journal_clocks_must_agree')
    binding = {'format': FORMAT, 'unit': UNIT, 'invocation': runtime['invocation'], 'bootId': current_boot,
        'main': main, 'startIntentMonotonicUs': start['monotonicUs'], 'managerStart': first, 'managerStarted': active,
        'managerSuccessfulStop': terminal, 'completeManagerJournalSha256': sha(encoded(rows)),
        'completeManagerRecords': len(rows), 'actualClearedState': state, 'unitExecutionFieldsRetained': False,
        'recordSha256': {name: sha(encoded(value)) for name, value in [('startIntent',start),('runtimeIntent',runtime),('started',started),('result',result)]},
        'originalStrictTerminalInvocationGatePassed': False}
    return {'validated': True, 'binding': binding, 'bindingSha256': sha(encoded(binding)),
            'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


if __name__ == '__main__':
    print(json.dumps({'format': FORMAT, 'staticOnly': True, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
