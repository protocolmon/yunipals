"""Actual retained feature bodies and new ordinary/V5 composition; no host work."""
import ast
import copy
import importlib.util
import io
import contextlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent


def load(name):
    path = HERE/name; spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


wrapper = load('ypal-ordinary-feature-handover-v5.py')
context = load('ypal-ordinary-feature-context-v5.py')
original = (HERE/'ypal-feature-handover-v1.py').read_bytes()
assembler_raw = (HERE/'ypal-restored-feature-handover-v1.py').read_bytes()
m = wrapper.assemble(original, context, assembler_raw)

# Execute the actual 25 original lifecycle/file/unknown-ACK controls unchanged.
old_tests = (HERE/'ypal-feature-handover-v1.test.py').read_bytes()
assert wrapper.sha(old_tests) == 'eaed49340a4ccd59590cf385b28b2763d1440ef5a289f446d1077379a7694255'
body = [v for v in ast.parse(old_tests).body if isinstance(v, (ast.FunctionDef, ast.ClassDef))]
exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), __file__, 'exec'), globals())


def dependencies(): return {**context.PINNED, context.PROVIDER: '1'*64, context.READER: '2'*64}


def helper_namespace():
    def public(path): return (HERE/Path(path).name).read_bytes()
    def module(path, digest):
        value = load(Path(path).name)
        context.need(context.sha(public(path)) == digest, 'actual_test_dependency_sha_required')
        return value
    b = types.SimpleNamespace(module=module, protected=public)
    return context.helpers(b, dependencies())


