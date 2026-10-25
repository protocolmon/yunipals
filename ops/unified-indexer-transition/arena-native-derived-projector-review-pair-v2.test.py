"""Actual projector namespace and real not-found response shape fixtures."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('arena-native-derived-projector-review-pair-v2.py')


def public(path,digest=None,maximum=4000000):
    matches=[p for p in HERE.parent.rglob(Path(path).name)if p.is_file()and(digest is None or hashlib.sha256(p.read_bytes()).hexdigest()==digest)]
    if not matches:raise RuntimeError('actual_local_paired_v2_source_required')
    return matches[0].read_bytes()


class Controls(unittest.TestCase):
    def setUp(self):
        wrapper=load('arena-native-derived-projector-v2.py')
        with patch.object(wrapper,'protected',side_effect=public):self.owner=wrapper.composition()
        self.enterContext(patch.object(self.owner.Owner,'state',side_effect=AssertionError('loaded_only_API_must_not_run')))
        self.command=self.enterContext(patch.object(self.owner,'command',side_effect=self.response))
        self.enterContext(patch.object(m.os.path,'lexists',return_value=False))

    def response(self,args,timeout):
        self.assertEqual(timeout,15);unit=args[3]
        if '--property=MainPID'in args:return b''
        return ('Id='+unit+'\nLoadState=not-found\nActiveState=inactive\nSubState=dead\nFragmentPath=\nDropInPaths=\nJob=\n').encode()

    def test_actual_composed_namespace_uses_bounded_command_and_not_loaded_only_state_API(self):
        result=m.absent(self.owner);self.assertEqual(self.command.call_count,4)
        self.assertEqual(set(result),{m.UNIT,m.SOCKET_UNIT})
        for row in result.values():
            self.assertEqual(row['observedProcessFields'],{});self.assertFalse(row['processFieldsInvented'])
            self.assertTrue(row['physicalCgroupAbsent']);self.assertTrue(row['managerUnitAbsent'])

    def test_returned_pid_fields_remain_actual_and_nonzero_refuses(self):
        original=self.response
        def response(args,timeout):
            if '--property=MainPID'in args:return b'MainPID=0\nControlPID=\n'
            return original(args,timeout)
        self.command.side_effect=response
        self.assertEqual(m.absent(self.owner)[m.UNIT]['observedProcessFields'],{'MainPID':'0','ControlPID':''})
        self.command.side_effect=lambda *_args,**_kw:b'MainPID=9\nControlPID=0\n'
        with self.assertRaises(RuntimeError):m.absent(self.owner)

    def test_loaded_failed_unknown_properties_and_live_paths_or_cgroups_refuse(self):
        original=self.response
        for before,after in [('LoadState=not-found','LoadState=loaded'),('ActiveState=inactive','ActiveState=failed'),
            ('SubState=dead','SubState=running'),('Job=','Job=123')]:
            self.command.side_effect=lambda args,timeout,before=before,after=after:original(args,timeout).replace(before.encode(),after.encode())
            with self.subTest(after=after),self.assertRaises(RuntimeError):m.absent(self.owner)
        with patch.object(m.os.path,'lexists',side_effect=lambda p:Path(p).parent==Path('/sys/fs/cgroup/system.slice')):
            with self.assertRaisesRegex(RuntimeError,'cgroups_must_be_absent'):m.absent(self.owner)

    def test_complete_original_capture_private_records_hashes_and_no_effect_methods_are_retained(self):
        old=load(m.FROZEN.name)
        with patch.object(m,'source',return_value=public(m.FROZEN,m.FROZEN_SHA)):actual=m.composition()
        for name in ['capture','authenticate','runtime','save','changes','main']:
            self.assertEqual(getattr(actual,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
            self.assertEqual(getattr(actual,name).__code__.co_consts,getattr(old,name).__code__.co_consts,name)
        self.assertIs(actual.absent,m.absent);self.assertNotEqual(actual.AUDIT,old.AUDIT)
        self.assertNotEqual(actual.FORMAT,old.FORMAT)

    def test_default_cli_inert_and_frozen_bytes_exact(self):
        result=subprocess.run(['python3','-I','-B',str(HERE/'arena-native-derived-projector-review-pair-v2.py')],capture_output=True,check=True)
        self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertFalse(result.stderr)
        self.assertEqual(hashlib.sha256((HERE/m.FROZEN.name).read_bytes()).hexdigest(),m.FROZEN_SHA)


if __name__=='__main__':unittest.main()
