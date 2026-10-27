#!/usr/bin/env python3
"""Synthetic plans are test inputs only; no future production receipts exist."""
import copy
import ast
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('public_recovery',HERE/'arena-modern-public-rollback-v2.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
P='1'*64;H='0x'+'a'*64

def plan():
    ref=lambda name:{'file':name,'sha256':P}
    return {'format':m.FORMAT,'operationId':'abcdef0123456789','cutoverOwner':{'file':str(m.OPS/'arena-direct-native-cutover-v2.py'),'sha256':m.CUTOVER_OWNER_SHA},'cutoverResult':ref(str(m.CUTOVER/'result.json')),'predecessor':ref(str(m.CUTOVER/'result.json')),'targetAdmission':ref(str(m.TARGET/'result.json')),'targetAuth':ref(str(m.TARGET_AUTH)),'targetHelper':ref('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py'),'floor':{'block':'100','hash':H},'targetKind':'legacy_rollback','childSha256':P}

def previous():return {'epoch':'old','kind':'unified','source_id':H,'accepted_block':'100','accepted_hash':H,'review_hash':H}
def selected_row():return {'deployment':'8453:fixture','epoch':'new','kind':'legacy_rollback','sourceId':'0x'+'b'*64,'block':'100','hash':H,'reviewHash':H}
def intent(phase='selection_commit_intent',xid='123'):return {'phase':phase,'xid':xid,**({'selectedRow':selected_row()}if phase.startswith('selection')else{})}
def state(intents,status='committed'):
    return {'transactions':[{'phase':x['phase'],'xid':x['xid'],'status':status}for x in intents],'selection':m.selector(selected_row()),'mode':{'halted':True,'indexer_mode':'unified'}}

class Plans(unittest.TestCase):
    def test_actual_reference_and_scope(self):m.validate_plan(plan())
    def test_missing_actual_refs_refused(self):
        for key in ['cutoverOwner','cutoverResult','predecessor','targetAdmission','targetAuth','targetHelper']:
            p=plan();p[key]['sha256']='0'*64
            with self.subTest(key=key),self.assertRaises(m.Refusal):m.validate_plan(p)
    def test_future_oid_or_source_readiness_not_plan_input(self):
        p=plan();p['assumeReady']=True
        with self.assertRaises(m.Refusal):m.validate_plan(p)
    def test_exact_known_cutover_namespace(self):
        for name in ['/tmp/result.json',str(m.CUTOVER/'unrelated.json')]:
            p=plan();p['cutoverResult']['file']=name
            with self.assertRaises(m.Refusal):m.validate_plan(p)
        p=plan();p['cutoverResult']['file']=str(m.CUTOVER/'continuation-result-3.json');m.validate_plan(p)
        p['cutoverResult']['file']=str(m.CUTOVER/'continuation-result-0.json');m.validate_plan(p)
        p['cutoverResult']['file']=str(m.CUTOVER/'continuation-result-00.json')
        with self.assertRaises(m.Refusal):m.validate_plan(p)
    def test_recorded_floor_must_be_actual_decimal_hash(self):
        for f in [{'block':'0','hash':H},{'block':'1e9','hash':H},{'block':'100','hash':'later'}]:
            p=plan();p['floor']=f
            with self.assertRaises(m.Refusal):m.validate_plan(p)
    def test_no_arbitrary_switch_kind_or_child(self):
        for change in [{'targetKind':'legacy'},{'childSha256':'pending'}]:
            p={**plan(),**change}
            with self.assertRaises(m.Refusal):m.validate_plan(p)

class Acknowledgements(unittest.TestCase):
    def test_own_committed_xid_and_exact_selector_allow_continuation(self):
        rows=[intent()];self.assertEqual(m.acknowledge(state(rows),rows,previous()),'published')
    def test_actual_after_graph_without_recorded_xid_is_not_ack(self):
        with self.assertRaises(m.Refusal):m.acknowledge(state([]),[],previous())
    def test_unknown_running_aborted_not_mislabelled_committed(self):
        rows=[intent()]
        for status in ['in progress',None,'unknown','aborted']:
            with self.subTest(status=status),self.assertRaises(m.Refusal):m.acknowledge(state(rows,status),rows,previous())
    def test_foreign_selector_rejected_even_with_committed_owned_xid(self):
        rows=[intent()];s=state(rows);s['selection']['epoch']='foreign'
        with self.assertRaises(m.Refusal):m.acknowledge(s,rows,previous())
    def test_duplicate_own_publication_refused(self):
        rows=[intent(xid='1'),intent(xid='2')]
        with self.assertRaises(m.Refusal):m.acknowledge(state(rows),rows,previous())
    def test_owned_halt_ack_preserves_predecessor(self):
        rows=[intent('halt_commit_intent')];s=state(rows);s['selection']=previous()
        self.assertEqual(m.acknowledge(s,rows,previous()),'halted')
    def test_unhalt_ack_is_required_to_finish_unhalted_state(self):
        rows=[intent(),intent('unhalt_commit_intent','124')];s=state(rows);s['mode']['halted']=False
        self.assertEqual(m.acknowledge(s,rows,previous()),'published')
        s['transactions'][1]['status']='in progress'
        with self.assertRaises(m.Refusal):m.acknowledge(s,rows,previous())

class FilesAndSource(unittest.TestCase):
    def test_literal_overlay_keeps_unified_semantics_only(self):
        body=m.write_source_overlay('postgresql://reader:synthetic@127.0.0.1/db','legacy_rollback',H).decode()
        self.assertEqual(len(body.splitlines()),4);self.assertIn('ARENA_INDEXER_MODE=unified\n',body)
        self.assertNotIn('ARENA_DATABASE_URL=',body);self.assertNotIn('ARENA_REPOSITORY_ROOT=',body)
    def test_overlay_rejects_shell_and_line_injection(self):
        for value in ['x\nARENA_DATABASE_URL=wrong','x\rwrong',"x'",'x`','x"']:
            with self.assertRaises(m.Refusal):m.write_source_overlay(value,'legacy_rollback',H)
    def test_public_file_mode_survives_owner_umask077_and_no_overwrite(self):
        with tempfile.TemporaryDirectory()as td:
            old=os.umask(0o077)
            try:
                p=Path(td)/'public';m.save(p,b'public',0o644);self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o644)
                with self.assertRaises(FileExistsError):m.save(p,b'other',0o644)
                self.assertEqual(p.read_bytes(),b'public')
            finally:os.umask(old)
    def test_symlink_not_followed_and_boot_inode_survives_hold(self):
        with tempfile.TemporaryDirectory()as td:
            path=Path(td)/'unit';unit='synthetic.service';path.symlink_to('/etc/systemd/system/'+unit)
            before=m.boot_identity(path,unit);held=path.parent/'held';os.rename(path,held);os.link(held,path,follow_symlinks=False)
            self.assertEqual(m.boot_identity(path,unit),before)
            with self.assertRaises(FileExistsError):m.save(path,b'overwrite')
    def test_continuous_scanner_is_bounded_nonprivileged_and_boot_owned(self):
        body=m.scanner_definition().decode()
        for expected in ['DynamicUser=yes','RuntimeMaxSec=infinity','Restart=on-failure','StartLimitBurst=3','MemoryMax=512M','IPAddressAllow=localhost','LoadCredential=public-db.env:']:
            self.assertIn(expected,body)
        self.assertNotIn('RuntimeMaxSec=0\n',body);self.assertNotIn('User=yunipals-arena\n',body)
        self.assertIn(str(m.SCANNER_CHILD),body);self.assertNotIn(str(m.OPS),body)
    def test_public_program_directory_never_broadens_existing_private_mode(self):
        with tempfile.TemporaryDirectory()as td:
            p=Path(td)/'private';p.mkdir(mode=0o700)
            with self.assertRaises(m.Refusal):m.public_directory(p)
            self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o700)
    def test_moving_coverage_not_hashed_but_identity_and_private_history_are(self):
        r={'online':{'coverage':{'indexedThroughBlock':'100'},'identities':[{'incarnation':'one'}],'retainedLedger':{'cipher':'sealed'}},'actors':{'one':{'pid':2}}}
        changed=copy.deepcopy(r);changed['online']['coverage']['indexedThroughBlock']='101';self.assertEqual(m.review_hash(r),m.review_hash(changed))
        for mutate in [lambda x:x['online']['identities'][0].update(incarnation='other'),lambda x:x['online']['retainedLedger'].update(cipher='changed'),lambda x:x['actors']['one'].update(pid=3)]:
            changed=copy.deepcopy(r);mutate(changed);self.assertNotEqual(m.review_hash(r),m.review_hash(changed))
    def test_top_level_names_are_unique_and_cli_runs_after_all_definitions(self):
        tree=ast.parse(Path(m.__file__).read_text());names=[n.name for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))]
        self.assertEqual(len(names),len(set(names)));self.assertIsInstance(tree.body[-1],ast.If)
        self.assertIn("__name__",ast.unparse(tree.body[-1].test))
    def test_live_descendants_and_private_recheck_are_phase_specific(self):
        tree=ast.parse(Path(m.__file__).read_text());host=next(n for n in tree.body if isinstance(n,ast.ClassDef)and n.name=='Host');methods={n.name:n for n in host.body if isinstance(n,ast.FunctionDef)}
        for name in ['native','stop_native']:
            calls=[n for n in ast.walk(methods[name])if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='native_set']
            self.assertTrue(calls);self.assertTrue(all(any(k.arg=='allow_descendants'and isinstance(k.value,ast.Constant)and k.value.value is True for k in n.keywords)for n in calls))
        start_calls=[n for n in ast.walk(methods['start_native'])if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='native_set']
        self.assertTrue(start_calls);self.assertTrue(all(not n.keywords for n in start_calls))
        publish=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='publish');text=ast.unparse(publish)
        self.assertLess(text.index('verify_inputs('),text.index("child('unhalt'"))
    def test_no_private_restore_migration_or_old_runtime_start_api(self):
        text=Path(m.__file__).read_text()
        for command in ["pg_restore'","migrateArena(","migrationRunner(","start_original(","start_legacy("]:
            self.assertNotIn(command,text)
        self.assertIn('no_implicit_republication_after_uncertain_ack',text)

