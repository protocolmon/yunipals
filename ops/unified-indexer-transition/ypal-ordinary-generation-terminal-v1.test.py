#!/usr/bin/env python3
"""Pure terminal proof controls; fixtures are not production receipts."""
import copy
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('terminal', HERE/'ypal-ordinary-generation-terminal-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def fixture():
    state = {key: '0' for key in m.FIELDS}
    state.update(Id=m.UNIT, LoadState='loaded', ActiveState='inactive', SubState='dead', Job='',
        FragmentPath='/etc/systemd/system/'+m.UNIT, DropInPaths='', User='root', Group='root', Restart='no', Result='success',
        InvocationID='', Type='exec', CollectMode='inactive', RemainAfterExit='no', KillMode='control-group', SuccessExitStatus='', TimeoutStopUSec='20s')
    boot = '1'*32; invocation = '2'*32
    start = {'monotonicUs': 1000000, 'definitionSha256': 'a'*64, 'publicationAllowed': False}
    runtime = {'mainPid': 123, 'unit': m.UNIT, 'applicationName': m.APP, 'invocation': invocation,
               'automaticRetry': False, 'startedUnix': 100.04, 'maximumSeconds': 2400}
    started = {'main': {'bootId': boot, 'pid': 123, 'startTicks': 101}, 'invocation': invocation, 'unitSha256': 'a'*64}
    result = {'invocation': invocation, 'automaticRetry': False, 'childExit': 0, 'failure': None, 'ownedTermination': None, 'elapsedSeconds': .98}
    journal = []
    for message, mono, real in [(m.START,1020000,100020000),(m.STARTED,1030000,100030000),(m.STOPPED,2030000,101030000)]:
        journal.append({'MESSAGE_ID': message, '__MONOTONIC_TIMESTAMP': str(mono), '__REALTIME_TIMESTAMP': str(real),
            'UNIT': m.UNIT, '_PID': '1', '_UID': '0', '_COMM': 'systemd', '_TRANSPORT': 'journal', '_BOOT_ID': boot, 'INVOCATION_ID': invocation})
    journal[0]['JOB_TYPE'] = journal[1]['JOB_TYPE'] = 'start'; journal[1]['JOB_RESULT'] = 'done'
    return [state, start, runtime, started, result, journal, boot, 3000000, 100]


class Controls(unittest.TestCase):
    def test_actual_cleared_state_is_reported_without_filling_execution_fields(self):
        args = fixture(); before = copy.deepcopy(args); value = m.validate(*args)
        self.assertTrue(value['validated']); self.assertEqual(args, before)
        self.assertEqual(value['binding']['actualClearedState']['InvocationID'], '')
        self.assertFalse(value['binding']['originalStrictTerminalInvocationGatePassed'])

    def test_foreign_or_later_invocation_even_after_another_successful_GC_refuses(self):
        args = fixture(); later = copy.deepcopy(args[5][-1]); later['INVOCATION_ID'] = '3'*32; later['__MONOTONIC_TIMESTAMP'] = '2100000'
        args[5].append(later)
        with self.assertRaisesRegex(RuntimeError, 'foreign_later_invocation'):m.validate(*args)

    def test_trusted_manager_UID_PID_program_transport_and_boot_are_required(self):
        for key, value in [('_PID','123'),('_UID','1000'),('_COMM','fake'),('_TRANSPORT','stdout'),('_BOOT_ID','3'*32),('UNIT','foreign.service')]:
            args = fixture(); args[5][0][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):m.validate(*args)

    def test_missing_duplicate_or_later_owned_start_records_refuse(self):
        for changed in ['missing','duplicate','later-start']:
            args = fixture()
            if changed == 'missing':args[5].pop()
            else:
                row = copy.deepcopy(args[5][0]); row['__MONOTONIC_TIMESTAMP'] = '2100000'; args[5].append(row)
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):m.validate(*args)

    def test_start_intent_and_acknowledged_real_process_epoch_boundary_are_required(self):
        for changed in ['intent','ticks','pid','boot','invocation']:
            args = fixture()
            if changed == 'intent':args[1]['monotonicUs'] = 2000000
            elif changed == 'ticks':args[3]['main']['startTicks'] = 900
            elif changed == 'pid':args[3]['main']['pid'] = 999
            elif changed == 'boot':args[3]['main']['bootId'] = '3'*32
            else:args[3]['invocation'] = '3'*32
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):m.validate(*args)

    def test_successful_runtime_result_and_no_termination_or_retry_are_required(self):
        for key, value in [('childExit',1),('failure','timeout'),('automaticRetry',True),('ownedTermination',{}),('elapsedSeconds',2000)]:
            args = fixture(); args[4][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):m.validate(*args)

    def test_active_failed_job_or_restart_or_unretained_mixed_unit_state_refuses(self):
        for key, value in [('ActiveState','active'),('MainPID','123'),('ControlPID','456'),('Job','123'),('NRestarts','1'),('Result','failed'),('ExecMainPID','123')]:
            args = fixture(); args[0][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):m.validate(*args)

    def test_wall_clock_jump_unordered_records_future_records_and_unbounded_journal_refuse(self):
        for changed in ['clock','order','future','unbounded','job']:
            args = fixture()
            if changed == 'clock':args[5][-1]['__REALTIME_TIMESTAMP'] = '111030000'
            elif changed == 'order':args[5] = list(reversed(args[5]))
            elif changed == 'future':args[7] = 2020000
            elif changed == 'job':args[5][1]['JOB_RESULT'] = 'failed'
            else:args[5] *= 1366
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):m.validate(*args)


if __name__ == '__main__':unittest.main()