class OrdinaryV5Seams(unittest.TestCase):
    def test_default_no_constructor_or_future_receipt(self):
        value = subprocess.run(['/usr/bin/python3','-I','-B',str(HERE/wrapper.Path(wrapper.__file__).name)],capture_output=True,check=True)
        answer = json.loads(value.stdout)
        self.assertTrue(answer['sourceOnly']); self.assertTrue(answer['eventRequiredBeforeRetirement'])
        self.assertEqual(answer['serviceActions'], 0)
        with self.assertRaises(RuntimeError): context.exact_dependencies({**dependencies(), context.PROVIDER: None})
        with self.assertRaises(RuntimeError): context.exact_dependencies({**dependencies(), 'foreign.py':'3'*64})

    def test_exact_new_namespace_and_all_owner_business_bodies_retained(self):
        old = load('ypal-feature-handover-v1.py')
        self.assertEqual(m.FORMAT, wrapper.FORMAT); self.assertEqual(m.BASE, wrapper.BASE)
        self.assertIn('ordinary-v5', str(m.SELECTOR)); self.assertNotIn('restored', str(m.DROPS[m.API]))
        for name, method in vars(old.Owner).items():
            if callable(method) and name not in {'retire','inverse'}:
                self.assertEqual(getattr(m.Owner,name).__code__.co_code, method.__code__.co_code, name)
        for name in ['retire','inverse']:
            before=next(v for v in ast.parse(original).body if isinstance(v,ast.ClassDef)and v.name=='Owner')
            method=copy.deepcopy(next(v for v in before.body if isinstance(v,ast.FunctionDef)and v.name==name))
            for node in ast.walk(method):
                if isinstance(node,ast.Call)and ast.unparse(node.func)=='os.rename':node.func=ast.Name(id='rename_no_replace',ctx=ast.Load())
            scope=dict(m.__dict__);exec(compile(ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[])),str(wrapper.__file__),'exec'),scope)
            self.assertEqual(getattr(m.Owner,name).__code__.co_code,scope[name].__code__.co_code)
        self.assertIn('host(client_addr)', str(m.HistoricalHost.inverse_api.__code__.co_consts))
        with self.assertRaises(RuntimeError): wrapper.assemble(original+b'\n', context, assembler_raw)

    def test_real_old_context_only_listed_new_seams(self):
        n = helper_namespace(); old = load('ypal-restored-feature-context-v1.py')
        for name in ['source_static','source_actor_checks','peer_program','fresh_native_identity','heartbeat_current','inverse_leaf']:
            self.assertEqual(getattr(n,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
        self.assertIn('host(client_addr)',str(n.temporary_sessions.__code__.co_consts))
        self.assertNotIn('client_addr::text',str(n.temporary_sessions.__code__.co_consts))
        self.assertIn('ExecStart', n.capture_temporary.__code__.co_consts)
        self.assertIs(n.reader_ancestry, context.reader_ancestry)
        self.assertIs(n.inverse_catalog_phase, context.inverse_catalog_phase)

    def test_reader_ancestry_uses_pure_actual_new_ack_and_exact_V5_refs(self):
        config = {k:'3'*64 for k in context.CONFIG}; config['readerManifestSha256']='4'*64
        value = {'validated':True,'immutableReaderAcknowledgementOnly':True,'published':True,
                 'receiptSha256':config['readerResultSha256'],'manifestSha256':config['readerManifestSha256'],
                 'operatorSha256':'2'*64,'operationSha256':'5'*64,'publicationSha256':'6'*64,'readSchema':context.READ_SCHEMA,
                 'readIdentity':context.READ_IDENTITY,'sourceRelease':'4e','readConfig':None,
                 'cachePreparedSha256':config['cachePreparedSha256'],'cacheInputsSha256':config['cacheInputsSha256'],
                 'currentReadersQualified':False,'currentWriterQualified':False,'sourceActorQualified':False}
        h = types.SimpleNamespace(config=config, manifest={'dependencies':dependencies()}, intake=types.SimpleNamespace(DATA={'sourceRelease':'4e'}))
        value['readConfig']=context.read_config(h)
        h.coordinator=types.SimpleNamespace(acknowledgement=Mock(side_effect=lambda *args:copy.deepcopy(value)))
        self.assertEqual(context.reader_ancestry(h),value)
        h.coordinator.acknowledgement.assert_called_with(config['readerResultSha256'],config['readerManifestSha256'])
        for key,bad in [('readIdentity','oldCAC'),('operatorSha256','7'*64),('currentWriterQualified',True),('cachePreparedSha256','8'*64)]:
            previous=value[key];value[key]=bad
            with self.assertRaises(RuntimeError):context.reader_ancestry(h)
            value[key]=previous

    def test_ordinary_source_explicit_retained_callback_and_stable_domain(self):
        actor={'unit':{'MainPID':'42'}}; seen=[]
        h=types.SimpleNamespace(config={'ordinaryResultSha256':'1'*64,'ordinaryInputSha256':'2'*64},inverse_mode=False,
            b=types.SimpleNamespace(COMBINED=m.COMBINED),retained_current=lambda:{'real':'temporary'})
        def current(result,input_sha,retained_current):
            seen.append((result,input_sha,retained_current()));return {'sourceKernelActors':{m.COMBINED:actor},'sourceKind':'standalone'}
        h.intake=types.SimpleNamespace(validate_runtime=current)
        result=context.HostMixin.combined(h)
        self.assertEqual(result['source'],actor);self.assertEqual(result['sourceKind'],'ordinary-standalone')
        self.assertEqual(seen,[('1'*64,'2'*64,{'real':'temporary'})])
        self.assertFalse(result['oldSourceReceiptRelabelled'])

    def test_actual_constructor_uses_static_READ_real_cache_input_and_recorded_reader_only(self):
        config={key:'3'*64 for key in context.CONFIG};config['readerManifestSha256']='4'*64
        provider_bytes=b'synthetic public provider fixture';reader_bytes=b'synthetic public reader fixture'
        deps={**context.PINNED,context.PROVIDER:m.sha(provider_bytes),context.READER:m.sha(reader_bytes)}
        manifest={'format':context.FORMAT+'-code','files':{name:m.sha((HERE/name).read_bytes())for name in
            ['ypal-ordinary-feature-handover-v5.py','ypal-ordinary-feature-context-v5.py']},'dependencies':deps}
        cache_config={'actual':'different acknowledged cache input'};reader_manifest={'files':{context.READER:deps[context.READER]}}
        def protected(path):
            name=Path(path).name
            return {context.PROVIDER:provider_bytes,context.READER:reader_bytes}.get(name) or (HERE/name).read_bytes()
        sdk=types.SimpleNamespace(command=Mock(side_effect=AssertionError('constructor must not call service/provider')),protected=protected)
        observer=object();host=types.SimpleNamespace(raw=types.SimpleNamespace(observer=observer))
        parts={'privilegedSourcePrimitives':{'sdk':sdk,'host':host}}
        intake=types.SimpleNamespace(DATA={'sourceRelease':'4e'},query_components=lambda:{'components':parts},validate_runtime=Mock(side_effect=AssertionError('constructor source qualification forbidden')))
        provider=types.SimpleNamespace(INPUT=Path('/synthetic/cache-input.json'),
            static_read_host=Mock(return_value=('read','static','ROhost','receipt','before','rehearsal')),
            cache_runtime=Mock(return_value='new-cache-runtime'))
        normalized={'validated':True,'immutableReaderAcknowledgementOnly':True,'published':True,
            'receiptSha256':config['readerResultSha256'],'manifestSha256':config['readerManifestSha256'],'operatorSha256':deps[context.READER],
            'operationSha256':'5'*64,'publicationSha256':'6'*64,'readSchema':context.READ_SCHEMA,'readIdentity':context.READ_IDENTITY,
            'sourceRelease':'4e','readConfig':{'admissionSha256':config['readAdmissionSha256'],'readPlanSha256':config['readPlanSha256'],
            'readContextInputSha256':config['readContextInputSha256']},'cachePreparedSha256':config['cachePreparedSha256'],
            'cacheInputsSha256':config['cacheInputsSha256'],'currentReadersQualified':False,'currentWriterQualified':False,'sourceActorQualified':False}
        coordinator=types.SimpleNamespace(MANIFEST=Path('/synthetic/reader-manifest.json'),acknowledgement=Mock(return_value=normalized))
        def module(path,digest):
            name=Path(path).name
            if name==context.PROVIDER:return provider
            if name==context.READER:return coordinator
            if name=='ypal-alchemy-ordinary-consumer-context-v1.py':return intake
            self.assertEqual(m.sha(protected(path)),digest);return load(name)
        b=types.SimpleNamespace(__file__=str(HERE/'ypal-ordinary-feature-handover-v5.py'),MANIFEST=Path('/synthetic/manifest.json'),
            INPUT=Path('/synthetic/input.json'),sha=m.sha,protected=protected,module=module,load_fixed=lambda _:types.SimpleNamespace(),
            document=lambda path,pin:manifest if path.name=='manifest.json'else config if path.name=='input.json'else
                cache_config if path.name=='cache-input.json'else reader_manifest)
        instance=object.__new__(m.Host)
        context.initialize(instance,b,'a'*64,'b'*64,None,None)
        provider.static_read_host.assert_called_once_with(config)
        provider.cache_runtime.assert_called_once_with(cache_config,reader_manifest)
        intake.validate_runtime.assert_not_called();sdk.command.assert_not_called()
        self.assertEqual(instance.cache,'new-cache-runtime');self.assertEqual(instance.read_host,'ROhost')

    def test_retained_terminal_requires_exact_durable_owned_stop_and_known_PID_gone(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);(base/'operation.json').write_bytes(b'op');(base/'retire-source-stop-intent.json').write_bytes(b'intent')
            actor={'processes':[{'pid':os.getpid(),'startTicks':1}]}; op={'source':{'sdkActor':actor}}
            intent={'operationSha256':m.sha(b'op'),'bootId':'boot'}
            h=types.SimpleNamespace(b=types.SimpleNamespace(BASE=base,SOURCE=m.SOURCE,document=lambda path:op if path.name=='operation.json' else intent,
                sha=m.sha,protected=lambda path:path.read_bytes(),boot=lambda:'boot'),state=lambda _: {'MainPID':'0'},terminal=lambda _:None)
            with patch.object(context,'known_gone') as gone:
                result=context.HostMixin.retained_current(h);gone.assert_called_once_with(actor['processes'])
                self.assertTrue(result['ownedTemporaryTerminal']);self.assertEqual(result['actors'],{})
                self.assertEqual(result['retirementIntentSha256'],m.sha(b'intent'))
                intent['operationSha256']='foreign'
                with self.assertRaises(RuntimeError):context.HostMixin.retained_current(h)

    def test_retained_restored_source_uses_real_step_result_wire(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);(base/'inverse-source-start-result.json').write_bytes(b'actual')
            expected={'sdkActor':{'new':'fresh-epoch'}}; observed=[]
            h=types.SimpleNamespace(b=types.SimpleNamespace(BASE=base,SOURCE=m.SOURCE,document=lambda _: {'result':expected}),
                state=lambda _: {'MainPID':'12'},source_actor=lambda value:(observed.append(value) or expected))
            result=context.HostMixin.retained_current(h)
            self.assertEqual(observed,[expected]);self.assertEqual(result['actors'],{m.SOURCE:expected['sdkActor']})

    def test_genuine_new_event_is_hard_retirement_gate_only(self):
        h=types.SimpleNamespace(selected=lambda:{'switchBoundary':100},h=types.SimpleNamespace())
        fake=types.SimpleNamespace(query=Mock(),native=Mock())
        for event in [None,{'blockNumber':100,'blockHash':'0x'+'1'*64,'transactionHash':'0x'+'2'*64,'logIndex':0}]:
            with self.assertRaises((RuntimeError,TypeError)):m.HistoricalHost.fresh_event(fake,event,100)
        event={'blockNumber':101,'blockHash':'0x'+'1'*64,'transactionHash':'0x'+'2'*64,'logIndex':0}
        fake.query.return_value={'left':1,'right':1,'canonical':event['blockHash']}
        self.assertEqual(m.HistoricalHost.fresh_event(fake,event,100),event)
        fake.query.return_value={'left':0,'right':1,'canonical':event['blockHash']}
        with self.assertRaises(RuntimeError):m.HistoricalHost.fresh_event(fake,event,100)
        self.assertNotIn('fresh_event',m.Owner.switch_review.__code__.co_names)
        self.assertIn('fresh_event',m.Owner.retirement_review.__code__.co_names)

    def test_known_live_process_epoch_cannot_be_called_terminal(self):
        pid=os.getpid();raw=(Path('/proc')/str(pid)/'stat').read_text();ticks=int(raw[raw.rfind(')')+2:].split()[19])
        with self.assertRaisesRegex(RuntimeError,'still_alive'):context.known_gone([{'pid':pid,'startTicks':ticks}])
        context.known_gone([{'pid':pid,'startTicks':ticks+1}])

    def test_phase_stdout_retains_private_packet_only_in_owned_observation_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);stdout=io.StringIO();secret='synthetic_private_packet_not_exported'
            def phase():print(json.dumps({'reviewHash':'a'*64,'privateActor':secret,'serviceActions':0}))
            with patch.object(wrapper,'INPUT',root/'config.json'),patch.object(wrapper,'runtime',return_value=types.SimpleNamespace(main=phase)),\
                 patch('sys.argv',['owner','--manifest-sha','b'*64]),contextlib.redirect_stdout(stdout):wrapper.main()
            result=json.loads(stdout.getvalue());self.assertNotIn(secret,stdout.getvalue());self.assertEqual(result['reviewHash'],'a'*64)
            files=list((root/'observations').iterdir());self.assertEqual(len(files),1)
            self.assertEqual(json.loads(files[0].read_bytes())['privateActor'],secret)
            self.assertEqual(result['privateObservationSha256'],wrapper.sha(files[0].read_bytes()))
            self.assertEqual(files[0].stat().st_mode&0o777,0o600)

    def test_manifest_requires_real_new_reader_and_provider_files(self):
        builder=load('ypal-ordinary-feature-v5-manifest.py')
        with tempfile.TemporaryDirectory() as folder,self.assertRaises(FileNotFoundError):builder.build(Path(folder))

    def test_atomic_boot_move_refuses_racing_destination_and_preserves_both_inodes(self):
        with tempfile.TemporaryDirectory()as folder:
            source,target=Path(folder)/'original.boot',Path(folder)/'racing.boot'
            source.symlink_to('/etc/systemd/system/'+m.SOURCE);prior=source.lstat().st_ino
            target.symlink_to('/etc/systemd/system/foreign.service');foreign=target.lstat().st_ino
            with self.assertRaises(FileExistsError):wrapper.rename_no_replace(source,target)
            self.assertEqual(source.lstat().st_ino,prior);self.assertEqual(target.lstat().st_ino,foreign)
            self.assertEqual(os.readlink(target),'/etc/systemd/system/foreign.service')
            target.unlink();wrapper.rename_no_replace(source,target)
            self.assertFalse(os.path.lexists(source));self.assertEqual(target.lstat().st_ino,prior)


if __name__=='__main__':unittest.main()
