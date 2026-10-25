#!/usr/bin/env python3
"""Real source composition and whole successful-worker predicate controls."""
import ast
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=load('ypal-ordinary-generation-accept-v3.py');previous=load('ypal-ordinary-generation-accept-v2.py')
base=load('ypal-ordinary-generation-accept-v1.test.py');retained=load('ypal-ordinary-generation-accept-v2.test.py')

def composed(module=m):
    with patch.object(module,'public',base.local_public):value=module.implementation()
    value.protected=base.local_public;value.load=base.local_load;value.__file__=str(HERE/module.FILE.name)
    return value

def actual(module=m):
    value=composed(module)
    with patch.object(m,'public',base.local_public):source,attempt=value.prepared_attempt()
    return value,source,attempt


def worker_fixture(attempt,query):
    import datetime,time
    started=time.time()-100
    snapshot={'version':1,'releaseId':'local-release','readIdentity':'local-identity','physicalSchema':'unified_ypal_20261023_v1',
        'metadataReleaseId':'local-metadata','predecessor':'103','capturedAt':datetime.datetime.fromtimestamp(started+50,datetime.timezone.utc).isoformat(),
        'anchors':[{'localFixture':True}],'baseMetadataFrontier':'local-frontier'}
    validation={'sourceSnapshot':snapshot,'localFixture':True}
    candidate={'generationId':'105','predecessor':'103','validation':validation}
    runtime={'startedUnix':started};result={'localFixture':True}
    host=types.SimpleNamespace(h=types.SimpleNamespace(query=query,meta=types.SimpleNamespace(RELEASE='local-release',IDENTITY='local-identity')))
    return host,candidate,runtime,result


def postgres_bridge():
    # The Node harness owns/cleans a disposable local database. Only these two
    # genuine SELECTs cross the bridge; worker/process evidence is a fixture.
    request=json.loads(sys.stdin.readline());module=previous if request['original']else m
    _,_,attempt=actual(module)
    def query(sql):
        print(json.dumps({'query':sql}),flush=True);answer=json.loads(sys.stdin.readline())
        if 'error'in answer:raise RuntimeError('fixture_SQLSTATE_'+answer['error'])
        return answer['value']
    host,candidate,runtime,result=worker_fixture(attempt,query)
    runtime['startedUnix']=request['startedUnix'];candidate['validation']=request['validation'];candidate['predecessor']=request.get('predecessor','103')
    try:
        with patch.dict(attempt.__dict__,{'successful_worker_evidence':lambda h:(candidate,runtime,result)}):
            returned=attempt.successful_worker(host)
        print(json.dumps({'done':True,'generationId':returned[0]['generationId'],'validationRetained':returned[1]['validation']==candidate['validation']}),flush=True)
    except RuntimeError as error:print(json.dumps({'done':False,'fixedCode':str(error)}),flush=True)