class Reconciliation(unittest.TestCase):
    def fixture(self,path):
        calls=[];r={'online':{'retainedLedger':{'sealed':'original'}}}
        h=types.SimpleNamespace(base=Path(path),load_operation=lambda:r,status=lambda:{'phase':'halted','state':{'transactions':[{'phase':'halt_commit_intent','xid':'123','status':'committed'}]}},journal_intents=lambda:[intent('halt_commit_intent')],quiet=lambda:calls.append('quiet'),target_verify=lambda:calls.append('target'),financial=lambda:calls.append('financial'),scanner_identity=lambda:calls.append('scanner'),child=lambda *a,**kw:(calls.append((a,kw))or{'applied':False,'reviewHash':H}))
        return h,calls
    def test_finish_lost_halt_ack_only_reviews_and_does_not_repeat_sql(self):
        with tempfile.TemporaryDirectory()as td:
            h,calls=self.fixture(td);out=m.finish_prepared(h)
            self.assertEqual(out['databaseWritesThisCall'],0);self.assertEqual(calls[-1][0],('switch',));self.assertNotIn('halt',str(calls[-1][0]));self.assertTrue((Path(td)/'official-review.json').exists())
    def test_unknown_halt_cannot_finish_and_duplicate_review_not_repeated(self):
        with tempfile.TemporaryDirectory()as td:
            h,calls=self.fixture(td);h.status=lambda:{'phase':'original','state':{}}
            with self.assertRaises(m.Refusal):m.finish_prepared(h)
            self.assertEqual(calls,[])
            h,calls=self.fixture(td);m.finish_prepared(h)
            with self.assertRaises(m.Refusal):m.finish_prepared(h)
    def test_scanner_stop_rejects_selected_public_source_before_service_action(self):
        calls=[];h=types.SimpleNamespace(target_verify=lambda:None,load_operation=lambda:None,journal_intents=lambda:[],h=types.SimpleNamespace(files_and_roles=lambda:None),child=lambda *a,**kw:{'selection':{'kind':'legacy_rollback','source_id':H}},run=lambda *a,**kw:calls.append(a))
        with self.assertRaises(m.Refusal):m.scanner_stop(h,P)
        self.assertEqual(calls,[])

