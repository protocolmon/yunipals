#!/usr/bin/env python3
"""Actual owner methods with explicit synthetic peers and real no-replace files."""
import contextlib
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).absolute().parent


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


o = load(HERE / "ypal-alchemy-source-switch-v1.py", "actual_lifecycle")
p = load(HERE / "ypal-alchemy-source-switch-v1.plan.py", "actual_pure_plan")
leaf = load(HERE / "ypal-alchemy-primary-current-v1.py", "actual_quiet_leaf")


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix=".alchemy-lifecycle-", dir=HERE)
        self.root = Path(self.tmp.name); self.base = self.root / "audit"; self.hold = self.root / "hold"; self.stage = self.root / "stage"
        self.base.mkdir(mode=0o700); self.hold.mkdir(mode=0o700); self.stage.mkdir(mode=0o755)
        self.patches = [patch.object(o, "BASE", self.base), patch.object(o, "HOLD", self.hold), patch.object(p, "STAGE", self.stage)]
        for q in self.patches: q.start()
        self.calls = []; self.tick = 2000000
        self.m = types.SimpleNamespace(document=lambda file, digest=None: json.loads(p.read(file, digest)), protected=p.read,
            boot=lambda:"actual-synthetic-boot", mono=lambda:self.tick, command=lambda *args, **kwargs:None)
        self.original = {"unit":{"InvocationID":"old","After":"postgres network"}, "parent":{"pid":999001,"startTicks":1,"argv":["node","ponder.js"]},
                         "processes":[{"pid":999001,"startTicks":1}]}
        self.native = {"clock":50000,"app":{"heartbeat_at":"10000","is_locked":"0","build_id":"71e2a7f3b7","is_ready":"0"},
                       "schemaOid":"75963410","tables":{"synthetic":True},"cache":{"synthetic":True},
                       "checkpoints":{str(chain):{'latest':'1'*75,'safe':'1'*75,'finalized':'0'*75}for chain in p.CHAINS.values()}}
        self.op = {"format":o.FORMAT,"operatorSha256":"a"*64,"manifestSha256":"b"*64,"inputSha256":"c"*64,
                   "bootId":self.m.boot(),"financialPlan":{"synthetic":"plan"},"planSha256":"d"*64,"source":self.original,"native":self.native,
                   "chainRouting":{chain:p.proxy_mode(chain)for chain in p.CHAINS},
                   "overlays":{},"peers":{"fixture":True},"inputs":{"fixture":True},"sourceBoot":{"fixture":True}}
        self.c = types.SimpleNamespace(h=None,m=self.m,p=p,leaf=leaf,manifest_sha="b"*64,input_sha="c"*64,plan=self.op["financialPlan"],config={"planSha256":"d"*64})
        self.h = types.SimpleNamespace(manager=lambda verb,unit=None:self.calls.append((verb,unit)),restore=types.SimpleNamespace(canonical_actor=lambda x:x),
             source=types.SimpleNamespace(actor=lambda unit, terminal=False:None if terminal else self.original,native=lambda:copy.deepcopy(self.native)),
             source_sessions=lambda actor, retained_current=None:{o.FRESH:[]},r=types.SimpleNamespace(recovery_floor=lambda *args:True))
        self.c.h = self.h; self.owner = o.Owner(self.c); self.owner.producer=lambda:"a"*64
        self.c.source_subset=lambda actor:self.h.source_sessions(actor)
        self.c.private_current=lambda op:None
        self.c.proxy_environment=lambda chain,actor:{'fullMergedEnvironmentSyntheticFixture':True}
        self.owner.put("operation.json",self.op)
        self.owner.common=lambda:(self.owner.operation(),copy.deepcopy(self.native))
        self.owner.admission=lambda *args,**kwargs:'e'*64
        self.owner.verify_published_configuration=lambda:None
    def tearDown(self):
        for q in reversed(self.patches):q.stop()
        self.tmp.cleanup()
    def intent(self,name,**kwargs):self.owner.put(name,self.owner.record(**kwargs))

    def test_default_import_is_inactive_and_secret_free(self):
        value=subprocess.run([sys.executable,"-I","-B",str(HERE/"ypal-alchemy-source-switch-v1.py")],capture_output=True,check=True,text=True,timeout=5)
        row=json.loads(value.stdout);self.assertTrue(row['sourceOnly']);self.assertFalse(row['financialAdmitted'])
        self.assertEqual((row['databaseWrites'],row['serviceActions'],row['providerCalls']),(0,0,0));self.assertEqual(value.stderr,"")

    def test_records_are_real_exclusive_root_private_files(self):
        self.intent('fixed-intent.json',notBeforeUs=1)
        self.assertEqual((self.base/'fixed-intent.json').stat().st_mode&0o777,0o600)
        with self.assertRaises(FileExistsError):self.intent('fixed-intent.json',notBeforeUs=2)
        self.assertEqual(self.owner.journal('fixed-intent.json')['notBeforeUs'],1)

    def test_wrong_operation_or_boot_journal_refuses(self):
        self.intent('fixed.json');path=self.base/'fixed.json';v=json.loads(path.read_bytes());v['bootId']='foreign';path.unlink();p.exclusive(path,o.encoded(v))
        with self.assertRaisesRegex(RuntimeError,'same_operation'):self.owner.journal('fixed.json')

    def test_configuration_reload_intent_precedes_manager_and_is_never_reissued(self):
        def manager(verb,unit=None):
            self.assertTrue((self.base/'source-paid-reload-intent.json').exists());self.calls.append((verb,unit))
        self.h.manager=manager
        self.owner.reload('source-paid');self.owner.reload('source-paid')
        self.assertEqual(self.calls,[('daemon-reload',None)])

    def test_unknown_reload_does_not_automatically_repeat(self):
        self.intent('source-paid-reload-intent.json')
        with self.assertRaisesRegex(RuntimeError,'explicit_configuration'):self.owner.reload('source-paid')
        self.assertEqual(self.calls,[])

    def test_explicit_configuration_only_completion_still_authenticates_owned_files(self):
        self.intent('source-paid-reload-intent.json');self.owner.verify_published_configuration=lambda:self.calls.append(('verify',None))
        result=self.owner.complete_reload('source-paid')
        self.assertTrue(result['configurationReloadCompleted']);self.assertFalse(result['sourceOrProxyStartStopRepeated'])
        self.assertEqual(self.calls,[('verify',None),('daemon-reload',None)])
        with self.assertRaisesRegex(RuntimeError,'unacknowledged_configuration'):self.owner.complete_reload('source-paid')

    def test_publish_preserves_six_key_inode_and_refuses_racing_foreign_target(self):
        staged=self.hold/'ethereum.conf';raw=b'[Service]\n# synthetic exact artifact\n';record=p.exclusive(staged,raw,0o644)
        self.op['overlays']['ethereum']={'sha256':record['sha256'],'identity':o.six(record['identity'])}
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        target=self.root/'units'/'ethereum.conf';self.owner.publish('ethereum',target)
        self.assertEqual(leaf.file_identity(target),o.six(record['identity']));self.assertFalse(staged.exists())
        record=p.exclusive(self.hold/'base.conf',raw,0o644);self.op['overlays']['base']={'sha256':record['sha256'],'identity':o.six(record['identity'])}
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        foreign=target.parent/'base.conf';foreign.write_bytes(b'foreign');before=foreign.stat().st_ino
        with self.assertRaises(FileExistsError):self.owner.publish('base',foreign)
        self.assertEqual(foreign.read_bytes(),b'foreign');self.assertEqual(foreign.stat().st_ino,before)

    def test_overlay_removal_is_no_replace_and_retains_original_inode(self):
        target=self.root/'synthetic.conf';raw=b'[Service]\n';record=p.exclusive(target,raw,0o644)
        self.op['overlays']['source']={'sha256':record['sha256'],'identity':o.six(record['identity'])}
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.owner.remove_overlay('source',target);self.owner.remove_overlay('source',target)
        self.assertFalse(target.exists());self.assertEqual((self.hold/'source.removed.conf').stat().st_ino,record['identity']['st_ino'])

    def test_initial_source_stop_has_durable_intent_final_actor_CAS_and_once_manager(self):
        self.owner.terminal=lambda *args,**kwargs:{'terminal':True,'remainingWriterAttribution':{o.FRESH:[]},'sourceScanSha256':'f'*64}
        def manager(verb,unit=None):
            intent=self.owner.journal('source-initial-stop-intent.json');self.assertEqual(intent['actor'],self.original);self.calls.append((verb,unit))
        self.h.manager=manager
        self.owner.source_stop('initial');self.owner.source_stop('initial')
        self.assertEqual(self.calls,[('stop',o.SOURCE)])

    def test_source_actor_change_after_intent_refuses_stop(self):
        count=0
        def actor(unit,terminal=False):
            nonlocal count;count+=1
            return self.original if count==1 else {**self.original,'parent':{'pid':999002,'startTicks':2}}
        self.h.source.actor=actor
        with self.assertRaisesRegex(RuntimeError,'final_source_actor_CAS'):self.owner.source_stop('initial')
        self.assertEqual(self.calls,[]);self.assertTrue(self.owner.exists('source-initial-stop-intent.json'))

    def test_unknown_source_stop_is_observed_without_resend(self):
        self.intent('source-initial-stop-intent.json',actor=self.original,knownProcesses=self.original['processes'])
        self.owner.terminal=lambda *args,**kwargs:(_ for _ in()).throw(ValueError('explicit unresolved fixture'))
        with self.assertRaises(ValueError):self.owner.source_stop('initial')
        self.assertEqual(self.calls,[])

    def test_paid_source_stop_does_not_require_database_or_heartbeat_to_issue_stop(self):
        self.intent('source-paid-start-intent.json',notBeforeUs=1)
        self.h.source.state=lambda unit:{'MainPID':'999001'};self.h.source_epoch=lambda *args:(self.original,None)
        self.h.source_sessions=lambda *args:(_ for _ in()).throw(RuntimeError('database_unavailable_fixture'))
        self.owner.terminal=lambda *args,**kwargs:(_ for _ in()).throw(ValueError('DB remains unavailable so no terminal ACK'))
        with self.assertRaises(ValueError):self.owner.source_stop('paid')
        self.assertEqual(self.calls,[('stop',o.SOURCE)])
        row=self.owner.journal('source-paid-stop-intent.json');self.assertIsNone(row['sourceKernelSessions']);self.assertFalse(row['sessionObservationCurrent'])
        self.assertFalse(self.owner.exists('source-paid-stopped.json'))

    def test_all_known_pid_epochs_survive_PID_reuse_in_journal_union(self):
        other=copy.deepcopy(self.original);other['processes'][0]['startTicks']=2
        self.intent('source-paid-started.json',source=other)
        rows=self.owner.known_source_processes();self.assertEqual({(r['pid'],r['startTicks'])for r in rows},{(999001,1),(999001,2)})

    def test_known_escaped_actual_process_cannot_be_called_gone(self):
        path=Path('/proc')/str(os.getpid())/'stat';raw=path.read_text();ticks=int(raw[raw.rfind(')')+2:].split()[19])
        with self.assertRaisesRegex(RuntimeError,'still_exists_even_outside'):o.gone([{'pid':os.getpid(),'startTicks':ticks}])
        o.gone([{'pid':os.getpid(),'startTicks':ticks+1}])

    def test_financial_link_is_separate_exclusive_and_historical_not_active(self):
        self.owner.admission=types.MethodType(o.Owner.admission,self.owner)
        calls=[]
        def ack(digest):calls.append(('ack',digest));return {'validated':True,'planSha256':'d'*64}
        self.c.financial=types.SimpleNamespace(acknowledgement=ack,validate_current=lambda digest:(_ for _ in()).throw(RuntimeError('expired_fixture')))
        self.owner.admission('e'*64);self.owner.admission();self.assertNotIn('financialResultSha256',self.owner.operation())
        self.assertEqual(self.owner.journal('financial-admission-link.json')['financialResultSha256'],'e'*64)
        with self.assertRaisesRegex(RuntimeError,'expired_fixture'):self.owner.admission(active=True)

    def paid_start_fixture(self):
        self.op['originalFreeRoutes']={chain:{'actor':{'chain':chain}}for chain in p.CHAINS}
        self.op['overlays']={chain:{'sha256':'a'*64,'identity':{}}for chain in p.CHAINS}
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.intent('source-initial-stop-intent.json',actor=self.original,knownProcesses=self.original['processes'])
        self.intent('source-initial-stopped.json',terminal=True,intentSha256=self.owner.digest('source-initial-stop-intent.json'))
        self.intent('financial-admission-link.json',financialResultSha256='e'*64)
        for chain in p.CHAINS:
            self.intent(chain+'-paid-started.json',actor={'paid':chain})
            self.intent(chain+'-paid-start-intent.json',notBeforeUs=1)
        self.h.paid_route=lambda chain,*args:{'paid':chain}
        self.owner.reload=lambda tag:None
        self.owner.loaded_source=lambda mode:True
        self.owner.terminal=lambda *args,**kwargs:{'terminal':True}
        self.c.cache=types.SimpleNamespace(validate_restart_capture=lambda *args:{'validated':True,'cacheCoverageQualified':True,'providerCalls':0,'databaseWrites':0,'proof':'actual synthetic gate'})
        fresh=copy.deepcopy(self.original);fresh['parent']['pid']=999002;fresh['processes'][0]['pid']=999002
        self.h.source_epoch=lambda *args:(fresh,copy.deepcopy(self.native))
        self.h.source.query=lambda sql:(_ for _ in()).throw(AssertionError('cache fixture never executes query'))
        self.h.source_sessions=lambda actor,*args:{o.SOURCE:[{'pid':800,'backendStart':'synthetic-positive-socket-map'}],o.FRESH:[]}
        target=self.root/'source.conf';target.write_bytes(b'prepared synthetic source overlay')
        self.patches.append(patch.object(o,'SOURCE_DROP',target));self.patches[-1].start()

    def test_real_cache_gate_refusal_prevents_source_start_and_intent(self):
        self.paid_start_fixture();self.c.cache.validate_restart_capture=lambda *args:(_ for _ in()).throw(RuntimeError('older_cache_hole'))
        with self.assertRaisesRegex(RuntimeError,'older_cache_hole'):self.owner.start_source('paid')
        self.assertEqual(self.calls,[]);self.assertFalse(self.owner.exists('source-paid-start-intent.json'))

    def test_paid_source_start_once_and_cache_proof_precede_manager(self):
        self.paid_start_fixture()
        def manager(verb,unit=None):
            saved=self.owner.journal('source-paid-start-intent.json');self.assertTrue(saved['restartCacheProof']['cacheCoverageQualified'])
            self.assertEqual(saved['preStartDatabaseClock'],50000);self.assertEqual(saved['predecessorHeartbeat'],10000)
            self.calls.append((verb,unit))
        self.h.manager=manager
        first=self.owner.start_source('paid');second=self.owner.start_source('paid')
        self.assertEqual(self.calls,[('start',o.SOURCE)]);self.assertEqual(first['resultSha256'],second['resultSha256'])
        self.assertFalse(first['managedHandoverAllowed'])

    def test_unknown_paid_source_start_intent_is_inspected_and_never_reissued(self):
        self.paid_start_fixture();self.intent('source-paid-start-intent.json',mode='paid',notBeforeUs=1,preStartDatabaseClock=50000,predecessorHeartbeat=10000)
        self.h.source_epoch=lambda *args:(_ for _ in()).throw(ValueError('unresolved actual actor fixture'))
        with self.assertRaises(ValueError):self.owner.start_source('paid')
        self.assertEqual(self.calls,[]);self.assertFalse(self.owner.exists('result.json'))

    def close_fixture(self):
        self.fin=self.root/'financial';self.fin.mkdir(mode=0o700)
        self.patches.append(patch.object(o,'FINANCIAL_BASE',self.fin));self.patches[-1].start()
        original={chain:{'actor':{'chain':chain,'processes':[{'pid':999000+index,'startTicks':1}]},'definitions':{},'environmentFiles':{},'unitSecurity':{},'activation':{}}
                  for index,chain in enumerate(p.CHAINS)}
        self.op['originalFreeRoutes']=original
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.intent('financial-admission-link.json',financialResultSha256='e'*64)
        self.h.free_route=lambda chain:copy.deepcopy(original[chain])
        quiet=[]
        self.owner.leaf=types.SimpleNamespace(assert_no_paid_proxy_processes=lambda:None,
             validate_paid_quiet=lambda q,f:quiet.append((q,f))or{'validated':True,'paidRequestsQuiet':True})
        self.lock_depth=0
        @contextlib.contextmanager
        def financial_lock():
            self.lock_depth+=1
            try:yield
            finally:self.lock_depth-=1
        self.c.financial=types.SimpleNamespace(financial_lock=financial_lock)
        def transaction(phase,commit,quiet_sha,result_sha):
            self.assertEqual(self.lock_depth,1);self.assertTrue(commit);self.assertEqual(result_sha,'e'*64)
            self.assertEqual(self.owner.digest('paid-quiet.json'),quiet_sha)
            self.calls.append(('financial',phase));p.exclusive(self.fin/(phase+'-result.json'),o.encoded({'fixture':phase}))
        self.c.fowner=types.SimpleNamespace(transaction=transaction)
        self.owner.closed_finance=lambda:{'validated':True}
        return quiet

    def test_admitted_never_paid_close_creates_no_paid_start_stop_or_fake_source_epoch(self):
        quiet=self.close_fixture();result=self.owner.close()
        self.assertTrue(result['closed']);self.assertFalse(result['sourceRestarted']);self.assertEqual(self.calls,[('financial','close')])
        row=self.owner.journal('paid-quiet.json');self.assertEqual({v['mode']for v in row['routes'].values()},{'never-paid'})
        self.assertTrue(quiet)
        for chain in p.CHAINS:
            for suffix in leaf.ROUTE_JOURNALS:self.assertFalse(self.owner.exists(chain+'-'+suffix+'.json'))
        self.assertFalse(self.owner.exists('source-free-start-intent.json'))

    def test_UTC_deadline_does_not_repeat_source_stop_or_restart_after_free_ACK(self):
        self.close_fixture();self.owner.close()
        self.intent('source-paid-start-intent.json',notBeforeUs=1)
        self.intent('free-result.json',completed=True,routingMode='free')
        self.owner.source_stop=lambda *args,**kwargs:(_ for _ in()).throw(AssertionError('must not touch free/managed writer'))
        result=self.owner.close(utc=True,resume=False)
        self.assertTrue(result['UTCOriginalPolicyRestored']);self.assertEqual(self.calls,[('financial','close'),('financial','utc')])

    def restored_paid_proxy_fixture(self):
        self.close_fixture();chain='ethereum';original=self.op['originalFreeRoutes'][chain]
        original['actor'].update(invocation='original-free',startMonotonicMicroseconds=100)
        self.op['overlays'][chain]={'sha256':'f'*64,'identity':{}}
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        (self.base/'financial-admission-link.json').unlink();self.intent('financial-admission-link.json',financialResultSha256='e'*64)
        self.intent(chain+'-paid-definition-intent.json',chain=chain)
        self.intent(chain+'-paid-start-intent.json',chain=chain,admissionLinkSha256=self.owner.digest('financial-admission-link.json'))
        paid={'invocation':'paid-epoch','processes':[{'pid':999100,'startTicks':2}]}
        self.proxy_backend={'pid':800,'backendStart':'2026-10-24 12:00:00+00','transport':'tcp'}
        self.intent(chain+'-paid-started.json',chain=chain,actor=paid,ownedBackends=[self.proxy_backend])
        self.proxy_state='paid';self.current_backends=[]
        free=copy.deepcopy(original);free['actor'].update(invocation='restored-free',startMonotonicMicroseconds=self.tick)
        free['actor']['processes']=[{'pid':999101,'startTicks':3}]
        self.free_proxy=free
        self.h.proxy_unit=lambda name:'synthetic-combined-rpc@'+name+'.service'
        self.h.proxy_drop=lambda name:self.root/(name+'.conf')
        self.h.a=types.SimpleNamespace(state=lambda *args:{'MainPID':'0'if self.proxy_state=='terminal'else'999101',
            'ControlPID':'0','ActiveState':'inactive'if self.proxy_state=='terminal'else'active','NRestarts':'0'})
        def query(sql):
            self.assertIn('backend_start::text',sql);return copy.deepcopy(self.current_backends)
        self.h.rpc_m=types.SimpleNamespace(query=query)
        self.h.paid_route=lambda *args:copy.deepcopy(paid)
        self.h.proxy_sessions=lambda *args:[self.proxy_backend]
        self.h.free_route=lambda name:copy.deepcopy(free if name==chain else self.op['originalFreeRoutes'][name])
        def manager(verb,unit=None):
            self.calls.append((verb,unit))
            if verb=='stop':self.proxy_state='terminal'
            elif verb=='start':self.proxy_state='free'
        self.h.manager=manager
        self.owner.leaf.stopped_route=leaf.stopped_route
        self.owner.leaf.quiet_metrics=lambda port:True
        self.patches.append(patch.object(leaf,'BASE',self.base));self.patches[-1].start()
        return chain

    def test_actual_paid_close_free_resume_then_UTC_preserves_healthy_free_proxy(self):
        chain=self.restored_paid_proxy_fixture()
        first=self.owner.close();self.assertTrue(first['financialClosed']);self.assertEqual(self.proxy_state,'free')
        epoch=self.owner.digest(chain+'-free-started.json');first_calls=list(self.calls)
        # The standalone source has its separately acknowledged FREE epoch;
        # this test exercises real proxy recovery, not source runtime peers.
        self.intent('source-paid-start-intent.json',notBeforeUs=1)
        self.intent('free-result.json',completed=True,routingMode='free')
        self.owner.source_stop=lambda *args,**kwargs:(_ for _ in()).throw(AssertionError('healthy FREE source must stay active'))
        second=self.owner.close(utc=True,resume=True)
        self.assertTrue(second['UTCOriginalPolicyRestored']);self.assertEqual(self.proxy_state,'free')
        self.assertEqual(self.owner.digest(chain+'-free-started.json'),epoch)
        self.assertEqual(self.calls,first_calls+[('financial','utc')])
        self.assertEqual([v for v in self.calls if v[0]in{'stop','start'}],[('stop',self.h.proxy_unit(chain)),('start',self.h.proxy_unit(chain))])

    def test_partial_close_one_restored_proxy_is_verified_without_terminal_or_manager_resend(self):
        chain=self.restored_paid_proxy_fixture()
        self.owner.stop_paid_proxies();self.owner.restore_proxy(chain)
        calls=list(self.calls);self.owner.stop_paid_proxies();self.owner.restore_proxy(chain)
        self.assertEqual(self.calls,calls);self.assertEqual(self.proxy_state,'free')
        self.current_backends=[{key:self.proxy_backend[key]for key in ['pid','backendStart']}]
        with self.assertRaisesRegex(RuntimeError,'actual_owned_paid_budget_backends_must_drain'):self.owner.stop_paid_proxies()
        self.assertEqual(self.calls,calls)

    def test_actual_Host_kernel_mapped_transport_tuple_cannot_hide_live_backend_epoch(self):
        fixtures=load(HERE/'ypal-alchemy-source-switch-v1.host.test.py','actual_host_kernel_fixture')
        kernel=fixtures.Kernel();kernel.setUp()
        mapped=fixtures.h.kernel_backends(lambda sql:copy.deepcopy(kernel.rows),kernel.observer,16394,kernel.actors,kernel.ids,False)['source']
        self.assertEqual(mapped,[{'pid':800,'backendStart':'actual-fixture-epoch','transport':'tcp'}])
        self.h.rpc_m=types.SimpleNamespace(query=lambda sql:[{'pid':800,'backendStart':'actual-fixture-epoch'}])
        with self.assertRaisesRegex(RuntimeError,'actual_owned_paid_budget_backends_must_drain'):self.owner.budget_backends_gone(mapped)
        self.h.rpc_m.query=lambda sql:[{'pid':800,'backendStart':'different-actual-epoch'}]
        self.owner.budget_backends_gone(mapped)

    def test_already_free_branch_rejects_changed_actor_or_foreign_definition(self):
        chain=self.restored_paid_proxy_fixture();self.owner.stop_paid_proxies();self.owner.restore_proxy(chain)
        calls=list(self.calls);self.free_proxy['actor']['invocation']='foreign-free'
        # Replace the capture explicitly: the normal fixture returns snapshots.
        self.h.free_route=lambda name:copy.deepcopy(self.free_proxy if name==chain else self.op['originalFreeRoutes'][name])
        with self.assertRaisesRegex(RuntimeError,'exact_acknowledged_restored_free_epoch'):self.owner.stop_paid_proxies()
        self.free_proxy['actor']['invocation']='restored-free';self.free_proxy['definitions']={'foreign':'changed'}
        with self.assertRaisesRegex(RuntimeError,'exact_acknowledged_restored_free_epoch'):self.owner.stop_paid_proxies()
        self.assertEqual(self.calls,calls)

    def test_source_restore_pending_does_not_prevent_financial_quiet_close(self):
        self.close_fixture();self.intent('source-paid-start-intent.json',notBeforeUs=1)
        self.owner.source_stop=lambda *args,**kwargs:{'sourceProcessesTerminal':True,'sourceDrainedQualified':False,'sourceRestorePending':True}
        self.owner.start_source=lambda *args:(_ for _ in()).throw(AssertionError('unproved restore must not start'))
        result=self.owner.close(resume=True)
        self.assertTrue(result['financialClosed']);self.assertTrue(result['sourceRestorePending']);self.assertFalse(result['sourceDrainedQualified'])
        self.assertEqual(self.calls,[('financial','close')]);self.assertFalse(self.owner.exists('free-result.json'))

    def test_prepared_deadline_symlink_no_replace_and_original_inode_survives(self):
        target=self.root/'system'/'timers.target.wants'/'owned.timer';target.parent.mkdir(parents=True)
        link=self.hold/'prepared.boot';link.symlink_to('/synthetic/exact-unit')
        expected=leaf.link_record(link);o.move_link(p,leaf,link,target,expected)
        self.assertEqual(leaf.link_record(target),expected)
        another=self.hold/'foreign-race.boot';another.symlink_to('/synthetic/exact-unit')
        with self.assertRaises(FileExistsError):o.move_link(p,leaf,another,target,leaf.link_record(another))
        self.assertEqual(leaf.link_record(target),expected)

    def test_actual_paid_stop_partial_DB_failure_never_fabricates_full_drain_ACK(self):
        self.intent('source-paid-start-intent.json',notBeforeUs=1)
        self.h.source.state=lambda unit:{'MainPID':'999001'};self.h.source_epoch=lambda *args:(self.original,None)
        self.owner.process_terminal=lambda *args:'f'*64
        self.c.remaining_source_facts=lambda:(_ for _ in()).throw(RuntimeError('source_database_unavailable_fixture'))
        result=self.owner.source_stop('paid',partial_ok=True)
        self.assertTrue(result['sourceProcessesTerminal']);self.assertTrue(result['sourceRestorePending']);self.assertFalse(result['sourceDrainedQualified'])
        self.assertEqual(self.calls,[('stop',o.SOURCE)]);self.assertFalse(self.owner.exists('source-paid-stopped.json'))
        self.assertTrue(self.owner.exists('source-paid-stop-processes-terminal.json'))

    def test_uncommitted_original_budget_deadline_noop_does_not_need_fresh_range(self):
        financial=load(HERE/'ypal-alchemy-catchup-financial-v1.test.py','actual_model_for_noop')
        before,ranges=financial.fixture();plan=financial.m.plan(before,ranges,'a'*64,before['clockMs'],financial.PROFILE)
        current=copy.deepcopy(before);current['clockMs']=plan['nextUtcMs']+1000
        self.c.fowner=types.SimpleNamespace(prepared=lambda:{'before':before,'plan':plan},m=financial.m,
            h=types.SimpleNamespace(snapshot=lambda:current,profile=financial.PROFILE,query=lambda sql:{'otherFinancialClients':0}))
        result=self.owner.no_admission();self.assertTrue(result['noFinancialAdmissionOccurred']);self.assertFalse(result['ownedPermitRowsPresent'])
        self.c.fowner.h.query=lambda sql:{'otherFinancialClients':1}
        with self.assertRaisesRegex(RuntimeError,'no_unresolved_financial_SQL_client'):self.owner.no_admission()

    def test_actual_source_export_stable_binding_excludes_advancing_native_observations(self):
        self.paid_start_fixture();result=self.owner.start_source('paid')
        self.c.immutable=lambda op:None;self.owner.verify_published_configuration=lambda:None
        self.c.fowner=types.SimpleNamespace(m=types.SimpleNamespace(MANIFEST='0x'+'1'*64,RELEASE='0x'+'2'*64))
        with patch.object(o,'load_owner',return_value=self.owner):
            first=o.validate_current_source(result['resultSha256'],'b'*64,'c'*64)
            self.native['clock']+=1000;self.native['app']['heartbeat_at']='11000'
            second=o.validate_current_source(result['resultSha256'],'b'*64,'c'*64)
        self.assertEqual(first['bindingSha256'],second['bindingSha256']);self.assertNotEqual(first['observation'],second['observation'])
        self.assertTrue(first['currentWriterQualified']);self.assertFalse(first['financialAuthorityQualified']);self.assertFalse(first['managedHandoverAllowed'])

    def test_actual_inverse_export_never_calls_active_epoch_or_claims_active_writer(self):
        self.paid_start_fixture();result=self.owner.start_source('paid')
        self.intent('source-paid-stop-intent.json',actor=self.original)
        self.owner.terminal=lambda *args,**kwargs:{'terminal':True,'remainingWriterAttribution':{o.FRESH:[]}}
        self.c.immutable=lambda op:None;self.owner.verify_published_configuration=lambda:None
        self.h.source_epoch=lambda *args:(_ for _ in()).throw(AssertionError('terminal inverse must not ask active epoch'))
        self.c.fowner=types.SimpleNamespace(m=types.SimpleNamespace(MANIFEST='0x'+'1'*64,RELEASE='0x'+'2'*64))
        with patch.object(o,'load_owner',return_value=self.owner):proof=o.validate_current_source(result['resultSha256'],'b'*64,'c'*64,inverse=True)
        self.assertEqual(proof['sourceState'],'owned-terminal');self.assertTrue(proof['terminalInverseOnly'])
        self.assertFalse(proof['currentWriterQualified']);self.assertFalse(proof['sourceReadinessQualified']);self.assertEqual(proof['sourceKernelActors'],{})

    def test_loaded_actual_DBUS_shapes_bind_all_six_mounts_and_literal_fourth_envfile(self):
        project=p.PROJECT;self.m.NAMESPACE={project+'/.ponder':'/fixture/cache',project+'/node_modules/.vite-temp':'/fixture/vite',project+'/ponder-env.d.ts':'/fixture/env',
            project+'/ponder.config.ts':'/fixture/config',project+'/lib/boosters/config.ts':'/fixture/boosters',project+'/lib/unified/rpc-preflight.ts':'/fixture/old-transport'}
        argv=['/opt/node-v24.18.1/bin/node','--env-file=/fixture/first','--env-file=/fixture/second','--env-file=/fixture/third',project+'/node_modules/ponder/dist/esm/bin/ponder.js','start']
        self.op['source']['parent']['argv']=argv;self.op['sourceDefinitions']={'/fixture/source.service':{'sha256':'f'*64,'identity':{}}};self.op['sourceOverlay']={'sha256':'e'*64,'identity':{}}
        self.op['sourceRuntime']={'synthetic':'same6GiB'}
        binds={name:{'type':'a(ssbt)','data':[[backing,inside,False,16384]for inside,backing in pairs]}for name,pairs in
               [('BindPaths',list(self.m.NAMESPACE.items())[:3]),('BindReadOnlyPaths',list(self.m.NAMESPACE.items())[3:])]}
        self.op['sourceBindings']=copy.deepcopy(binds);self.op['sourceBindings']['EnvironmentFiles']={'type':'a(sb)','data':[]}
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.m.link_record=lambda path:self.op['sourceBoot'];self.h.r.BOOT='/fixture/boot'
        self.h.definitions=lambda state:{**self.op['sourceDefinitions'],str(o.SOURCE_DROP):self.op['sourceOverlay']}
        self.h.source.state=lambda unit:{};self.h.source.runtime_properties=lambda:self.op['sourceRuntime']
        current=copy.deepcopy(self.op['sourceBindings']);current['BindReadOnlyPaths']['data'][2][0]=str(p.OPS/'ypal-rpc-deadline-host-build-v1/rpc-preflight.ts')
        wanted=list(argv);wanted.insert(wanted.index(project+'/node_modules/ponder/dist/esm/bin/ponder.js'),'--env-file='+str(p.STAGE/'source.public.env'))
        current['ExecStart']={'type':'a(sasbttttuii)','data':[['/usr/bin/env',['/usr/bin/env','-i',*wanted],False,0,0,0,0,0,0,0]]}
        self.m.command=lambda args:json.dumps(current[args[-1]]).encode()
        self.c.source_bindings=types.MethodType(o.Context.source_bindings,self.c)
        self.assertTrue(self.owner.loaded_source('paid'))
        current['BindReadOnlyPaths']['data'][0][3]=0
        with self.assertRaisesRegex(RuntimeError,'original_loaded_source_mount_flags'):self.owner.loaded_source('paid')
        current['BindReadOnlyPaths']['data'][0][3]=16384;current['ExecStart']['data'][0][1][4]='--env-file=/unowned/earlier'
        with self.assertRaisesRegex(RuntimeError,'ordered_Node_envfiles'):self.owner.loaded_source('paid')

    def test_actual_private_file_identity_and_order_guard_rejects_changed_credentials(self):
        paths=[]
        for i in range(3):
            path=self.root/('private'+str(i));p.exclusive(path,('SYNTHETIC='+str(i)+'\n').encode());paths.append(path)
        actor={'parent':{'argv':['node',*['--env-file='+str(path)for path in paths],'ponder.js']}}
        self.m.identity=p.identity;self.c.source_private_inputs=types.MethodType(o.Context.source_private_inputs,self.c)
        op={'source':actor,'sourcePrivateInputs':self.c.source_private_inputs(actor)}
        o.Context.private_current(self.c,op)
        paths[0].write_bytes(b'SYNTHETIC=changed\n')
        with self.assertRaisesRegex(RuntimeError,'same_original_private_Node'):o.Context.private_current(self.c,op)

    def test_unknown_initial_stop_that_left_exact_original_actor_alive_closes_without_resend(self):
        self.close_fixture();self.intent('source-initial-stop-intent.json',actor=self.original)
        before=self.owner.digest('source-initial-stop-intent.json');self.h.source.state=lambda unit:{'MainPID':'999001'}
        result=self.owner.close()
        self.assertTrue(result['financialClosed']);self.assertEqual(self.calls,[('financial','close')])
        self.assertEqual(self.owner.digest('source-initial-stop-intent.json'),before)
        proof=self.owner.journal('source-initial-stop-noeffect.json');self.assertTrue(proof['originalEpochStillActive']);self.assertFalse(proof['newSourceStartClaimed'])
        self.owner.retained_free=lambda:{'retainedInitialActor':True,'newSourceStartClaimed':False}
        self.assertTrue(self.owner.start_source('free')['retainedInitialActor'])

    def test_prepared_cleanup_owns_new_once_stop_of_observed_original_free_actor(self):
        self.close_fixture();self.intent('ethereum-paid-definition-intent.json',chain='ethereum')
        self.h.a=types.SimpleNamespace(state=lambda *args:{'MainPID':'999000'})
        self.h.rpc_m=object();self.h.proxy_unit=lambda chain:'yunipals-combined-rpc@'+chain+'.service'
        self.h.proxy_drop=lambda chain:self.root/(chain+'.conf')
        self.owner.terminal=lambda *args,**kwargs:{'terminal':True}
        self.owner.stop_paid_proxies();self.owner.stop_paid_proxies()
        self.assertEqual(self.calls,[('stop','yunipals-combined-rpc@ethereum.service')])
        row=self.owner.journal('ethereum-paid-stop-intent.json');self.assertTrue(row['startNeverAttempted'])
        self.assertEqual(row['processes'],[]);self.assertEqual(row['ownedBackends'],[]);self.assertIsNotNone(row['originalFreeCleanupActor'])
        self.assertFalse(self.owner.exists('ethereum-paid-start-intent.json'))

    def test_mixed_routing_is_immutable_source_fact_not_all_primary_alias(self):
        self.assertEqual(self.owner.operation()['chainRouting'],{'ethereum':'paid_primary','base':'paid_primary','polygon':'paid_primary','bnb':'paid_logs_free_blocks'})
        self.op['chainRouting']['bnb']='paid_primary';(self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        with self.assertRaisesRegex(RuntimeError,'immutable_pre_financial_operation'):self.owner.operation()

    def test_retained_original_actor_uses_only_cap0_backing_metadata_peer_not_root_stat(self):
        self.original['parent']['environmentSha256']='c'*64
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.m.NAMESPACE={'/inside'+str(i):'/uid970-only/backing'+str(i)for i in range(6)}
        self.m.NAMESPACE_PEER='actual namespace peer marker';self.c.host_module=types.SimpleNamespace(BACKING_STAT_PEER='actual backing peer marker')
        self.h.source.s=types.SimpleNamespace(PUBLIC_ENV_PEER='actual public peer marker',expected_env=lambda:{})
        self.h.r.heartbeat=lambda native:True;self.owner.loaded_source=lambda mode:True
        metadata={key:{'device':1,'inode':100+i,'uid':970,'gid':964,'kind':16384}for i,key in enumerate(self.m.NAMESPACE)}
        calls=[]
        def command(args,data=None):
            self.assertIn('--reuid=970',args);self.assertIn('--regid=964',args);self.assertIn('--bounding-set=-all',args)
            self.assertIn('--clear-groups',args);self.assertIn('--no-new-privs',args)
            marker=args[args.index('-c')+1];calls.append(marker)
            return json.dumps({'presentKeysMatch':True,'environmentSha256':'c'*64}if marker=='actual public peer marker'else metadata).encode()
        self.m.command=command
        original_stat=Path.stat
        def root_stat(path,*args,**kwargs):
            if str(path).startswith('/uid970-only/'):raise AssertionError('root cannot stat owner970 backings')
            return original_stat(path,*args,**kwargs)
        with patch.object(Path,'stat',root_stat):
            actor,native=self.owner.retained_initial_actor()
        self.assertEqual(actor,self.original);self.assertEqual(len(calls),3)
        other=copy.deepcopy(self.original);other['parent']['pid']=999002;self.h.source.actor=lambda *args:other
        with self.assertRaisesRegex(RuntimeError,'exact_original_retained_process_epoch'):self.owner.retained_initial_actor()

    def test_current_proxy_full_environment_uses_declared_merge_leaf_and_final_actor_CAS(self):
        actor={'pid':123,'invocation':'actual-explicit-fixture'};packet={'actor':actor,'environmentFileHashes':{'/fixture/private':'a'*64}}
        calls=[]
        rpc=types.SimpleNamespace(PARSER='fixed-public-parser',PARSER_SHA='a'*64,module=lambda *args:object(),
            packet=lambda *args:copy.deepcopy(packet),proxy_environment=lambda *args:calls.append('actual-contract-full-merge')or{'allDeclaredValuesMatch':True})
        self.h.source.rpc=rpc;self.h.rpc_m=object();self.h.a=object();self.h.proxy_unit=lambda chain:'yunipals-combined-rpc@'+chain+'.service'
        self.assertTrue(o.Context.proxy_environment(self.c,'bnb',actor)['allDeclaredValuesMatch']);self.assertEqual(calls,['actual-contract-full-merge'])
        rpc.proxy_environment=lambda *args:(_ for _ in()).throw(RuntimeError('unknown_or_changed_private_environment_fixture'))
        with self.assertRaisesRegex(RuntimeError,'unknown_or_changed_private_environment'):o.Context.proxy_environment(self.c,'bnb',actor)
        rpc.proxy_environment=lambda *args:packet['actor'].update(pid=124)or{'allDeclaredValuesMatch':True}
        with self.assertRaisesRegex(RuntimeError,'after_full_merged_environment'):o.Context.proxy_environment(self.c,'bnb',copy.deepcopy(actor))


if __name__=='__main__':unittest.main()