class Controls(unittest.TestCase):
    def test_all_168_exact_sources_and_immutable_previous_failures(self):
        self.assertEqual(len(m.SOURCE_PINS),168)
        for name,digest in m.SOURCE_PINS.items():self.assertEqual(base.m.sha((HERE/name).read_bytes()),digest)
        self.assertEqual(m.SOURCE_PINS[previous.FILE.name],m.PREVIOUS_SQL_ACCEPTANCE_SHA)
        self.assertEqual(m.SOURCE_PINS[m.FROZEN.name],m.FROZEN_SHA)

    def test_same_bytecode_and_shared_globals_only_one_constant_changes(self):
        _,_,old=actual(previous);_,_,new=actual();a,b=old.successful_worker,new.successful_worker
        for key in ['co_code','co_names','co_varnames','co_freevars','co_cellvars','co_flags','co_argcount']:
            self.assertEqual(getattr(a.__code__,key),getattr(b.__code__,key),key)
        changes=[(x,y)for x,y in zip(a.__code__.co_consts,b.__code__.co_consts)if x!=y]
        self.assertEqual(changes,[('AND extract(epoch FROM started_at)>=',' AND extract(epoch FROM started_at)>=')])
        self.assertIs(b.__globals__,new.__dict__);self.assertIs(new.acceptance_review.__globals__['successful_worker'],b)
        original_candidate=new.candidate_context.__closure__[0].cell_contents
        self.assertIs(original_candidate.__globals__['successful_worker'],b)
        self.assertIn('AND extract(epoch FROM started_at)>=',a.__code__.co_consts)

    def test_full_remaining_worker_Host_review_and_private_methods_unchanged(self):
        _,_,old=actual(previous);_,_,new=actual()
        for name in ['successful_worker_evidence','acceptance_review','operation','retained_current','capacity_preflight','child_epoch_gone','empty_application']:
            a,b=getattr(old,name).__code__,getattr(new,name).__code__;self.assertEqual((a.co_code,a.co_consts),(b.co_code,b.co_consts),name)
        for name in ['__init__','qualify']:
            self.assertEqual(getattr(old.Host,name).__code__.co_code,getattr(new.Host,name).__code__.co_code)

    def test_actual_terminal_capture_keeps_genuine_retained_eight_second_API(self):
        entry=composed();result,calls=retained.Controls().capture(entry)
        self.assertTrue(result['proof']['validated']);self.assertEqual(len(calls),2)

    def test_prepared_attempt_adds_only_actual_shared_validator_call(self):
        captured=[]
        class Factory(types.ModuleType):
            def __getattribute__(self,name):
                original=super().__getattribute__(name)
                if name!='namespace':return original
                def namespace(*args,**kwargs):
                    transform=kwargs['transform']
                    def record(node):
                        before=copy.deepcopy(node);after=transform(node)
                        if isinstance(before,ast.FunctionDef)and before.name=='prepared_attempt':captured.append((before,copy.deepcopy(after)))
                        return after
                    kwargs['transform']=record;return original(*args,**kwargs)
                return namespace
        with patch.object(m,'public',base.local_public),patch.object(m,'types',types.SimpleNamespace(ModuleType=Factory)):entry=m.implementation()
        self.assertEqual(len(captured),1);before,after=captured[0]
        calls=[row for row in after.body if isinstance(row,ast.Expr)and ast.unparse(row.value)=='repair_successful_worker(attempt)']
        self.assertEqual(len(calls),1);after.body.remove(calls[0])
        self.assertEqual(ast.dump(before,include_attributes=False),ast.dump(after,include_attributes=False))
        old=composed(previous)
        # Insertion does not replace terminal logic or its strict old branch.
        self.assertEqual(entry.terminal_function.__code__.co_code,old.terminal_function.__code__.co_code)
        self.assertEqual(len([row for row in ast.walk(before)if isinstance(row,ast.Call)and ast.unparse(row.func)=='capture_terminal']),2)
        _,_,attempt=actual()
        self.assertEqual(attempt.BASE,base.m.BUILD_BASE)

    def test_new_domain_old_build_operation_and_both_failure_markers(self):
        value,source,attempt=actual();accept,context,exports=value.acceptance_functions(source,attempt)
        scope=next(cell.cell_contents for cell in accept.__closure__ if type(cell.cell_contents)is dict and 'accept'in cell.cell_contents)
        constants=scope['accept'].__code__.co_consts
        for token in [m.FROZEN_SHA,m.PREVIOUS_SQL_ACCEPTANCE_SHA,'previousAcceptanceCLIPassed','previousSqlAcceptanceCLIPassed']:
            self.assertIn(token,constants)
        self.assertEqual(scope['BASE'],m.BASE);self.assertEqual(scope['OPERATION'],base.m.OPERATION)
        self.assertEqual(scope['ATTEMPT_SHA'],base.m.ATTEMPT_SHA)
        helpers=value.composition();self.assertEqual(helpers.BASE,base.m.BUILD_BASE);self.assertEqual(helpers.FORMAT,'yunipals-ypal-ordinary-generation-attempt-v2')
        self.assertFalse(hasattr(helpers,'build'));self.assertNotEqual(m.BASE,previous.BASE)
        wrapped=next(cell.cell_contents for cell in context.__closure__ if isinstance(cell.cell_contents,types.FunctionType)and cell.cell_contents.__name__=='candidate_context')
        self.assertIs(wrapped.__globals__['successful_worker'],attempt.successful_worker)

    def test_foreign_function_namespace_or_source_AST_refuses(self):
        _,_,attempt=actual(previous)
        attempt.fresh_forward_reuse['originalDefinitions']['successful_worker']='0'*64
        with patch.object(m,'public',base.local_public),self.assertRaisesRegex(RuntimeError,'actual_unchanged_shared'):
            m.repair_successful_worker(attempt)

    def test_default_main_inert_with_no_Host_construction(self):
        value=composed();value.prepared_attempt=lambda:(_ for _ in()).throw(AssertionError('default_must_not_construct'))
        output=io.StringIO()
        with patch.object(sys,'argv',[str(m.FILE)]),redirect_stdout(output):value.main()
        result=json.loads(output.getvalue());self.assertEqual(result['format'],m.FORMAT);self.assertTrue(result['staticOnly'])
        self.assertEqual(result['databaseWrites'],0)


if __name__=='__main__':
    if sys.argv[1:]==['--postgres']:postgres_bridge()
    else:unittest.main()