class ActualFilesystemAcknowledgements(unittest.TestCase):
    def test_exact_source_inode_ack_after_successful_replace_without_repeat(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'protected',lambda p,*a,**kw:Path(p).read_bytes()):
            root=Path(td);target=root/'unit';target.write_bytes(b'old');receipt=root/'ack';intent=root/'intent';prepared=root/'prepared';body=b'new';meta={'sourceFile':'fixed','sourceSha256':P}
            calls=[];original=m.save
            def lost(path,value,*args):
                if path==receipt:raise RuntimeError('synthetic lost ack')
                return original(path,value,*args)
            with patch.object(m,'save',lost),self.assertRaises(RuntimeError):m.install_owned_file(target,m.sha(b'old'),body,receipt,intent,prepared,meta)
            inode=target.stat().st_ino
            with patch.object(m.os,'replace',side_effect=AssertionError('must not repeat')):
                result=m.install_owned_file(target,m.sha(b'old'),body,receipt,intent,prepared,meta)
            self.assertEqual(result['identity'][1],inode);self.assertEqual(target.read_bytes(),body)
    def test_prepared_exact_inode_can_finish_before_original_replace(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'protected',lambda p,*a,**kw:Path(p).read_bytes()):
            root=Path(td);target=root/'unit';target.write_bytes(b'old');receipt=root/'ack';intent=root/'intent';prepared=root/'prepared';meta={'sourceFile':'fixed','sourceSha256':P}
            with patch.object(m.os,'replace',side_effect=RuntimeError('synthetic no replacement ACK')),self.assertRaises(RuntimeError):m.install_owned_file(target,m.sha(b'old'),b'new',receipt,intent,prepared,meta)
            expected=prepared.stat().st_ino
            result=m.install_owned_file(target,m.sha(b'old'),b'new',receipt,intent,prepared,meta)
            self.assertEqual(target.stat().st_ino,expected);self.assertEqual(result['identity'][1],expected)
    def test_same_bytes_foreign_inode_not_adopted(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'protected',lambda p,*a,**kw:Path(p).read_bytes()):
            root=Path(td);target=root/'unit';target.write_bytes(b'old');receipt=root/'ack';intent=root/'intent';prepared=root/'prepared';meta={'sourceFile':'fixed','sourceSha256':P}
            m.install_owned_file(target,m.sha(b'old'),b'new',receipt,intent,prepared,meta)
            foreign=root/'foreign';foreign.write_bytes(b'new');os.chmod(foreign,0o644);os.replace(foreign,target)
            with self.assertRaises(m.Refusal):m.install_owned_file(target,m.sha(b'old'),b'new',receipt,intent,prepared,meta)
    def test_initial_scanner_lost_ack_is_acknowledged_without_managercall(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'SCANNER_BASE',Path(td)):
            observed={'format':m.FORMAT,'state':'running','runtime':{'unitSha256':P,'bootLink':{'path':'fixed'}},'childSha256':P,'targetAdmissionSha256':P,'configSha256':P}
            with patch.object(m,'scanner_inspect',return_value=observed):
                out=m.scanner_ack_start(object(),m.sha(m.encode(observed)));self.assertTrue(out['startAckRecovered'])
                with self.assertRaises(m.Refusal):m.scanner_ack_start(object(),m.sha(m.encode(observed)))
    def stop_fixture(self,root):
        unit=m.UNIT;link=root/unit;link.symlink_to('/etc/systemd/system/'+unit);boot=m.boot_identity(link,unit)
        m.save(root/'stop-intent.json',{'pid':123,'bootLink':boot})
        h=types.SimpleNamespace(target_verify=lambda:None,h=types.SimpleNamespace(files_and_roles=lambda:None),child=lambda *a,**kw:{'selection':{'kind':'unified','source_id':m.NATIVE_RELEASE}},owner=types.SimpleNamespace(activation_paths=lambda unit:[str(link)]if os.path.lexists(link)else[]))
        return h,link,boot
    def test_finish_scanner_stop_after_terminal_lost_ack_removes_only_owned_boot(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'SCANNER_BASE',Path(td)),patch.object(m,'protected',lambda p,*a,**kw:Path(p).read_bytes()),patch.object(m,'scanner_inspect',return_value={'state':'terminal'}),patch.object(m,'verified_native_return',return_value={'verified':True}):
            h,link,boot=self.stop_fixture(Path(td));out=m.finish_scanner_stop(h)
            self.assertFalse(os.path.lexists(link));self.assertTrue(out['bootDisabled']);self.assertFalse(out['nativeActorsChanged'])
    def test_finish_scanner_stop_handles_owned_unlink_ack_loss(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'SCANNER_BASE',Path(td)),patch.object(m,'protected',lambda p,*a,**kw:Path(p).read_bytes()),patch.object(m,'scanner_inspect',return_value={'state':'terminal'}),patch.object(m,'verified_native_return',return_value={'verified':True}):
            h,link,boot=self.stop_fixture(Path(td));m.save(Path(td)/'boot-remove-intent.json',boot);link.unlink();self.assertTrue(m.finish_scanner_stop(h)['bootDisabled'])
    def test_foreign_same_target_scanner_boot_inode_is_refused(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'SCANNER_BASE',Path(td)),patch.object(m,'protected',lambda p,*a,**kw:Path(p).read_bytes()),patch.object(m,'scanner_inspect',return_value={'state':'terminal'}),patch.object(m,'verified_native_return',return_value={'verified':True}):
            h,link,boot=self.stop_fixture(Path(td));other=Path(td)/'foreign';other.symlink_to(boot['target']);os.replace(other,link)
            with self.assertRaises(m.Refusal):m.finish_scanner_stop(h)
            self.assertTrue(os.path.lexists(link))

