import contextlib
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('owned_stop', Path(__file__).with_name('source6-base-priority-inspect-stop.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class OwnedStop(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name); self.actions = []
        self.b = types.SimpleNamespace(BASE=root, AREA=root, PAUSE_SHA='pause', RPC_SHA=m.sha(b'rpc'))
        self.s = types.SimpleNamespace(UNIT='source.service', ORIGINAL=root/'source.service', DROP=root/'90-heap.conf',
            UNIT_SHA=m.sha(b'original'), SCHEMA='retained_schema', BUILD='retained_build', OLD_INVOCATION='b'*32,
            SOURCE_LEASE='fixed-source-lock', argv=lambda:['env','-i','node','--env-file=retained'],
            drop_bytes=lambda:b'heap', protected=lambda p:Path(p).read_bytes(), job=lambda:0,
            lease=lambda _:contextlib.nullcontext(), now=lambda:'2026-10-22T17:05:00Z')
        self.b.drop_path = lambda _:root/'95-base.conf'
        self.b.bindings = lambda _:['BindReadOnlyPaths=/fixed/rpc:/retained/rpc /fixed/historical:/retained/historical']
        self.b.runtime_limit = lambda _:600_000_000
        self.identity = {'pid':12345,'startTicks':123,'invocation':'a'*32,'startMonotonicMicroseconds':m.DEADLINE-600_000_000}
        command = self.s.argv(); command.insert(3,'--max-old-space-size=4096')
        self.state = {'MainPID':'12345','ActiveState':'active','SubState':'running','InvocationID':'a'*32,
            'ExecMainStartTimestampMonotonic':str(self.identity['startMonotonicMicroseconds']),
            'command':' '.join(command),'DropInPaths':str(self.s.DROP)+' '+str(self.b.drop_path(self.s)),
            'MemoryMax':'6442450944','MemorySwapMax':'0','Restart':'no','LimitCORE':'0'}
        self.s.unit = lambda:dict(self.state); self.s.process_identity = lambda _:dict(self.identity)
        self.s.save = lambda p,v:Path(p).write_text(json.dumps(v))
        def run(argv, **_):
            self.actions.append(argv)
            self.state.update(MainPID='0',ActiveState='inactive',SubState='dead',InvocationID='',ExecMainStartTimestampMonotonic='0')
            return b''
        self.s.run = run
        drop = ('[Service]\nRuntimeMaxSec=600\nBindReadOnlyPaths=\n'+'\n'.join(self.b.bindings(self.s))+'\n').encode()
        self.intent = {'operatorSha256':m.RESUME_SHA,'pauseReceiptSha256':self.b.PAUSE_SHA,
            'preparedReceiptSha256':m.PREPARED_SHA,'rpcSha256':self.b.RPC_SHA,
            'originalDeadlineMonotonicMicroseconds':m.DEADLINE,'baseSourceConcurrency':1,'windowExtension':False,
            'freeOnly':True,'paidAuthority':False,'schema':self.s.SCHEMA,'buildId':self.s.BUILD,
            'remainingRuntimeSeconds':600,'dropSha256':m.sha(drop)}
        for path,raw in [(self.s.ORIGINAL,b'original'),(self.s.DROP,b'heap'),(self.b.drop_path(self.s),drop),(root/'rpc-preflight.ts',b'rpc')]:path.write_bytes(raw)
        (root/'resume-intent.json').write_text(json.dumps(self.intent))
        (root/'runtime.json').write_text(json.dumps({'dropSha256':m.sha(drop),'rpcSha256':self.b.RPC_SHA,
            'originalDeadlineMonotonicMicroseconds':m.DEADLINE,'windowExtension':False,'runtime':self.identity}))
        self.intent_sha = m.sha((root/'resume-intent.json').read_bytes())

    def test_wrong_invocation_never_stops_or_writes(self):
        with self.assertRaisesRegex(RuntimeError,'only_exact_owned_invocation'):
            m.stop(self.b,self.s,'c'*32,self.intent_sha)
        self.assertEqual(self.actions,[])
        self.assertFalse((self.b.BASE/'priority-stop-intent.json').exists())

    def test_wrong_files_or_extra_drop_fail_before_stop(self):
        for change in ['file','drop']:
            with self.subTest(change=change):
                if change=='file': self.s.ORIGINAL.write_bytes(b'foreign')
                else:self.s.ORIGINAL.write_bytes(b'original');self.state['DropInPaths']+=' /foreign.conf'
                with self.assertRaises(RuntimeError):m.stop(self.b,self.s,'a'*32,self.intent_sha)
                self.assertEqual(self.actions,[])

    def test_owned_stop_accepts_systemd_gc_and_preserves_files(self):
        before={p.name:p.read_bytes()for p in self.b.BASE.iterdir()if p.is_file()}
        with patch.object(m,'gone',return_value=True):result=m.stop(self.b,self.s,'a'*32,self.intent_sha)
        self.assertTrue(result['stopped'])
        self.assertEqual(result['beforeState']['ActiveState'],'active')
        self.assertEqual(result['state']['ActiveState'],'inactive')
        self.assertEqual(result['state']['MainPID'],'0')
        self.assertEqual(result['serviceActionsThisCall'],1)
        self.assertFalse(result['stopPreviouslyRequested'])
        self.assertEqual(self.actions,[['/usr/bin/systemctl','stop','source.service']])
        for name,raw in before.items():self.assertEqual((self.b.BASE/name).read_bytes(),raw)

    def test_uncertain_start_ack_can_be_stopped_from_exact_intent(self):
        (self.b.BASE/'runtime.json').unlink()
        with patch.object(m,'gone',return_value=True):result=m.stop(self.b,self.s,'a'*32,self.intent_sha)
        self.assertTrue(result['stopped']);self.assertFalse(result['runtimeReceiptExists'])

    def test_uncertain_stop_ack_finishes_without_second_stop(self):
        run=self.s.run
        def uncertain(argv,**kw):run(argv,**kw);raise RuntimeError('ack_uncertain')
        self.s.run=uncertain
        with self.assertRaisesRegex(RuntimeError,'ack_uncertain'):m.stop(self.b,self.s,'a'*32,self.intent_sha)
        with patch.object(m,'gone',return_value=True):result=m.stop(self.b,self.s,'a'*32,self.intent_sha)
        self.assertTrue(result['stopped']);self.assertEqual(len(self.actions),1)
        self.assertEqual(result['state']['ActiveState'],'inactive')
        self.assertEqual(result['serviceActionsThisCall'],0)
        self.assertTrue(result['stopPreviouslyRequested'])

    def test_stopped_foreign_process_or_job_is_rejected(self):
        p={**self.state,'MainPID':'0','ActiveState':'inactive','SubState':'dead','InvocationID':'','ExecMainStartTimestampMonotonic':'0'}
        m.stopped(p,self.identity,0,True)
        for job,absent in [(1,True),(0,False)]:
            with self.assertRaisesRegex(RuntimeError,'owned_source_stop_not_terminal'):m.stopped(p,self.identity,job,absent)


if __name__=='__main__':unittest.main()
