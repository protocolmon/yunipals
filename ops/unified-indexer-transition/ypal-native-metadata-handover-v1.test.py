import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('metadata_owner', HERE/'ypal-native-metadata-handover-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Store:
    def save(self, path, value, mode=0o600):
        raw = value if isinstance(value,bytes) else m.encoded(value)
        with path.open('xb') as f:os.fchmod(f.fileno(),mode);f.write(raw)
        return m.sha(raw)
    def document(self,path,pin=None):
        raw=path.read_bytes()
        if pin is not None:m.need(m.sha(raw)==pin,'test_pin')
        return json.loads(raw)
    def protected(self,path,*args):return path.read_bytes()
    def sync(self,path):pass
    def boot(self):return 'test-boot'


def frame():
    return {'scan':{'name':'base_metadata_v1','chain_id':8453,'contract_address':'0x98433df878e8c898cb907345c3a7756e5f72240f','deployment_block':22224075,'next_block':30000001,'ingestion_mode':'rpc','updated_at':'earlier'},'frame':{'block_number':30000000},'approval':None,'probe':False,'remainingPublished':10000}


class Prefix:
    def __init__(self,tmp):
        self.store=Store();self.base=tmp/'owned';self.base.mkdir();self.boot=tmp/'boot-link';self.drop=tmp/'native.conf'
        self.boot.symlink_to('/etc/systemd/system/yunipals-metadata.service');self.boot_record=m.link(self.boot)
        self.boot.rename(self.base/'original-boot-link');self.drop.write_bytes(b'exact native drop');self.drop_id=m.file_identity(self.drop)
        self.old={'definitions':{'original':'hash'},'environmentFileHashes':{'private':'hash'},'configuredEnvironmentSha256':'same'}
        self.op={'oldWriter':self.old,'oldActor':{'processes':[]},'oldBoot':self.boot_record,'candidateDropSha256':m.sha(self.drop.read_bytes()),'oldUnit':{'ExecStart':'{ argv[]=node original ; }','User':'','Group':''},'oldSessions':{'owned':[],'otherPeers':[]}}
        self.db=frame();self.db['approval']={'read_identity':'new-identity','state':'blocked','error_code':'owned_metadata_inverse'}
        self.manager=[];self.current={'MainPID':'0','ExecMainStartTimestampMonotonic':'100'}
        self.h=types.SimpleNamespace(s=self.store,meta=types.SimpleNamespace(IDENTITY='new-identity'),m=types.SimpleNamespace(snapshot=lambda unit:(self.old,{})),refresh=lambda:None,private=lambda old:None,database=lambda:self.db,terminal=lambda *args:None)
        self.store.save(self.base/'drained.json',{'scan':frame()['scan']})
        self.store.save(self.base/'native-drop-created.json',self.drop_id)
        self.store.save(self.base/'inverse-intent.json',{'nativeActor':None,'nativeSessions':None,'oldStillRunning':False})
        self.store.save(self.base/'inverse-sql-intent.json',{'scan':frame()['scan']})
    def start(self,_,action):
        self.manager.append(action)
        if action=='start':
            self.current['MainPID']='42'
            self.current['ExecMainStartTimestampMonotonic']=str(self.store.document(self.base/'old-start-intent.json')['monotonicUs']+1)
    def patches(self):
        return [patch.object(m,'BASE',self.base),patch.object(m,'BOOT',self.boot),patch.object(m,'DROP',self.drop),
            patch.object(m,'state',lambda _:self.current),patch.object(m,'loaded',return_value=True),patch.object(m,'manager',side_effect=self.start)]


class Controls(unittest.TestCase):
    def drain_case(self,mutate=False):
        with tempfile.TemporaryDirectory()as t:
            base=Path(t)/'owned';boot=Path(t)/'boot';boot.symlink_to('/unit');s=Store();calls=[];terminal=[]
            actor={'unit':{'UnitFileState':'enabled','WantedBy':'multi-user.target','MainPID':'42'},'main':{'pid':42}}
            binding={'oldBoot':m.link(boot),'oldActor':actor,'oldWriter':{},'oldSessions':{'owned':[],'otherPeers':[]}}
            fresh={'owned':[{'pid':9,'backendStart':'fresh'}],'otherPeers':[]}
            def current():
                value=m.boot_disabled_actor(actor)
                return {**value,'main':{'pid':99}}if mutate and(base/'stop-old-intent.json').exists()else value
            h=types.SimpleNamespace(s=s,m=None,database=frame,actor=current,sessions=lambda a:fresh,private=lambda a:None,terminal=lambda *a:terminal.append(a))
            with patch.object(m,'BASE',base),patch.object(m,'BOOT',boot),patch.object(m,'manager',side_effect=lambda _,action:calls.append(action)):
                if mutate:
                    with self.assertRaisesRegex(RuntimeError,'actor_changed_after_stop_intent'):m.drain(h,binding)
                    self.assertEqual(calls,['daemon-reload']);self.assertTrue((base/'stop-old-intent.json').exists())
                else:
                    m.drain(h,binding);self.assertEqual(terminal[0][2],fresh);self.assertEqual(calls,['daemon-reload','stop'])
                self.assertEqual(s.document(base/'drain-session-proof.json')['sessions'],fresh)
    def test_drain_recaptures_and_uses_fsynced_fresh_backend_subset(self):self.drain_case()
    def test_stop_cas_after_fresh_session_proof_and_durable_intent(self):self.drain_case(True)
    def test_real_coverage_exclusive_cursor(self):
        self.assertTrue(m.covered(frame()))
        for kind in ['missing','behind','contract','chain']:
            d=frame()
            if kind=='missing':d['frame']=None
            if kind=='behind':d['frame']['block_number']=29999999
            if kind=='contract':d['scan']['contract_address']='foreign'
            if kind=='chain':d['scan']['chain_id']=1
            self.assertFalse(m.covered(d))
    def test_cursor_comparison_never_resets_any_saved_field(self):
        a=frame()['scan'];b={**a,'ingestion_mode':'native','updated_at':'later'}
        self.assertEqual(m.stable_scan(a),m.stable_scan(b));self.assertNotEqual(m.stable_scan(a),m.stable_scan({**b,'next_block':1}))
    def test_boot_disable_changes_only_expected_activation(self):
        a={'unit':{'UnitFileState':'enabled','WantedBy':'multi-user.target','MainPID':'42','Job':''},'main':{'pid':42}}
        b=m.boot_disabled_actor(a);self.assertEqual(b['main'],a['main']);self.assertEqual(b['unit']['MainPID'],'42');self.assertEqual(b['unit']['WantedBy'],'');self.assertEqual(a['unit']['UnitFileState'],'enabled')
    def test_same_pid_new_start_is_not_original_process(self):
        actor={'pid':42,'startTicks':1,'bootId':'b'}
        self.assertFalse(m.identity_alive(types.SimpleNamespace(process=lambda p:{**actor,'startTicks':2}),actor))
    def test_fixed_manager_scope(self):
        with patch.object(m.subprocess,'run') as run,self.assertRaisesRegex(RuntimeError,'only_metadata_manager'):m.manager(None,'restart')
        run.assert_not_called()
    def test_boot_inode_survives_move_and_foreign_replacement_refuses_equality(self):
        with tempfile.TemporaryDirectory() as t:
            a=Path(t)/'a';b=Path(t)/'b';a.symlink_to('/target');before=m.link(a);a.rename(b);self.assertEqual(m.link(b),before)
            a.symlink_to('/target');self.assertNotEqual(m.link(a),before)
    def test_exact_corrected_read_admission_producer_not_future_ack(self):
        self.assertEqual(m.ADMISSION_FILE.name,'ypal-combined-read-admission-v2.py')
        self.assertEqual(m.sha((HERE/m.ADMISSION_FILE.name).read_bytes()),m.ADMISSION_SHA)
        self.assertIn('admission-result-sha',(HERE/'ypal-native-metadata-handover-v1.py').read_text())
    def test_inverse_sql_locks_and_only_changes_mode_and_owned_approval(self):
        self.assertIn("pg_try_advisory_xact_lock(hashtext('metadata:base-replay'))",m.INVERSE_JS)
        self.assertIn("scan.ingestion_mode!=='native'",m.INVERSE_JS)
        self.assertIn('stable(scan)!==stable(v.scan)',m.INVERSE_JS)
        self.assertIn('approval?.read_identity!==v.identity',m.INVERSE_JS)
        self.assertNotRegex(m.INVERSE_JS,r'\b(?:DELETE|INSERT|DROP|GRANT|ALTER|TRUNCATE)\b')
        self.assertIn("await db.query('ROLLBACK')",m.INVERSE_JS)
    def test_missing_cli_identity_is_unknown_and_blocks_mutations(self):
        with tempfile.TemporaryDirectory() as t,patch.object(m,'BASE',Path(t)):
            s=Store();s.save(Path(t)/'adopt-intent.json',{})
            h=types.SimpleNamespace(s=s)
            with self.assertRaisesRegex(RuntimeError,'child_identity_unknown'):m.no_live_cli(h)
            self.assertTrue(m.no_live_cli(h,False)[0]['identityUnknown'])
    def test_live_cli_blocks_inverse(self):
        with tempfile.TemporaryDirectory() as t,patch.object(m,'BASE',Path(t)),patch.object(m,'identity_alive',return_value=True):
            s=Store();s.save(Path(t)/'adopt-child.json',{'pid':42});h=types.SimpleNamespace(s=s,m=None)
            with self.assertRaisesRegex(RuntimeError,'cli_still_running'):m.no_live_cli(h)
    def test_partial_file_record_can_only_be_equal_and_explicit_finish(self):
        with tempfile.TemporaryDirectory() as t,patch.object(m,'BASE',Path(t)):
            h=types.SimpleNamespace(s=Store());m.remember(h,'one.json',{'owned':True},False)
            with self.assertRaises(RuntimeError):m.remember(h,'one.json',{'owned':True},False)
            m.remember(h,'one.json',{'owned':True},True)
            with self.assertRaises(RuntimeError):m.remember(h,'one.json',{'owned':False},True)
    def test_lost_reload_ack_uses_loaded_state_without_manager_call(self):
        with tempfile.TemporaryDirectory() as t,patch.object(m,'BASE',Path(t)),patch.object(m,'loaded',return_value=True),patch.object(m,'manager')as manager:
            h=types.SimpleNamespace(s=Store());h.s.save(Path(t)/'reload-intent.json',{'native':False,'enabled':True})
            m.reload_inverse(h,{},'reload',False,True,True);manager.assert_not_called()
    def test_unknown_unloaded_reload_is_not_repeated(self):
        with tempfile.TemporaryDirectory() as t,patch.object(m,'BASE',Path(t)),patch.object(m,'loaded',return_value=False),patch.object(m,'manager')as manager:
            h=types.SimpleNamespace(s=Store());h.s.save(Path(t)/'reload-intent.json',{'native':False,'enabled':True})
            with self.assertRaisesRegex(RuntimeError,'unknown_reload_not_repeated'):m.reload_inverse(h,{},'reload',False,True,True)
            manager.assert_not_called()
    def test_inverse_finishes_equal_unlink_prefix_and_semantic_sql_ack(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));f.store.save(f.base/'inverse-drop-remove-intent.json',{'sha256':f.op['candidateDropSha256'],'identity':f.drop_id})
            with ExitStack()as stack:
                for p in f.patches():stack.enter_context(p)
                m.inverse(f.h,f.op,True)
                self.assertEqual(f.manager,['start']);self.assertFalse(f.drop.exists());self.assertEqual(m.link(f.boot),f.boot_record)
                self.assertFalse((f.base/'inverse-sql-result.json').exists());self.assertTrue((f.base/'inverse-sql-reconciled.json').exists())
                with self.assertRaisesRegex(RuntimeError,'completed_metadata_inverse'):m.inverse(f.h,f.op,True)
                self.assertEqual(f.manager,['start'])
    def test_inverse_unknown_sql_still_native_never_reissues_sql_or_start(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));f.db['scan']['ingestion_mode']='native';f.db['approval']['state']='ready'
            with ExitStack()as stack,patch.object(m,'inverse_sql')as sql:
                for p in f.patches():stack.enter_context(p)
                with self.assertRaisesRegex(RuntimeError,'unknown_inverse_sql_not_repeated'):m.inverse(f.h,f.op,True)
                sql.assert_not_called();self.assertEqual(f.manager,[]);self.assertTrue(f.drop.exists());self.assertFalse(f.boot.exists())
    def test_foreign_same_bytes_drop_inode_is_not_owned(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));other=Path(t)/'other';other.write_bytes(f.drop.read_bytes());f.drop.unlink();other.rename(f.drop)
            with ExitStack()as stack:
                for p in f.patches():stack.enter_context(p)
                with self.assertRaisesRegex(RuntimeError,'same_owned_native_drop'):m.inverse(f.h,f.op,True)
                self.assertTrue(f.drop.exists());self.assertEqual(f.manager,[])
    def test_lost_original_start_ack_does_not_start_again(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));f.drop.unlink();f.store.save(f.base/'inverse-boot-publish-intent.json',f.boot_record);(f.base/'original-boot-link').rename(f.boot)
            f.store.save(f.base/'old-start-intent.json',{'bootId':'test-boot','monotonicUs':50,'scan':frame()['scan']});f.current['MainPID']='42'
            with ExitStack()as stack:
                for p in f.patches():stack.enter_context(p)
                m.inverse(f.h,f.op,True);self.assertEqual(f.manager,[])
    def test_lost_start_ack_after_owned_rpc_cursor_advance_is_finish_only(self):
        from contextlib import ExitStack
        for changed, refused in [('advanced',False),('regressed',True),('foreign-contract',True)]:
            with tempfile.TemporaryDirectory()as t:
                f=Prefix(Path(t));f.drop.unlink();f.store.save(f.base/'inverse-boot-publish-intent.json',f.boot_record);(f.base/'original-boot-link').rename(f.boot)
                f.store.save(f.base/'old-start-intent.json',{'bootId':'test-boot','monotonicUs':50,'scan':frame()['scan']});f.current['MainPID']='42'
                if changed=='advanced':f.db['scan'].update(next_block=30000101,target_block=30000100,target_hash='new-head',last_scanned_hash='new-last')
                if changed=='regressed':f.db['scan']['next_block']=1
                if changed=='foreign-contract':f.db['scan']['contract_address']='foreign'
                with ExitStack()as stack:
                    for p in f.patches():stack.enter_context(p)
                    if refused:
                        with self.assertRaisesRegex(RuntimeError,'owned_rpc_resume_must_preserve_identity'):m.inverse(f.h,f.op,True)
                    else:
                        m.inverse(f.h,f.op,True);result=f.store.document(f.base/'inverse-result.json')
                        self.assertTrue(result['completedByOwnedResumeReconciliation']);self.assertEqual(result['managerActionsThisCall'],0);self.assertFalse(result['sqlReissued']);self.assertEqual(result['resumedCursor'],30000101)
                    self.assertEqual(f.manager,[])
    def test_unknown_original_start_with_terminal_unit_is_not_repeated(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));f.drop.unlink();f.store.save(f.base/'inverse-boot-publish-intent.json',f.boot_record);(f.base/'original-boot-link').rename(f.boot)
            f.store.save(f.base/'old-start-intent.json',{'bootId':'test-boot','monotonicUs':50,'scan':frame()['scan']})
            with ExitStack()as stack:
                for p in f.patches():stack.enter_context(p)
                with self.assertRaisesRegex(RuntimeError,'unknown_original_start_not_repeated'):m.inverse(f.h,f.op,True)
                self.assertEqual(f.manager,[])
    def test_pre_adoption_no_drained_receipt_lost_start_can_finish_monotonic_replay(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));f.drop.unlink();(f.base/'drained.json').unlink();(f.base/'inverse-sql-intent.json').unlink();f.db['approval']=None
            f.store.save(f.base/'inverse-boot-publish-intent.json',f.boot_record);(f.base/'original-boot-link').rename(f.boot)
            f.store.save(f.base/'old-start-intent.json',{'bootId':'test-boot','monotonicUs':50,'scan':frame()['scan']});f.current['MainPID']='42';f.db['scan']['next_block']+=1
            with ExitStack()as stack:
                for p in f.patches():stack.enter_context(p)
                m.inverse(f.h,f.op,True);self.assertEqual(f.manager,[])
                self.assertTrue(f.store.document(f.base/'inverse-result.json')['completedByOwnedResumeReconciliation'])
    def test_original_actor_switch_during_finish_query_is_not_acknowledged(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));f.drop.unlink();f.store.save(f.base/'inverse-boot-publish-intent.json',f.boot_record);(f.base/'original-boot-link').rename(f.boot)
            f.store.save(f.base/'old-start-intent.json',{'bootId':'test-boot','monotonicUs':50,'scan':frame()['scan']});f.current['MainPID']='42'
            count=[0]
            def snapshots(unit):
                count[0]+=1;return (f.old if count[0]==1 else {**f.old,'process':{'pid':99}}, {})
            f.h.m.snapshot=snapshots
            with ExitStack()as stack:
                for p in f.patches():stack.enter_context(p)
                with self.assertRaisesRegex(RuntimeError,'original_resume_changed_during_finish'):m.inverse(f.h,f.op,True)
                self.assertEqual(f.manager,[]);self.assertFalse((f.base/'inverse-result.json').exists())
    def test_unknown_native_stop_with_live_unit_is_not_repeated(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory()as t:
            f=Prefix(Path(t));(f.base/'inverse-intent.json').unlink();f.store.save(f.base/'inverse-intent.json',{'nativeActor':{'owned':True},'nativeSessions':{'owned':[],'otherPeers':[]},'oldStillRunning':False})
            f.store.save(f.base/'inverse-stop-native-intent.json',{});f.current['MainPID']='42'
            with ExitStack()as stack:
                for p in f.patches():stack.enter_context(p)
                with self.assertRaisesRegex(RuntimeError,'unknown_native_stop_not_repeated'):m.inverse(f.h,f.op,True)
                self.assertEqual(f.manager,[])
    def test_known_busy_provenance_is_not_claimed_stamped_or_complete(self):
        with tempfile.TemporaryDirectory()as t,patch.object(m,'BASE',Path(t)):
            s=Store();s.save(Path(t)/'selected.json',{'nativeActor':{'owned':True}})
            h=types.SimpleNamespace(s=s,actor=lambda *args:{'owned':True},official=lambda *args:{'busy':True})
            result=m.provenance(h,{},0);self.assertTrue(result['busy']);self.assertFalse(result['complete']);self.assertNotIn('stamped',result)
    def test_one_batch_is_not_completion_and_actual_bound_is_enforced(self):
        for stamped,remaining in [(5000,5000),(0,1),(5001,0)]:
            with tempfile.TemporaryDirectory()as t,patch.object(m,'BASE',Path(t)):
                s=Store();s.save(Path(t)/'selected.json',{'nativeActor':{'owned':True}})
                h=types.SimpleNamespace(s=s,actor=lambda *args:{'owned':True},official=lambda *args:{'stamped':stamped},database=lambda:{'remainingPublished':remaining,'probe':True})
                if stamped>5000:
                    with self.assertRaisesRegex(RuntimeError,'bounded_actual_official_provenance'):m.provenance(h,{},0)
                else:self.assertFalse(m.provenance(h,{},0)['complete'])
    def test_zero_missing_hashes_still_requires_canonical_publication_proof(self):
        for good in [False,True]:
            with tempfile.TemporaryDirectory()as t,patch.object(m,'BASE',Path(t)):
                s=Store();s.save(Path(t)/'selected.json',{'nativeActor':{'owned':True}})
                h=types.SimpleNamespace(s=s,actor=lambda *args:{'owned':True},official=lambda *args:{'stamped':0},database=lambda:{'remainingPublished':0,'probe':True},publication_proof=lambda:{'allPublishedCanonical':good})
                self.assertEqual(m.provenance(h,{},0)['complete'],good)

if __name__=='__main__':unittest.main()