class RealCoordinatorEntry(unittest.TestCase):
    def fixture(self,root):
        calls=[];names=['synthetic-'+str(i)+'.service'for i in range(8)];bodies={n:{'body':b'current-modern-native'}for n in names}
        r={'actors':{n:{'unitSha256':m.sha(v['body'])}for n,v in bodies.items()},'bootLinks':{},'online':{'retainedLedger':{'sealed':'actual'},'identities':[]},'predecessor':previous()}
        def child(action,**kw):calls.append(action);return{'applied':False,'reviewHash':H}
        h=types.SimpleNamespace(base=root/'operation',plan=plan(),h=types.SimpleNamespace(native=bodies),review=lambda:r,retire_links=lambda x:calls.append('retire'),stop_native=lambda x:calls.append('stop'),child=child)
        return h,r,calls
    def test_real_prepare_entry_orders_boot_hold_drain_halt_official_review(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'AREA',Path(td)):
            h,r,calls=self.fixture(Path(td));out=m.prepare(h,r,m.review_hash(r))
            self.assertEqual(calls,['retire','stop','halt','switch']);self.assertFalse(out['sourceSelectionChanged']);self.assertTrue((h.base/'operation.json').exists())
    def test_stop_ack_failure_retains_operation_but_never_enters_sql(self):
        with tempfile.TemporaryDirectory()as td,patch.object(m,'AREA',Path(td)):
            h,r,calls=self.fixture(Path(td))
            def fail(_):calls.append('stop');raise RuntimeError('lost service ACK')
            h.stop_native=fail
            with self.assertRaises(RuntimeError):m.prepare(h,r,m.review_hash(r))
            self.assertEqual(calls,['retire','stop']);self.assertTrue((h.base/'operation.json').exists());self.assertFalse((h.base/'official-review.json').exists())
    def test_changed_original_input_is_refused_before_any_native_start_action(self):
        calls=[]
        def refuse(*args):calls.append('verify');raise RuntimeError('synthetic original input changed')
        self_host=types.SimpleNamespace(h=types.SimpleNamespace(m=types.SimpleNamespace(verify_inputs=refuse),o=object(),binding={'privateInputHashes':{'retained':'expected'}}),run=lambda *a,**kw:calls.append('systemctl'),restore_links=lambda x:calls.append('boot'))
        with self.assertRaises(RuntimeError):m.Host.start_native(self_host,{})
        self.assertEqual(calls,['verify'])
    def test_abort_refuses_any_publication_intent_before_worker_restart(self):
        calls=[];h=types.SimpleNamespace(load_operation=lambda:{},target_verify=lambda:None,status=lambda:{'phase':'halted'},journal_intents=lambda:[intent()],quiet=lambda:calls.append('quiet'))
        with self.assertRaises(m.Refusal):m.abort_review(h)
        self.assertEqual(calls,[])


