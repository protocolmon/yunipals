import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('readers_config', HERE / 'configure-reader-services.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def parse_env(raw):
    return dict(shlex.split(line)[0].split('=', 1) for line in raw.decode().splitlines() if line)


class ReaderConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=HERE)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'project'
        (self.project / 'node_modules/@esbuild/linux-x64/bin').mkdir(parents=True)
        (self.project / 'node_modules/@esbuild/linux-x64/bin/esbuild').write_bytes(b'fixture')
        (self.project / 'node_modules/esbuild').mkdir()
        (self.project / 'node_modules/esbuild/package.json').write_text('{"version":"0.25.12"}')
        self.inline = []
        self.private = self.root / 'private.env'
        self.private.write_text('API_ISLAND_STAKING_ENABLED=true\nDATABASE_URL=fixture-private\n')
        self.second = self.root / 'second.env'
        self.second.write_text('FIXTURE_ORDER=second\n')
        self.old = {}
        for name, (unit, role, port) in M.PEERS.items():
            fragment = self.root / unit
            fragment.write_text('[Service]\nExecStart=retained\n')
            self.old[name] = {'unit': {'FragmentPath': str(fragment), 'DropInPaths': '',
                'EnvironmentFiles': 'fixture', 'ActiveState': 'inactive',
                **{k: '' for k in ('ExecStartPre','ExecStartPost','ExecStop','ExecStopPost','ExecReload')}},
                'definitions': {str(fragment): M.sha(fragment.read_bytes())},
                'inlineEnvironmentSha256': M.sha(encoded(self.inline)),
                'privateInputHashes': {str(p): M.sha(p.read_bytes()) for p in (self.private,self.second)},
                'effectiveEnvironmentSha256': M.sha(encoded({**parse_env(self.private.read_bytes()), **parse_env(self.second.read_bytes())}))}
        primitives = types.SimpleNamespace(ROOT=self.root, PROJECT=self.project,
            protected=lambda p: Path(p).read_bytes(), parse_env=parse_env,
            env_bytes=lambda env: ''.join(k+'='+shlex.quote(v)+'\n' for k,v in sorted(env.items())).encode(),
            ordered_files=lambda _: [(str(self.private),False),(str(self.second),False)],
            service_property=lambda *args: self.inline)
        self.context = types.SimpleNamespace(host=types.SimpleNamespace(m=primitives), main=types.SimpleNamespace(TARGET=M.MAIN.parent.parent))
        source = HERE.parent / 'unified-indexer-transition/ypal-native-cutover-proof-v1.py'
        tree = ast.parse(source.read_text())
        function = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='render_reader')
        peers = {name: {'unit':unit,'role':role,'port':port,'previewPort':port+100,
                 'entry':'apps/yunipals-indexer/lib/api/'+('collector-server.ts' if name=='collector' else 'islands-server.ts')} for name,(unit,role,port) in M.PEERS.items()}
        namespace = {'Path':Path,'need':M.need,'sha':M.sha,'encoded':encoded,'re':re,'os':os,'pwd':pwd,'json':json,'urlencode':urlencode,
            'PEERS':peers,'PHYSICAL':M.PHYSICAL,'READ':M.READ,'RELEASE':M.RELEASE,'NODE':'/opt/node-v24.18.1/bin/node'}
        exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
        self.proof = types.SimpleNamespace(render_reader=namespace['render_reader'])
        self.user = patch.object(pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=123,pw_gid=123,pw_shell='/usr/sbin/nologin'))
        self.groups = patch.object(os,'getgrouplist',return_value=[123])
        self.user.start();self.groups.start()
        self.addCleanup(self.user.stop);self.addCleanup(self.groups.stop)

    def test_genuine_renderer_accepts_stopped_readers_and_preserves_private_order(self):
        value=M.configuration(self.context,self.proof,self.old)
        self.assertEqual(len(value),3)
        for name,row in value.items():
            self.assertFalse(row['preview'])
            self.assertEqual(row['expected']['selectors'][:2],[{'path':str(p),'optional':False} for p in (self.private,self.second)])
            self.assertNotIn('fixture-private',str(row))
            self.assertIn('yunipals_ownership_4e77f52b_v5',str(row))
        self.assertEqual(value['main']['expected']['argv'][-1],str(M.MAIN))

    def test_private_file_or_old_definition_drift_refuses(self):
        self.private.write_text('API_ISLAND_STAKING_ENABLED=true\nDATABASE_URL=changed\n')
        with self.assertRaises(RuntimeError):M.configuration(self.context,self.proof,self.old)

    def test_wrong_v4_renderer_and_old_main_artifact_refuse(self):
        original=self.proof.render_reader
        def wrong(c,n,o,p):
            v=original(c,n,o,p)
            for path,row in v['files'].items():
                if path.endswith('.selectors.env'):row['text']=row['text'].replace(M.READ,'yunipals_ownership_4e77f52b_v4')
            return v
        with self.assertRaisesRegex(RuntimeError,'V5'):M.configuration(self.context,types.SimpleNamespace(render_reader=wrong),self.old)
        self.context.main.TARGET=Path('/old/main')
        with self.assertRaisesRegex(RuntimeError,'latest-complete'):M.configuration(self.context,self.proof,self.old)

    def test_install_rejects_unowned_target_before_writing(self):
        rows=M.configuration(self.context,self.proof,self.old)
        rows['main']['files']['/etc/unrelated.env']={'text':'x','mode':0o644}
        with self.assertRaises(RuntimeError):M.install(rows,Mock(),self.root/'backup')
        self.assertFalse((self.root/'backup').exists())

    def test_real_install_backs_up_nine_files_and_uses_exclusive_unique_records(self):
        rows=M.configuration(self.context,self.proof,self.old)
        def relocated(value):
            text=str(value)
            return self.root / text.lstrip('/') if text.startswith('/etc/') else Path(value)
        for descriptor in rows.values():
            for name in descriptor['files']:
                path=relocated(name)
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_bytes(b'old-config\n')
        journal=self.root/'journal'
        journal.mkdir()
        def record(name,value):
            with open(journal/name,'x') as stream:stream.write(json.dumps(value))
        with patch.object(M,'Path',side_effect=relocated):
            value=M.install(rows,record,self.root/'backup')
        self.assertEqual(value['readerFilesInstalled'],9)
        self.assertFalse(value['servicesStarted'])
        self.assertEqual(len(list(journal.iterdir())),18)
        self.assertEqual(len(list((self.root/'backup').iterdir())),9)
        for descriptor in rows.values():
            for name,row in descriptor['files'].items():
                self.assertEqual(relocated(name).read_text(),row['text'])
                self.assertEqual(relocated(name).stat().st_mode & 0o777,row['mode'])

    def test_actual_cold_operands_load_only_public_code_and_stopped_settings(self):
        ops=self.root/'ops'
        ops.mkdir()
        original=HERE.parent/'unified-indexer-transition'
        for name in ('retained-workers-stage-v1.py','ypal-native-cutover-proof-v1.py'):
            (ops/name).write_bytes((original/name).read_bytes())
        tree=ast.parse((original/'ypal-native-cutover-proof-v1.py').read_text())
        fields=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign) and
                                    any(isinstance(t,ast.Name) and t.id=='STATE_PROPERTIES' for t in n.targets)))
        calls=[]
        def readonly(args,**kwargs):
            calls.append(args)
            if args[0]=='/usr/bin/busctl':
                body=json.dumps({'type':'as','data':[]}).encode()
            else:
                self.assertEqual(args[:3],['/usr/bin/systemctl','show','--all'])
                name=next(n for n,p in M.PEERS.items() if p[0]==args[3])
                settings={key:'' for key in fields}
                settings.update(self.old[name]['unit'],Id=args[3],LoadState='loaded',MainPID='0',ControlPID='0',
                                EnvironmentFiles=' '.join(str(p)+' (ignore_errors=no)' for p in (self.private,self.second)))
                body=''.join(key+'='+settings[key]+'\n' for key in fields).encode()
            return types.SimpleNamespace(returncode=0,stderr=b'',stdout=body)
        with patch.object(M,'OPS',ops),patch.object(subprocess,'run',side_effect=readonly):
            context,proof,captured=M.operands()
        self.assertEqual(proof.READ,M.READ)
        self.assertEqual(context.main.TARGET,M.MAIN.parent.parent)
        self.assertEqual(len(calls),15)
        self.assertEqual(set(captured),set(M.PEERS))
        for old in captured.values():
            self.assertEqual(old['unit']['MainPID'],'0')
            self.assertEqual(old['unit']['ActiveState'],'inactive')
            self.assertEqual(old['privateInputHashes'],{str(p):M.sha(p.read_bytes()) for p in (self.private,self.second)})

    def test_actual_omitted_empty_hook_arrays_require_exact_dbus_empty_shape(self):
        source=HERE.parent/'unified-indexer-transition/ypal-native-cutover-proof-v1.py'
        tree=ast.parse(source.read_text())
        fields=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign) and
                                    any(isinstance(t,ast.Name) and t.id=='STATE_PROPERTIES' for t in n.targets)))
        proof=types.SimpleNamespace(STATE_PROPERTIES=fields)
        unit=M.PEERS['main'][0]
        omitted={'ExecReload','ExecStartPost','ExecStartPre','ExecStop','ExecStopPost'}
        settings={key:'' for key in fields if key not in omitted}
        settings.update(Id=unit,LoadState='loaded',ActiveState='inactive',MainPID='0')
        reply={'type':'a(sasbttttuii)','data':[]}
        calls=[]
        def read(args):
            calls.append(args)
            if args[0]=='/usr/bin/busctl':
                self.assertIn(args[-1],omitted)
                return json.dumps(reply).encode()
            return ''.join(k+'='+v+'\n' for k,v in settings.items()).encode()
        primitive=types.SimpleNamespace(run=read)
        result=M._loaded_reader_state(primitive,proof,unit)
        self.assertEqual({key:result[key] for key in omitted},{key:'' for key in omitted})
        self.assertEqual(len(calls),6)
        reply['data']=[['/bin/true']]
        with self.assertRaisesRegex(RuntimeError,'D-Bus'):M._loaded_reader_state(primitive,proof,unit)
        reply.update(type='as',data=[])
        with self.assertRaisesRegex(RuntimeError,'D-Bus'):M._loaded_reader_state(primitive,proof,unit)
        reply.update(type='a(sasbttttuii)',data=[])
        settings.pop('Id')
        with self.assertRaisesRegex(RuntimeError,'non-hook'):M._loaded_reader_state(primitive,proof,unit)

    def test_cold_renderer_omits_only_unused_compiler_tail_and_preserves_full_configuration(self):
        expected=M.configuration(self.context,self.proof,self.old)
        for row in expected.values():
            del row['expected']['esbuildExecutable']
            del row['expected']['esbuildCommandSha256']
        source=HERE.parent/'unified-indexer-transition/ypal-native-cutover-proof-v1.py'
        namespace=types.ModuleType('fresh_cold_renderer_fixture')
        namespace.__dict__.update(self.proof.render_reader.__globals__)
        namespace.render_reader=M._cold_renderer(namespace,source.read_bytes())
        shutil.rmtree(self.project/'node_modules')
        actual=M.configuration(self.context,namespace,self.old)
        self.assertEqual(actual,expected)
        with self.assertRaisesRegex(RuntimeError,'exact original'):
            M._cold_renderer(namespace,source.read_bytes()+b'changed')


if __name__=='__main__':unittest.main()
