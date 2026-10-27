import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


m = load('normal_successor', HERE / 'source6-normal-replay-successor.py')
fixture_module = load('owned_stop_fixture', HERE / 'source6-base-priority-inspect-stop.test.py')


class NormalSuccessor(unittest.TestCase):
    def setUp(self):
        fixture = fixture_module.OwnedStop(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        self.fixture = fixture; self.r = fixture_module.m; self.b = fixture.b; self.s = fixture.s
        self.fixture.state['NRestarts']='0'
        self.root = self.b.BASE; self.actions = []; self.queries = []; self.catalog = {
            'schemaOid':'73004622','tables':[['retained','123','73004621']],
            'cacheTables':[['ponder_sync','intervals','17993']]}
        self.normal_identity = {**fixture.identity,'pid':54321,'startTicks':456,'invocation':'d'*32,
                                'startMonotonicMicroseconds':fixture.identity['startMonotonicMicroseconds']+30_000_000}
        self.patch(m,'BASE',self.root/'normal-receipts')
        self.patch(m,'BOUND_IDENTITY',dict(fixture.identity))
        self.patch(m,'NATIVE_SHA',m.sha(m.encode(self.catalog)))
        self.patch(m,'drop',lambda _:self.root/'normal-drop'/'99-normal.conf')
        self.patch(m,'boot_link',lambda _:self.root/'wants'/'source.service')
        self.patch(m,'protected_directory',lambda _:None)
        m.boot_link(self.s).parent.mkdir()
        self.b.PAUSED = self.root/'pause.json'; self.b.PAUSED.write_bytes(b'pause')
        self.b.PAUSE_SHA = m.sha(b'pause')
        prepared = {'prepared':True,'sourceStarted':False,
                    'sameBuildProof':{'buildId':self.s.BUILD,'baseSourceConcurrency':1}}
        (self.root/'prepared.json').write_bytes(m.encode(prepared))
        self.patch(self.r,'PREPARED_SHA',m.sha(m.encode(prepared)))
        fixture.intent.update(pauseReceiptSha256=self.b.PAUSE_SHA,preparedReceiptSha256=self.r.PREPARED_SHA)
        (self.root/'resume-intent.json').write_bytes(m.encode(fixture.intent))
        self.patch(m,'INTENT_SHA',m.sha(m.encode(fixture.intent)))
        bound = json.loads((self.root/'runtime.json').read_text())
        bound['expiresMonotonicMicroseconds'] = self.r.DEADLINE-1
        (self.root/'runtime.json').write_bytes(m.encode(bound))
        self.patch(m,'BOUND_SHA',m.sha(m.encode(bound)))
        self.virtual = {
            m.OPS/'source6-base-priority-inspect-stop.py':(HERE/'source6-base-priority-inspect-stop.py').read_bytes(),
            m.OPS/'source6-base-priority-resume.py':(HERE/'source6-base-priority-resume.py').read_bytes(),
            m.CANDIDATE:(HERE/'source6-normal-replay-successor.conf.example').read_bytes()}
        self.s.protected = lambda path:self.virtual[Path(path)] if Path(path)in self.virtual else Path(path).read_bytes()
        self.s.inputs = lambda:{'sourceDigest':'source008'}
        self.s.resources = lambda:{'memoryAvailableBytes':20_000_000_000,'rootAvailableBytes':60_000_000_000}
        self.s.financial = lambda:{'profile':True,'activePermits':0,'profilePermitRows':2}
        self.s.proxies = lambda:{'fourFreeOnlyProxies':'unchanged'}
        self.s.database = lambda running:{'sourceSessions':8,'checkpoints':self.points()}
        self.s.http = lambda *args:b''
        self.extras = {k:'' for k in m.EXTRA}
        self.extras.update(RestartUSec='100ms',StartLimitIntervalUSec='10s',StartLimitBurst='5',
            BindReadOnlyPaths='/qualified/base1:/retained/rpc:rbind /qualified/historical:/retained/historical:rbind',
            ReadWritePaths='/retained/.ponder /retained/ponder-env.d.ts',NoNewPrivileges='yes',
            ProtectSystem='strict',ProtectHome='yes',PrivateTmp='yes',RestrictSUIDSGID='yes')
        self.prior_extras = dict(self.extras)
        original_unit = self.s.unit
        self.s.unit = lambda name=None:original_unit() if name is None else {
            'ActiveState':'active','SubState':'running','MainPID':'43210','InvocationID':'e'*32,
            'FragmentPath':str(self.root/'booster.service')}
        (self.root/'booster.service').write_bytes(b'unchanged-booster')
        self.s.save = lambda path,value:m.write_new(path,m.encode(value)) or m.sha(m.encode(value))
        self.s.query = self.query
        self.s.run = self.command
        self.r.gone = lambda identity:self.fixture.state['MainPID'] != str(identity['pid'])
        self.infinity_override = None
        self.memory_override = None
        self.heap_override = None

    def patch(self, obj, name, value):
        patcher=patch.object(obj,name,value);patcher.start();self.addCleanup(patcher.stop)

    @staticmethod
    def points(value='5'):
        return [{'chain':chain,'latest':value*75,'safe':value*75,'finalized':value*75}for chain in[1,56,137,8453]]

    def query(self, sql, market=False):
        self.queries.append(sql)
        self.assertTrue(sql.startswith('SELECT '))
        if market:return {'enabled':True,'expiresAt':m.PROFILE_EXPIRY,'profileId':self.s.PROFILE_ID,
                          'scope':'yunipals-opensea','manifest':self.s.MANIFEST}
        return self.catalog

    def command(self, argv, **kwargs):
        if 'show'in argv:
            return ('\n'.join(k+'='+v for k,v in self.extras.items())+'\n').encode()
        self.actions.append(argv)
        if 'stop'in argv:
            self.fixture.state.update(MainPID='0',ActiveState='inactive',SubState='dead',
                                      InvocationID='',ExecMainStartTimestampMonotonic='0')
        elif 'daemon-reload'in argv:
            exists=m.drop(self.s).exists()
            self.fixture.state.update(RuntimeMaxUSec=(self.infinity_override or 'infinity')if exists else '10min',
                Restart='on-failure'if exists else 'no',DropInPaths=' '.join([str(self.s.DROP),str(self.b.drop_path(self.s))]+([str(m.drop(self.s))]if exists else [])))
            if exists and self.memory_override:self.fixture.state['MemoryMax']=self.memory_override
            if exists and self.heap_override:self.fixture.state['command']=self.fixture.state['command'].replace('--max-old-space-size=4096',self.heap_override)
            self.extras=dict(self.prior_extras)
            if exists:self.extras.update(RestartUSec='15s',StartLimitIntervalUSec='5min')
        elif 'start'in argv:
            self.assertEqual(self.fixture.state['RuntimeMaxUSec'],'infinity')
            self.fixture.identity=dict(self.normal_identity)
            self.fixture.state.update(MainPID=str(self.normal_identity['pid']),ActiveState='active',SubState='running',
                InvocationID=self.normal_identity['invocation'],ExecMainStartTimestampMonotonic=str(self.normal_identity['startMonotonicMicroseconds']))
        elif 'is-enabled'in argv:return b'enabled'if m.boot_link(self.s).is_symlink()else b'static'
        return b''

    def configure_constants(self):
        self.s.PROFILE_ID='fixed-profile';self.s.MANIFEST='fixed-manifest'

    def reviewed(self):
        self.configure_constants();return m.review(self.r,self.b,self.s)

    def test_exact_actual_runtime_apply_and_owned_inverse(self):
        checked=self.reviewed()
        old={path:path.read_bytes()for path in[self.s.ORIGINAL,self.s.DROP,self.b.drop_path(self.s)]}
        result=m.apply(self.r,self.b,self.s,checked['reviewHash'])
        self.assertTrue(result['started']);self.assertFalse(result['financialWindowRenewed'])
        self.assertTrue(result['priorOperationalCutoffExplicitlySuperseded'])
        self.assertEqual(result['normalOperationalRuntime'],'infinity')
        self.assertEqual(result['heapMiB'],4096);self.assertEqual(result['memoryMaxBytes'],6442450944)
        self.assertEqual(result['baseSourceConcurrency'],1)
        m.validate(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        restored=m.restore(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        self.assertTrue(restored['sourceRemainsStopped']);self.assertFalse(restored['expiredFiniteSourceRestarted'])
        self.assertFalse(m.drop(self.s).exists());self.assertFalse(m.boot_link(self.s).exists())
        for path,raw in old.items():self.assertEqual(path.read_bytes(),raw)
        self.assertEqual(len([a for a in self.actions if 'start'in a]),1)
        self.assertFalse(result['schemaCacheAndCheckpointsReset'])

    def test_foreign_prior_invocation_or_extra_drop_rejected(self):
        self.configure_constants()
        for variant in ['invocation','drop']:
            with self.subTest(variant=variant):
                if variant=='invocation':self.fixture.identity['invocation']='f'*32
                else:self.fixture.identity['invocation']=m.BOUND_IDENTITY['invocation'];self.fixture.state['DropInPaths']+=' /foreign.conf'
                with self.assertRaises(RuntimeError):m.review(self.r,self.b,self.s)
                self.assertFalse(m.BASE.exists());self.assertEqual(self.actions,[])

    def test_changed_input_or_new_native_namespace_rejected(self):
        self.configure_constants()
        original=self.s.ORIGINAL.read_bytes();self.s.ORIGINAL.write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError,'exact_acknowledged_successor_inputs'):m.review(self.r,self.b,self.s)
        self.s.ORIGINAL.write_bytes(original);self.catalog['schemaOid']='foreign'
        with self.assertRaisesRegex(RuntimeError,'retained_native_namespace'):m.review(self.r,self.b,self.s)
        self.assertEqual(self.actions,[])

    def test_loaded_zero_is_rejected_before_start(self):
        checked=self.reviewed();self.infinity_override='0'
        with self.assertRaisesRegex(RuntimeError,'exact_loaded_infinite'):m.apply(self.r,self.b,self.s,checked['reviewHash'])
        self.assertEqual(len([a for a in self.actions if 'start'in a]),0)

    def test_wrong_loaded_memory_is_rejected_before_start(self):
        checked=self.reviewed();self.memory_override='2147483648'
        with self.assertRaisesRegex(RuntimeError,'exact_loaded_infinite'):m.apply(self.r,self.b,self.s,checked['reviewHash'])
        self.assertFalse(any('start'in a for a in self.actions))

    def test_wrong_loaded_heap_is_rejected_before_start(self):
        checked=self.reviewed();self.heap_override='--max-old-space-size=1024'
        with self.assertRaisesRegex(RuntimeError,'exact_loaded_infinite'):m.apply(self.r,self.b,self.s,checked['reviewHash'])
        self.assertFalse(any('start'in a for a in self.actions))

    def test_base1_proof_and_transport_cannot_change(self):
        self.configure_constants();(self.b.AREA/'rpc-preflight.ts').write_bytes(b'changed-gate')
        with self.assertRaisesRegex(RuntimeError,'exact_acknowledged_successor_inputs'):m.review(self.r,self.b,self.s)
        self.assertEqual(self.actions,[])

    def test_loaded_configuration_failure_has_owned_inactive_inverse(self):
        checked=self.reviewed();self.infinity_override='0'
        with self.assertRaises(RuntimeError):m.apply(self.r,self.b,self.s,checked['reviewHash'])
        intent=m.sha((m.BASE/'intent.json').read_bytes())
        restored=m.restore(self.r,self.b,self.s,intent)
        self.assertEqual(restored['serviceActionsThisCall'],0)
        self.assertFalse(m.drop(self.s).exists());self.assertFalse(m.boot_link(self.s).exists())
        self.assertFalse(any('start'in a for a in self.actions))

    def test_start_changes_actual_state_then_loses_ack_reconciles_without_restart(self):
        checked=self.reviewed();command=self.s.run
        def uncertain_start(argv,**kwargs):
            answer=command(argv,**kwargs)
            if 'start'in argv:raise RuntimeError('start_ack_uncertain')
            return answer
        self.s.run=uncertain_start
        boundary=self.normal_identity['startMonotonicMicroseconds']-1_000_000
        with patch.object(m.time,'monotonic_ns',return_value=boundary*1000):
            with self.assertRaisesRegex(RuntimeError,'start_ack_uncertain'):m.apply(self.r,self.b,self.s,checked['reviewHash'])
        self.assertTrue((m.BASE/'start-intent.json').exists())
        self.assertFalse((m.BASE/'started.json').exists());self.assertFalse((m.BASE/'runtime.json').exists())
        intent=m.sha((m.BASE/'intent.json').read_bytes());self.s.run=command
        with patch.object(m,'actor',return_value={'cgroup':'/system.slice/source.service','uid':970,'gid':964,'capabilityFree':True}):
            proof=m.reconcile_start(self.r,self.b,self.s)
            count=len(self.actions)
            with self.assertRaisesRegex(RuntimeError,'exact_readonly_start_reconcile_hash'):
                m.restore(self.r,self.b,self.s,intent)
            self.assertEqual(len(self.actions),count)
            result=m.restore(self.r,self.b,self.s,intent,proof['reconcileHash'])
        self.assertTrue(result['sourceRemainsStopped'])
        self.assertEqual(len([a for a in self.actions if 'start'in a]),1)
        self.assertEqual(len([a for a in self.actions if 'stop'in a]),2)
        self.assertFalse(m.drop(self.s).exists());self.assertFalse(m.boot_link(self.s).exists())

    def test_failure_immediately_after_old_stop_has_zero_install_inverse(self):
        checked=self.reviewed()
        with patch.object(m,'preserved',side_effect=[RuntimeError('post_stop_check_failed'),None]):
            with self.assertRaisesRegex(RuntimeError,'post_stop_check_failed'):m.apply(self.r,self.b,self.s,checked['reviewHash'])
            self.assertFalse((m.BASE/'install-intent.json').exists());self.assertFalse(m.drop(self.s).exists())
            self.assertFalse((m.BASE/'start-intent.json').exists())
            intent=m.sha((m.BASE/'intent.json').read_bytes());result=m.restore(self.r,self.b,self.s,intent)
        self.assertTrue(result['sourceRemainsStopped']);self.assertEqual(result['serviceActionsThisCall'],0)
        self.assertEqual(len([a for a in self.actions if 'stop'in a]),1)
        self.assertFalse(any('start'in a for a in self.actions))

    def test_actor_uid_capabilities_and_cgroup_are_exact(self):
        identity={'pid':123}
        status={'Uid':'970 970 970 970','Gid':'964 964 964 964','Groups':'964',
                'NoNewPrivs':'1','CapInh':'0000000000000001','CapPrm':'0','CapEff':'0','CapAmb':'0'}
        self.patch(m,'INHERITABLE_CAPABILITY_SHA256',m.sha(status['CapInh'].encode()))
        group='/system.slice/source.service'
        m.actor_evidence(identity,'source.service',group,'0::'+group,status,[123])
        for changed in [{'Uid':'0 0 0 0'},{'Groups':'999'},{'CapEff':'1'},{'NoNewPrivs':'0'},{'CapInh':'0000000000000002'}]:
            with self.subTest(changed=changed):
                with self.assertRaisesRegex(RuntimeError,'exact_normal_source_actor'):
                    m.actor_evidence(identity,'source.service',group,'0::'+group,{**status,**changed},[123])
        with self.assertRaisesRegex(RuntimeError,'exact_normal_source_actor'):
            m.actor_evidence(identity,'source.service','/foreign','0::/foreign',status,[123])
        with self.assertRaisesRegex(RuntimeError,'exact_normal_source_actor'):
            m.actor_evidence(identity,'source.service',group,'0::'+group,status,[999])

    def test_gc_safe_terminal_predecessor_is_accepted(self):
        self.fixture.state.update(MainPID='0',ActiveState='inactive',SubState='dead',InvocationID='',ExecMainStartTimestampMonotonic='0')
        checked=self.reviewed();self.assertIsNone(checked['prior']['runtime'])
        result=m.apply(self.r,self.b,self.s,checked['reviewHash'])
        self.assertTrue(result['started']);self.assertFalse(any('stop'in a for a in self.actions))

    def test_foreign_normal_invocation_cannot_be_stopped(self):
        checked=self.reviewed();result=m.apply(self.r,self.b,self.s,checked['reviewHash'])
        before=len(self.actions);self.fixture.identity['invocation']='f'*32
        with self.assertRaisesRegex(RuntimeError,'exact_new_normal_source_invocation'):
            m.restore(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        self.assertEqual(len(self.actions),before);self.assertTrue(m.drop(self.s).exists())

    def test_foreign_boot_link_or_prior_file_rejects_before_stop(self):
        checked=self.reviewed();result=m.apply(self.r,self.b,self.s,checked['reviewHash'])
        before=len(self.actions);m.boot_link(self.s).unlink();m.boot_link(self.s).symlink_to('/foreign.service')
        with self.assertRaisesRegex(RuntimeError,'only_exact_owned_boot_link'):m.restore(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        self.assertEqual(len(self.actions),before)
        m.boot_link(self.s).unlink();m.boot_link(self.s).symlink_to(self.s.ORIGINAL)
        self.s.ORIGINAL.write_bytes(b'foreign')
        with self.assertRaisesRegex(RuntimeError,'prior_source_files'):m.restore(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        self.assertEqual(len(self.actions),before)

    def test_uncertain_owned_stop_finishes_without_repeat_stop(self):
        checked=self.reviewed();result=m.apply(self.r,self.b,self.s,checked['reviewHash'])
        command=self.s.run
        def uncertain(argv,**kwargs):
            answer=command(argv,**kwargs)
            if 'stop'in argv:raise RuntimeError('stop_ack_uncertain')
            return answer
        self.s.run=uncertain
        with self.assertRaisesRegex(RuntimeError,'stop_ack_uncertain'):m.restore(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        count=len([a for a in self.actions if 'stop'in a])
        self.s.run=command;restored=m.restore(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        self.assertEqual(restored['serviceActionsThisCall'],0)
        self.assertEqual(len([a for a in self.actions if 'stop'in a]),count)
        m.restore(self.r,self.b,self.s,result['runtimeReceiptSha256'])
        self.assertEqual(len([a for a in self.actions if 'stop'in a]),count)

    def test_checkpoint_or_build_reset_is_rejected(self):
        before={'catalogSha256':'same','schemaOid':'73004622','schema':self.s.SCHEMA,'buildId':self.s.BUILD,'checkpoints':self.points()}
        after={**before,'checkpoints':self.points('4')}
        with self.assertRaisesRegex(RuntimeError,'saved_native_checkpoint_regressed'):m.preserved(before,after)
        with self.assertRaisesRegex(RuntimeError,'native_namespace_or_build_changed'):m.preserved(before,{**before,'buildId':'new'})


if __name__=='__main__':unittest.main()