qualification_spec=importlib.util.spec_from_file_location('rollback_qualification_fixture',HERE/'source6-normal-proxy-requalification-v1-test.py')
qualification=importlib.util.module_from_spec(qualification_spec);qualification_spec.loader.exec_module(qualification)


class AcknowledgedFinancialAuthority(unittest.TestCase):
    def setUp(self):
        self.fixture=qualification.Requalification();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.q=qualification.m;self.ack=self.fixture.acknowledge();self.saved=json.loads(self.q.RESULT.read_bytes())
        self.binding=patch.object(m,'SOURCE_QUALIFICATION_RECEIPT',self.ack['qualificationReceiptSha256']);self.binding.start();self.addCleanup(self.binding.stop)
        self.h=object.__new__(m.Host)
        self.h.owner=types.SimpleNamespace(NORMAL_SHA=self.q.NORMAL_SHA,NORMAL_RECEIPT=self.q.ORIGINAL_SHA,
            SOURCE_QUALIFICATION_RESULT=self.q.RESULT,SOURCE_RUNTIME=self.fixture.f.normal_identity,
            SOURCE_NATIVE=self.saved['nativeIdentity'],SOURCE_FINANCIAL_EXPIRY=self.fixture.n.PROFILE_EXPIRY)
        def loader(path,pin,name):
            self.assertEqual(path,m.OPS/'source6-normal-proxy-requalification-v1.py')
            self.assertEqual(pin,m.SOURCE_QUALIFICATION_SHA)
            return self.q
        self.h.h=types.SimpleNamespace(p=types.SimpleNamespace(load=loader))
        self.actions=len(self.fixture.f.actions)

    def bind(self,obj,key,value):
        p=patch.object(obj,key,value);p.start();self.addCleanup(p.stop)

    def test_main_source_down_still_admits_exact_current_free_financial_authority(self):
        def forbidden(*args,**kwargs):raise AssertionError('live main source must not be required')
        for obj,key in [(self.q,'validate_current'),(self.q,'capture'),(self.fixture.n,'validate'),
                        (self.fixture.n,'current_identity'),(self.fixture.n,'native'),(self.fixture.n,'normal_configuration')]:
            self.bind(obj,key,forbidden)
        value=self.h.financial()
        self.assertFalse(value['sourceRuntimeRequired']);self.assertFalse(value['newPaidAllowance'])
        self.assertFalse(value['originalWholeValidationPassed']);self.assertFalse(value['financialWindowRenewed'])
        self.assertEqual(value['qualificationReceiptSha256'],self.ack['qualificationReceiptSha256'])
        self.assertEqual(len(self.fixture.f.actions),self.actions)
        self.assertTrue(all(sql.startswith('SELECT ')for sql in self.fixture.f.queries))

    def test_changed_acknowledgement_or_original_runtime_record_refuses(self):
        with patch.object(m,'SOURCE_QUALIFICATION_RECEIPT','f'*64),self.assertRaisesRegex(m.Refusal,'financial_acknowledgement'):
            self.h.financial()
        with patch.object(self.h.owner,'NORMAL_RECEIPT','e'*64),self.assertRaises(m.Refusal):self.h.financial()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_current_proxy_restart_or_financial_policy_drift_is_not_renewal(self):
        old=copy.deepcopy(self.fixture.current_proxies['base'])
        self.fixture.current_proxies['base']['pid']='999999'
        with self.assertRaisesRegex(m.Refusal,'free_only_financial'):self.h.financial()
        self.fixture.current_proxies['base']=old
        self.bind(self.fixture.s,'financial',lambda:{'foreign':'policy'})
        with self.assertRaisesRegex(m.Refusal,'free_only_financial'):self.h.financial()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_restarted_proxy_during_capture_refuses_and_does_not_start_any_service(self):
        calls=0
        def changing():
            nonlocal calls
            calls+=1;value=copy.deepcopy(self.fixture.current_proxies)
            if calls==2:value['base']['pid']='99999'
            return value
        self.bind(self.fixture.s,'proxies',changing)
        with self.assertRaisesRegex(m.Refusal,'during_recovery_review'):self.h.financial()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_changed_boot_or_expired_profile_refuses(self):
        with patch.object(self.fixture.s,'BOOT','foreign-boot'),self.assertRaisesRegex(m.Refusal,'same_boot'):self.h.financial()
        self.bind(self.fixture.n,'PROFILE_EXPIRY','2026-10-01T00:00:00+00:00')
        with self.assertRaises(m.Refusal):self.h.financial()
        self.assertEqual(len(self.fixture.f.actions),self.actions)

    def test_false_claims_cannot_be_accepted_even_under_a_different_test_receipt_pin(self):
        for key,value in [('paidAuthority',True),('financialWindowRenewed',True),('originalWholeValidationPassed',True),('sourceRestarted',True)]:
            changed={**self.saved,key:value};raw=self.q.encode(changed)+b'\n';original=self.q.protected
            def reader(path,*args):return raw if path==self.q.RESULT else original(path,*args)
            with self.subTest(key=key),patch.object(m,'SOURCE_QUALIFICATION_RECEIPT',m.sha(raw)),patch.object(self.q,'protected',reader),self.assertRaisesRegex(m.Refusal,'explicit_free_only'):
                self.h.financial()


