#!/usr/bin/env python3
"""Genuine retained-run signature and narrow successor controls; no live calls."""
import ast
import copy
import importlib.util
import inspect
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=load('ypal-ordinary-generation-accept-v2.py');old=load('ypal-ordinary-generation-accept-v1.py')
fixture=load('ypal-ordinary-generation-terminal-v1.test.py');terminal=load('ypal-ordinary-generation-terminal-v1.py')
base_tests=load('ypal-ordinary-generation-accept-v1.test.py')
runner=load('retained-workers-stage-v1.py')


def public(path,digest,maximum=4000000):
    return base_tests.local_public(path,digest,maximum)


def implementation():
    with patch.object(m,'public',public):return m.implementation()


class Controls(unittest.TestCase):
    def test_actual_frozen_ancestor_and_all_167_sources(self):
        self.assertEqual(len(m.SOURCE_PINS),167)
        self.assertEqual(m.SOURCE_PINS[m.FROZEN.name],m.FROZEN_SHA)
        for name,digest in m.SOURCE_PINS.items():self.assertEqual(old.sha((HERE/name).read_bytes()),digest)
        self.assertEqual(old.sha((HERE/'retained-workers-stage-v1.py').read_bytes()),'4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416')

    def test_genuine_pinned_runner_reproduces_original_failure_without_invoking_subprocess(self):
        self.assertEqual(str(inspect.signature(runner.run)),'(args, data=None)')
        calls=[]
        def process(args,*,input,capture_output,timeout,env):calls.append(args);raise AssertionError('not_called')
        with patch.object(runner,'subprocess',types.SimpleNamespace(run=process)):
            for timeout in [10,15]:
                with self.assertRaises(TypeError):runner.run(['/fixture'],timeout=timeout)
        self.assertEqual(calls,[])

    def capture(self,entry,stderr=b'',oversize=False):
        state,start,runtime,started,result,journal,*_=fixture.fixture()
        current_boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip();started['main']['bootId']=current_boot
        for row in journal:row['_BOOT_ID']=current_boot.replace('-','')
        body=b'actualFixtureUnit';start['definitionSha256']=old.sha(body);started['unitSha256']=old.sha(body)
        records={entry.BUILD_BASE/(terminal.UNIT+'-start-intent.json'):start,
            entry.BUILD_BASE/(terminal.UNIT+'-started.json'):started,
            entry.BUILD_BASE/(terminal.UNIT+'-file-created.json'):{'inode':'fixture'},
            Path('/fixture/work')/'intent.json':runtime,Path('/fixture/work')/'result.json':result}
        attempt=types.SimpleNamespace(UNIT=terminal.UNIT,WORK=Path('/fixture/work'),document=lambda path:copy.deepcopy(records[path]),
            sha=old.sha,protected=lambda path:body)
        calls=[]
        def process(args,*,input,capture_output,timeout,env):
            self.assertEqual(timeout,8);self.assertIsNone(input);self.assertTrue(capture_output);self.assertEqual(env,runner.CLEAN)
            calls.append(args)
            stdout=('\n'.join(key+'='+value for key,value in state.items())+'\n').encode() if args[0]=='/usr/bin/systemctl' else b'\n'.join(json.dumps(row).encode()for row in journal)
            if oversize:stdout=b'x'*2000001
            return types.SimpleNamespace(returncode=0,stdout=stdout,stderr=stderr)
        host=types.SimpleNamespace(m=runner,meta=types.SimpleNamespace(file_identity=lambda path:{'inode':'fixture'}))
        with patch.object(runner,'subprocess',types.SimpleNamespace(run=process)):
            result=entry.capture_terminal(host,attempt,terminal)
        return result,calls

    def test_new_capture_invokes_genuine_exact_runner_API_and_validates_actual_cleared_shape(self):
        entry=implementation();result,calls=self.capture(entry)
        self.assertTrue(result['proof']['validated']);self.assertEqual(len(calls),2)
        self.assertEqual(result['state']['InvocationID'],'');self.assertEqual(result['state']['ExecMainStartTimestampMonotonic'],'0')
        self.assertIn('--boot='+terminal.boot(Path('/proc/sys/kernel/random/boot_id').read_text().strip()),calls[1])
        self.assertFalse(any(arg.startswith('--lines')or arg=='-n'for arg in calls[1]))

    def test_original_capture_still_refuses_with_genuine_API_and_is_not_relabelled(self):
        with self.assertRaisesRegex(TypeError,'timeout'):self.capture(old)

    def test_genuine_retained_stderr_and_two_MB_refusals_remain(self):
        for kwargs in [{'stderr':b'actualFixtureError'},{'oversize':True}]:
            with self.subTest(kwargs=kwargs),self.assertRaisesRegex(RuntimeError,'bounded_private_command_failed'):self.capture(implementation(),**kwargs)

    def test_only_two_runner_keyword_clauses_differ_in_complete_capture_body(self):
        captured=[]
        class Factory(types.ModuleType):
            def __getattribute__(self,name):
                original=super().__getattribute__(name)
                if name!='namespace':return original
                def namespace(*args,**kwargs):
                    transform=kwargs['transform']
                    def record(node):
                        before=copy.deepcopy(node);after=transform(node)
                        if isinstance(before,ast.FunctionDef)and before.name=='capture_terminal':captured.append((before,copy.deepcopy(after)))
                        return after
                    kwargs['transform']=record
                    return original(*args,**kwargs)
                return namespace
        with patch.object(m,'public',public),patch.object(m,'types',types.SimpleNamespace(ModuleType=Factory)):entry=m.implementation()
        self.assertEqual(len(captured),1);before,after=captured[0]
        for call in ast.walk(before):
            if isinstance(call,ast.Call)and ast.unparse(call.func)=='h.m.run':call.keywords=[]
        self.assertEqual(ast.dump(before,include_attributes=False),ast.dump(after,include_attributes=False))
        for name in ['capture_terminal','terminal_function','prepared_attempt','candidate_context','validate_candidate_database_current','validate_retained_current','main']:
            if name=='capture_terminal':continue
            first,second=getattr(entry,name).__code__,getattr(old,name).__code__
            self.assertEqual((first.co_code,first.co_consts),(second.co_code,second.co_consts),name)

    def test_new_domain_and_pure_build_namespace_split_are_retained(self):
        entry=implementation();self.assertEqual(entry.BASE,m.BASE);self.assertNotEqual(entry.BASE,old.BASE)
        self.assertEqual(entry.FORMAT,m.FORMAT);self.assertEqual(entry.CANDIDATE_FORMAT,m.CANDIDATE_FORMAT)
        entry.protected=base_tests.local_public;entry.load=base_tests.local_load;entry.__file__=str(HERE/m.FILE.name)
        helpers=entry.composition();self.assertEqual(helpers.BASE,old.BUILD_BASE);self.assertEqual(helpers.FORMAT,'yunipals-ypal-ordinary-generation-attempt-v2')
        self.assertFalse(hasattr(helpers,'build'))

    def test_new_candidate_explicitly_records_old_failure_without_old_operation_relabelling(self):
        entry=implementation();entry.protected=base_tests.local_public;entry.load=base_tests.local_load;entry.__file__=str(HERE/m.FILE.name)
        source,attempt=entry.prepared_attempt();accept,context,exports=entry.acceptance_functions(source,attempt)
        scope=next(cell.cell_contents for cell in accept.__closure__ if type(cell.cell_contents)is dict and 'accept'in cell.cell_contents)
        constants=scope['accept'].__code__.co_consts
        self.assertIn(m.FROZEN_SHA,constants);self.assertIn('previousAcceptanceProducerSha256',constants);self.assertIn('previousAcceptanceCLIPassed',constants)
        self.assertEqual(scope['BASE'],m.BASE);self.assertEqual(scope['OPERATION'],old.OPERATION)
        self.assertEqual(scope['ATTEMPT_SHA'],old.ATTEMPT_SHA)


if __name__=='__main__':unittest.main()