class ImmutableRecoveryBoundaries(unittest.TestCase):
    def test_only_producer_acceptor_and_financial_authority_differ(self):
        def tree(path):
            value=ast.parse(path.read_text());result=[]
            for node in value.body:
                if isinstance(node,ast.Assign):
                    names={t.id for t in node.targets if isinstance(t,ast.Name)}
                    if names<={'FORMAT','CUTOVER_OWNER_SHA','AREA','CUTOVER','SOURCE_QUALIFICATION_SHA','SOURCE_QUALIFICATION_RECEIPT'}:continue
                if isinstance(node,ast.ClassDef)and node.name=='Host':
                    node=copy.deepcopy(node);node.body=[item for item in node.body if not isinstance(item,ast.FunctionDef)or item.name!='financial']
                result.append(node)
            value=ast.Module(body=result,type_ignores=[])
            for node in ast.walk(value):
                if isinstance(node,ast.Constant)and isinstance(node.value,str):
                    node.value=node.value.replace('arena-direct-native-cutover-v2.py','arena-direct-native-cutover-v1.py').replace('yunipals-arena-direct-native-cutover-v2','yunipals-arena-direct-native-cutover-v1')
            return ast.dump(value,include_attributes=False)
        self.assertEqual(tree(HERE/'arena-modern-public-rollback-v1.py'),tree(HERE/'arena-modern-public-rollback-v2.py'))
        self.assertEqual(m.CUTOVER_OWNER_SHA,'8c1c31233dd112daf036ee75d44d8847d70dfe1181aec509ce3b895a06ebe079')
        self.assertEqual(m.CHILD.name,'arena-modern-public-rollback-v1.mjs')
        self.assertEqual(m.UNIT,'yunipals-arena-public-rollback-v1.service')


if __name__=='__main__':unittest.main(verbosity=2)

