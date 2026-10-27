#!/usr/bin/env python3
"""Offline owner controls. No systemd, database, provider or production access."""
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('direct_owner',HERE/'arena-direct-native-cutover-v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
proposal=json.loads((HERE.parent/'arena-native-admission-20261022/proposal.current.json').read_bytes())

def auth():
    return {'format':'yunipals-arena-native-role-auth-v1','roles':{w['role']:100+i for i,w in enumerate(proposal['workers'])},'sourceRole':{'name':'arena_native_reader','oid':200},'credentialFiles':{p:'a'*64 for p in [*[w['privateOverlay']for w in proposal['workers']],'/etc/yunipals-arena/native-read.env']},'operationalDatabaseOid':2303669,'sourceDatabaseOid':17584,'originalActorsReceiptSha256':'b'*64,'grantsVerified':True,'tcpAuthenticationProven':True,'loginEnabled':True,'operatorSha256':m.AUTH_OPERATOR_SHA,'admissionResultSha256':'c'*64,'admissionHelperSha256':m.ADMISSION_HELPER_SHA,'setupResultSha256':'d'*64}

def state():
    return {'selection':[],'mode':{'indexer_mode':'legacy','halted':False},'identities':[{'id':str(i),'incarnation':'legacy','cipher_context':m.DEPLOYMENT+'/'+str(i)}for i in [1,2]],'transactions':[{'xid':'123','status':'aborted'}]}

def forward_fixture(selected=False,unhalted=False):
    origins=[{'id':str(i),'incarnation':'0x'+str(i)*64,'opened':{'id':'opening-'+str(i),'blockHash':'0x'+'a'*64}}for i in [1,2]]
    adoption={'phase':'adoption_commit_intent','xid':'11','origins':origins,'retainedLedger':{'fixed':'hashes'}}
    s={'selection':[],'history':[],'mode':{'indexer_mode':'unified','halted':not unhalted},'identities':[{'id':o['id'],'incarnation':o['incarnation'],'opened_event_id':o['opened']['id'],'opened_block_hash':o['opened']['blockHash'],'bound_release_id':m.SOURCE_ID,'cipher_context':m.DEPLOYMENT+'/'+o['id']}for o in origins],'transactions':[{'phase':'adoption_commit_intent','xid':'11','status':'committed'}],'retainedLedger':{'verified':True,'sha256':'a'*64}}
    intents=[adoption]
    if selected:
        row={'deployment':m.DEPLOYMENT,'epoch':'owned-epoch','kind':'unified','sourceId':m.SOURCE_ID,'block':'100','hash':'0x'+'b'*64,'reviewHash':'0x'+'c'*64}
        intents.append({'phase':'selection_commit_intent','xid':'12','selectedRow':row});s['transactions'].append({'phase':'selection_commit_intent','xid':'12','status':'committed'})
        s['selection']=[{'epoch':row['epoch'],'kind':row['kind'],'source_id':row['sourceId'],'accepted_block':row['block'],'accepted_hash':row['hash'],'review_hash':row['reviewHash']}];s['history']=[{'epoch':row['epoch'],'deployment':m.DEPLOYMENT,'review_hash':row['reviewHash']}]
        if unhalted:
            intents.append({'phase':'unhalt_commit_intent','xid':'13','epoch':row['epoch']});s['transactions'].append({'phase':'unhalt_commit_intent','xid':'13','status':'committed'})
    return s,intents,adoption

class Controls(unittest.TestCase):
    def test_post_unhalt_python_ffmpeg_descendants_belong_to_exact_native_main(self):
        group='/system.slice/yunipals-arena-native-media.service'
        def row(parent,g=group):return{'uid':[971]*4,'gid':[965]*4,'nnp':'1','CapPrm':'0','CapEff':'0','CapAmb':'0','parent':parent,'group':g}
        rows={10:row(1),11:row(10),12:row(11)}
        self.assertEqual(m.descendant_owner(12,{group:10},rows.__getitem__),group)
        for change in [lambda:rows[12].update(group='/system.slice/foreign.service'),lambda:rows[12].update(parent=1),lambda:rows[12].update(CapEff='1'),lambda:rows[12].update(uid=[0]*4),lambda:rows[12].update(nnp='0')]:
            rows={10:row(1),11:row(10),12:row(11)};change()
            with self.assertRaises(m.CutoverFailure):m.descendant_owner(12,{group:10},rows.__getitem__)
    def test_confirmed_adoption_without_selector_selects_publish_only(self):
        s,i,a=forward_fixture();self.assertEqual(m.forward_phase(s,i,a)['phase'],'publish')
        i.append({'phase':'selection_commit_intent','xid':'14','selectedRow':{}});s['transactions'].append({'phase':'selection_commit_intent','xid':'14','status':'aborted'})
        self.assertEqual(m.forward_phase(s,i,a)['phase'],'publish')
    def test_confirmed_selector_is_reused_after_lost_ack(self):
        s,i,a=forward_fixture(True);r=m.forward_phase(s,i,a);self.assertEqual(r['phase'],'native');self.assertEqual(r['selection']['epoch'],'owned-epoch')
    def test_unhalted_state_requires_its_own_actual_committed_xid_and_epoch(self):
        s,i,a=forward_fixture(True,True);self.assertEqual(m.forward_phase(s,i,a)['phase'],'complete')
        s['transactions'][-1]['status']='aborted'
        with self.assertRaises(m.CutoverFailure):m.forward_phase(s,i,a)
        s,i,a=forward_fixture(True);s['mode']['halted']=False
        with self.assertRaises(m.CutoverFailure):m.forward_phase(s,i,a)
    def test_forward_refuses_unknown_inprogress_or_foreign_selector(self):
        for status in [None,'in progress']:
            s,i,a=forward_fixture(True);s['transactions'][1]['status']=status
            with self.assertRaises(m.CutoverFailure):m.forward_phase(s,i,a)
        for field,value in [('epoch','foreign'),('source_id','0x'+'e'*64),('accepted_hash','0x'+'f'*64)]:
            s,i,a=forward_fixture(True);s['selection'][0][field]=value
            with self.assertRaises(m.CutoverFailure):m.forward_phase(s,i,a)
    def test_forward_refuses_changed_adopted_origin_aad_or_lost_ledger(self):
        for change in [lambda s:s['identities'][0].update(incarnation='0x'+'f'*64),lambda s:s['identities'][0].update(cipher_context='foreign'),lambda s:s['retainedLedger'].update(verified=False),lambda s:s['history'].clear()]:
            s,i,a=forward_fixture(True);change(s)
            with self.assertRaises(m.CutoverFailure):m.forward_phase(s,i,a)
    def test_explicit_resume_restarts_only_inactive_owned_worker_and_skips_committed_unhalt(self):
        s,intents,adoption=forward_fixture(True,True);calls=[]
        native={'units':{'native-api.service':{'state':'running','identity':{'pid':1},'boot':{}},'native-referee.service':{'state':'inactive','invocation':'prior-owned','boot':{}}},'initialStartIntentPresent':True}
        review={'forward':m.forward_phase(s,intents,adoption),'native':native,'normal':{'actual':True}}
        h=object.__new__(m.Host);h.native={u:{}for u in native['units']};h.normal=lambda:review['normal'];h.adopted_state=lambda:(adoption,copy.deepcopy(s));h.child=lambda action,**kw:calls.append(action);h.files_and_roles=lambda:{};h.capacity=lambda:{};h.native_resume_review=lambda epoch,**kw:copy.deepcopy(native);h.native_boot=lambda *a,**kw:None;h.stable_native=lambda p,**kw:{'new':'owned-actors'};h.native_set=lambda **kw:{'new':'owned-actors'}
        h.o=None;h.binding={'privateInputHashes':{'retained':'expected'}};h.m=types.SimpleNamespace(run=lambda args,**kw:calls.append(args),verify_inputs=lambda *a:calls.append('private-inputs'))
        with tempfile.TemporaryDirectory()as d,patch.object(m,'BASE',Path(d)),patch.object(m,'transaction_intents',lambda:intents):
            m.save(m.BASE/'native-start-intent.json',{'epoch':'owned-epoch'})
            r=h.continue_apply(review,m.sha(m.encoded(review)))
        self.assertTrue(r['completed']);self.assertNotIn('unhalt',calls);self.assertNotIn('commit',calls);self.assertEqual([c for c in calls if isinstance(c,list)and 'start'in c],[['/usr/bin/systemctl','start','--no-block','native-referee.service']]);self.assertEqual(r['unhaltXid'],'13')
    def test_healthy_lost_unhalt_ack_finish_does_not_reload_or_start_services(self):
        s,intents,adoption=forward_fixture(True,True);calls=[]
        native={'units':{'native-media.service':{'state':'running','identity':{'pid':1},'boot':{'acknowledged':True}}},'initialStartIntentPresent':True}
        review={'forward':m.forward_phase(s,intents,adoption),'native':native,'normal':{'actual':True}}
        h=object.__new__(m.Host);h.native={u:{}for u in native['units']};h.normal=lambda:review['normal'];h.adopted_state=lambda:(adoption,copy.deepcopy(s));h.child=lambda action,**kw:calls.append(action);h.files_and_roles=lambda:{};h.capacity=lambda:{};h.native_resume_review=lambda epoch,**kw:copy.deepcopy(native)
        h.native_boot=lambda *a,**kw:(_ for _ in()).throw(AssertionError('unnecessary boot write'))
        def stable(p,**kw):self.assertTrue(kw['allow_descendants']);return{'main':'stable'}
        h.stable_native=stable;h.native_set=lambda **kw:{'main':'stable'};h.o=None;h.binding={'privateInputHashes':{'retained':'expected'}};h.m=types.SimpleNamespace(run=lambda *a,**kw:(_ for _ in()).throw(AssertionError('unexpected manager mutation')),verify_inputs=lambda *a:calls.append('private-inputs'))
        with tempfile.TemporaryDirectory()as d,patch.object(m,'BASE',Path(d)),patch.object(m,'transaction_intents',lambda:intents):
            m.save(m.BASE/'native-start-intent.json',{'epoch':'owned-epoch'});r=h.continue_apply(review,m.sha(m.encoded(review)))
        self.assertTrue(r['completed']);self.assertEqual(calls,['verify-source','private-inputs']);self.assertEqual(r['unhaltXid'],'13')
    def test_changed_retained_private_inputs_after_stability_blocks_unhalt_and_receipt(self):
        for complete in [False,True]:
            with self.subTest(committed_unhalt=complete):
                s,intents,adoption=forward_fixture(True,complete);calls=[];private={'retained':'expected'}
                native={'units':{'native-api.service':{'state':'running','identity':{'pid':1},'boot':{'acknowledged':True}}},'initialStartIntentPresent':True}
                review={'forward':m.forward_phase(s,intents,adoption),'native':native,'normal':{'actual':True}}
                h=object.__new__(m.Host);h.native={u:{}for u in native['units']};h.normal=lambda:review['normal'];h.adopted_state=lambda:(adoption,copy.deepcopy(s));h.child=lambda action,**kw:calls.append(action);h.files_and_roles=lambda:{};h.capacity=lambda:{};h.native_resume_review=lambda epoch,**kw:copy.deepcopy(native)
                h.o=object();h.binding={'privateInputHashes':{'retained':'expected'}}
                def stable(*args,**kwargs):
                    calls.append('stable');private['retained']='changed-after-review';return {'main':'stable'}
                def verify(owner,expected):
                    self.assertIs(owner,h.o);self.assertEqual(expected,{'retained':'expected'});calls.append('private-inputs');m.need(private==expected,'retained_private_input_changed')
                h.stable_native=stable;h.native_set=lambda **kw:{'main':'stable'};h.m=types.SimpleNamespace(run=lambda *a,**kw:(_ for _ in()).throw(AssertionError('unexpected manager mutation')),verify_inputs=verify)
                with tempfile.TemporaryDirectory()as d,patch.object(m,'BASE',Path(d)),patch.object(m,'transaction_intents',lambda:intents):
                    m.save(m.BASE/'native-start-intent.json',{'epoch':'owned-epoch'})
                    with self.assertRaisesRegex(m.CutoverFailure,'retained_private_input_changed'):h.continue_apply(review,m.sha(m.encoded(review)))
                    self.assertFalse(list(m.BASE.glob('continuation-result-*.json')))
                self.assertEqual(calls,['verify-source','stable','private-inputs']);self.assertNotIn('unhalt',calls)
    def test_exact_plan_actual_floor_and_no_placeholder_pins(self):
        p={'format':m.FORMAT,'roleAuth':{'file':str(m.AUTH_BASE/'auth-result.json'),'sha256':'a'*64},'actorsReceipt':{'file':'/root/actual-actors.json','sha256':'b'*64},'admissionProposal':{'file':'/root/proposal.json','sha256':m.PROPOSAL_SHA},'floor':{'block':'52900000','hash':'0x'+'c'*64}}
        m.validate_plan(p)
        for update in [{'floor':{'block':'0','hash':'0x'+'c'*64}},{'floor':{'block':'52900000','hash':'unknown'}},{'roleAuth':{'file':'relative.json','sha256':'a'*64}},{'roleAuth':{'file':'/root/x','sha256':'0'*64}},{'extra':'unknown'}]:
            with self.assertRaises(m.CutoverFailure):m.validate_plan({**p,**update})
    def test_auth_requires_same_nine_roles_files_producers_and_target(self):
        a=auth();m.validate_auth_receipt(a,proposal,'b'*64)
        cases=[]
        for key,value in [('loginEnabled',False),('operatorSha256','a'*64),('admissionHelperSha256','a'*64),('operationalDatabaseOid',9),('originalActorsReceiptSha256','e'*64)]:cases.append({**a,key:value})
        cases.extend([{**a,'roles':dict(list(a['roles'].items())[:-1])},{**a,'credentialFiles':{**a['credentialFiles'],'/tmp/foreign.env':'a'*64}},{**a,'roles':{r:101 for r in a['roles']}}])
        for v in cases:
            with self.assertRaises(m.CutoverFailure):m.validate_auth_receipt(v,proposal,'b'*64)
    def test_inverse_refuses_committed_unknown_or_in_progress_sql(self):
        m.pre_adoption_inverse(state())
        for status in ['committed','in progress',None]:
            s=state();s['transactions'][0]['status']=status
            with self.assertRaises(m.CutoverFailure):m.pre_adoption_inverse(s)
    def test_inverse_refuses_adopted_identity_or_selected_source(self):
        for change in [{'selection':[{'epoch':'real'}]},{'identities':[{'id':'1','incarnation':'0x'+'a'*64,'cipher_context':m.DEPLOYMENT+'/1'}]},{'mode':{'indexer_mode':'unified','halted':False}},{'mode':{'indexer_mode':'unified','halted':True}}]:
            with self.assertRaises(m.CutoverFailure):m.pre_adoption_inverse({**state(),**change})
    def test_native_template_slice_is_fixed_and_not_generic(self):
        u='yunipals-arena-native-execution@lobby.service';s=r'system-yunipals\x2darena\x2dnative\x2dexecution.slice'
        self.assertEqual(m.valid_native_group(u,s,'/system.slice/'+s+'/'+u),Path('/sys/fs/cgroup/system.slice')/s/u)
        self.assertEqual(m.valid_native_group('yunipals-arena-native-api.service','system.slice','/system.slice/yunipals-arena-native-api.service'),Path('/sys/fs/cgroup/system.slice/yunipals-arena-native-api.service'))
        for sl,cg in [('user.slice','/user.slice/'+u),('system.slice','/system.slice/foreign.service'),('system-foreign.slice','/system.slice/system-foreign.slice/'+u)]:
            with self.assertRaises(m.CutoverFailure):m.valid_native_group(u,sl,cg)
    def test_journal_rejects_truncated_or_wrong_format_ack(self):
        with tempfile.TemporaryDirectory()as d:
            p=Path(d)/'ack';p.write_text('{"format":"foreign"}\n')
            with self.assertRaises(m.CutoverFailure):m.journal_rows(p)
            p.write_text('{"format":')
            with self.assertRaises(json.JSONDecodeError):m.journal_rows(p)
    def test_save_never_overwrites_owned_receipt(self):
        with tempfile.TemporaryDirectory()as d:
            p=Path(d)/'ack';m.save(p,{'a':1})
            with self.assertRaises(FileExistsError):m.save(p,{'a':2})
            self.assertEqual(json.loads(p.read_bytes()),{'a':1});self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
    def test_sealed_public_inputs_read_across_uid_without_ops_permissions(self):
        raw=(HERE/'arena-direct-native-cutover-v1.mjs').read_bytes();fd=m.sealed('arena-direct-native-child',raw)
        node=Path('/root/.nvm/versions/node/v24.18.1/bin/node');nodefd=os.open(node,os.O_RDONLY)
        try:
            self.assertEqual(fcntl.fcntl(fd,fcntl.F_GET_SEALS),15)
            with self.assertRaises(PermissionError):os.write(fd,b'changed')
            peer=pwd.getpwnam('nobody')
            script="import{readFileSync}from'node:fs';const f=+process.argv[1];const raw=readFileSync(f);const m=await import('data:text/javascript;base64,'+raw.toString('base64'));m.publicDescriptor(f,'arena-direct-native-child',process.argv[2]);process.stdout.write(JSON.stringify({ok:true,uid:process.getuid()}));"
            args=['/usr/bin/setpriv','--reuid='+str(peer.pw_uid),'--regid='+str(peer.pw_gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/proc/self/fd/'+str(nodefd),'--input-type=module','--eval',script,str(fd),m.sha(raw)]
            result=subprocess.run(args,env={'PATH':'/usr/bin:/bin'},pass_fds=(fd,nodefd),capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(json.loads(result.stdout),{'ok':True,'uid':peer.pw_uid});self.assertEqual(result.stderr,b'')
        finally:os.close(fd);os.close(nodefd)
    def test_inode_is_durable_before_live_unit_publication_even_if_reload_ack_lost(self):
        with tempfile.TemporaryDirectory()as d:
            base=Path(d)/'evidence';base.mkdir();units=Path(d)/'units';units.mkdir()
            realPath=Path
            def redirected(value):return units if str(value)=='/etc/systemd/system'else realPath(value)
            h=object.__new__(m.Host);h.native={'fixture.service':{'body':b'[Service]\n','sha256':m.sha(b'[Service]\n')}}
            h.m=types.SimpleNamespace(run=lambda *a,**k:(_ for _ in()).throw(RuntimeError('lost reload ACK')))
            with patch.object(m,'BASE',base),patch.object(m,'Path',redirected):
                with self.assertRaisesRegex(RuntimeError,'lost reload'):h.install_units()
            receipt=json.loads((base/'fixture.service.file-prepared.json').read_bytes());s=(units/'fixture.service').stat()
            self.assertEqual((receipt['dev'],receipt['ino']),(s.st_dev,s.st_ino));self.assertEqual(receipt['sha256'],m.sha((units/'fixture.service').read_bytes()));self.assertFalse(Path(receipt['prepared']).exists())
    def boot_fixture(self,d):
        base=Path(d)/'evidence';base.mkdir();units=Path(d)/'units';units.mkdir();wants=units/'multi-user.target.wants';wants.mkdir();realPath=Path
        def redirected(value):
            value=str(value)
            if value=='/etc/systemd/system':return units
            if value=='/etc/systemd/system/multi-user.target.wants':return wants
            return realPath(value)
        h=object.__new__(m.Host);h.p=types.SimpleNamespace(protected=lambda p,*a:p.read_bytes());unit='fixture.service';link=wants/unit
        return h,base,redirected,unit,link
    def test_lost_native_boot_ack_finishes_same_prepared_inode(self):
        with tempfile.TemporaryDirectory()as d:
            h,base,redirected,unit,link=self.boot_fixture(d);real_save=m.save
            def fail_ack(p,v):
                if p.name==unit+'.native-boot.json':raise RuntimeError('lost boot ack')
                real_save(p,v)
            with patch.object(m,'BASE',base),patch.object(m,'Path',redirected),patch.object(m,'activation_paths',lambda u:[str(link)]if os.path.lexists(link)else[]):
                with patch.object(m,'save',fail_ack):
                    with self.assertRaisesRegex(RuntimeError,'lost boot'):h.native_boot(unit,write=True)
                before=link.lstat();review=h.native_boot(unit);self.assertTrue(review['published']);self.assertFalse(review['acknowledged'])
                result=h.native_boot(unit,write=True);self.assertTrue(result['acknowledged']);self.assertEqual((before.st_dev,before.st_ino),(link.lstat().st_dev,link.lstat().st_ino))
    def test_foreign_native_boot_inode_refuses_finish_without_overwrite(self):
        with tempfile.TemporaryDirectory()as d:
            h,base,redirected,unit,link=self.boot_fixture(d)
            with patch.object(m,'BASE',base),patch.object(m,'Path',redirected),patch.object(m,'activation_paths',lambda u:[str(link)]if os.path.lexists(link)else[]):
                h.native_boot(unit,write=True);link.unlink();link.symlink_to('/foreign/worker.service');foreign=link.lstat()
                with self.assertRaises(m.CutoverFailure):h.native_boot(unit,write=True)
                self.assertEqual((foreign.st_dev,foreign.st_ino),(link.lstat().st_dev,link.lstat().st_ino));self.assertEqual(os.readlink(link),'/foreign/worker.service')
    def test_wrong_fresh_review_refuses_before_operation_or_service_action(self):
        h=types.SimpleNamespace()
        with self.assertRaisesRegex(m.CutoverFailure,'exact_fresh_online'):m.apply(h,{'actual':True},'0'*64)
    def test_current_capacity_requires_full_pools_and_one_owner_probe(self):
        self.assertTrue(m.capacity_admitted({'readOnly':True,'maximum':96,'reserved':3,'used':32},60)['admitted'])
        with self.assertRaisesRegex(m.CutoverFailure,'headroom'):m.capacity_admitted({'readOnly':True,'maximum':96,'reserved':3,'used':33},60)
        with self.assertRaises(m.CutoverFailure):m.capacity_admitted({'readOnly':False,'maximum':100,'reserved':3,'used':0},31)
    def fake_apply(self,base,fail=None):
        calls=[];review={'actors':{},'oldBootLinks':{},'normal':{'actual':'normal'},'online':{'origins':[{'id':'1'}]}}
        def call(name):
            calls.append(name)
            if fail==name:raise RuntimeError('fixture '+name)
        def child(action,**kw):
            call(action)
            if action=='commit':
                rows=[{'phase':'publication_complete','epoch':'owned'},{'phase':'adoption_committed','privateSeal':{'tables':{}}}]
                kw['path'].write_text(''.join(json.dumps({'format':'yunipals-arena-direct-native-owner-v1',**r})+'\n'for r in rows))
        h=types.SimpleNamespace(plan={'floor':{'block':'100','hash':'0x'+'a'*64}},verify_old=lambda r:call('verify-old'),install_units=lambda:call('install'),retire_boot=lambda r:call('boot-retire'),drain=lambda r:(call('drain')or{}),quiet=lambda:call('quiet'),backup=lambda:call('backup'),files_and_roles=lambda:call('roles'),normal=lambda:review['normal'],child=child,start_native=lambda epoch:(call('native-start')or{'native':True}),native_set=lambda:{'native':True},binding={'privateInputHashes':{}},o=None)
        h.m=types.SimpleNamespace(verify_inputs=lambda *a:call('private-config'))
        return h,review,calls
    def test_drain_failure_never_adopts_or_starts_native(self):
        with tempfile.TemporaryDirectory()as d,patch.object(m,'BASE',Path(d)/'operation'):
            h,r,calls=self.fake_apply(m.BASE,fail='drain')
            with self.assertRaisesRegex(RuntimeError,'drain'):m.apply(h,r,m.sha(m.encoded(r)))
            self.assertEqual(calls,['verify-old','install','boot-retire','drain']);self.assertFalse((m.BASE/'owner-commit.jsonl').exists())
    def test_lost_owner_child_ack_never_starts_native_or_unhalts(self):
        with tempfile.TemporaryDirectory()as d,patch.object(m,'BASE',Path(d)/'operation'):
            h,r,calls=self.fake_apply(m.BASE,fail='commit')
            with self.assertRaisesRegex(RuntimeError,'commit'):m.apply(h,r,m.sha(m.encoded(r)))
            self.assertNotIn('native-start',calls);self.assertNotIn('unhalt',calls);self.assertTrue((m.BASE/'adoption-owner-intent.json').exists())
    def test_native_start_begins_only_after_durable_selection_then_unhalt_last(self):
        with tempfile.TemporaryDirectory()as d,patch.object(m,'BASE',Path(d)/'operation'):
            h,r,calls=self.fake_apply(m.BASE);result=m.apply(h,r,m.sha(m.encoded(r)))
            self.assertTrue(result['completed']);self.assertLess(calls.index('commit'),calls.index('native-start'));self.assertEqual(calls[-1],'unhalt');self.assertEqual(result['migrationInvocations'],0)
    def test_guard_uses_actual_admission_prepared_graph_and_owned_scram_hashes(self):
        h=object.__new__(m.Host);h.proposal=proposal;h.auth=auth();h.urls={};calls=[]
        admission={'roles':h.auth['roles'],'sourceRole':h.auth['sourceRole']};setup={'roles':h.auth['roles'],'sourceRole':h.auth['sourceRole'],'operatorSha256':m.AUTH_OPERATOR_SHA,'credentialFiles':{},'passwordVerifierSha256':{n:'f'*64 for n in [*h.auth['roles'],'arena_native_reader']}}
        files={}
        for w in proposal['workers']:
            files[w['privateOverlay']]=('ARENA_DATABASE_URL=postgres://'+w['role']+':fixture@127.0.0.1:15438/yunipals_arena\n').encode()
        files['/etc/yunipals-arena/native-read.env']=('ARENA_INDEXER_MODE=unified\nARENA_INDEXER_SOURCE_KIND=unified\nARENA_INDEXER_RELEASE_ID='+m.SOURCE_ID+'\nARENA_INDEXER_DATABASE_URL=postgres://arena_native_reader:fixture@127.0.0.1:5432/yunipals_backfill\n').encode()
        h.auth['credentialFiles']={p:m.sha(raw)for p,raw in files.items()};setup['credentialFiles']=h.auth['credentialFiles']
        a=m.encoded(admission);s=m.encoded(setup);h.auth['admissionResultSha256']=m.sha(a);h.auth['setupResultSha256']=m.sha(s)
        def verified(receipt,**kw):calls.append((receipt,kw));return{'validated':True,'roleCount':9,'databaseWrites':0}
        h.p=types.SimpleNamespace(protected=lambda p,*a:a_raw if p==m.ADMISSION_RESULT else s,load=lambda p,pin,name:types.SimpleNamespace(verify_current=verified));a_raw=a
        h.o=types.SimpleNamespace(read=lambda p,*a,**k:(files[str(p)],[1,1,0,0,0o100600]),parse_env=lambda raw:dict(line.split('=',1)for line in raw.decode().splitlines()))
        def catalog(names):
            return {'readOnly':True,'isolation':'repeatable read','roles':[{'name':n,'exists':True,'oid':h.auth['roles'].get(n,200),'attributes':{'login':True,'inherit':False,**{k:False for k in ['superuser','createDb','createRole','replication','bypassRls']}},'membershipEdges':0,'ownedRelationCount':0,'ownedFunctionCount':0,'sequencePrivilegeCount':0,'securityDefinerExecuteCount':0,'databaseConnect':True,'databaseCreate':False,'databaseTemp':n=='arena_native_reader','extraTablePrivilegeCount':0,'extraColumnPrivilegeCount':0,'requiredGrants':[{'effective':True,'relation_oid':1}],'schemaPrivileges':{'fixture':{'usage':True,'create':False,'owns':False}},'functionExecuteCount':2 if n=='arena_native_reader'else 0}for n in names]}
        h.inv=types.SimpleNamespace(catalog_sql=lambda names,*a:names,connect=lambda o,p,d,names:catalog(names),stable_catalog=lambda d:d)
        h.files_and_roles();self.assertEqual(len(calls),1);self.assertEqual(calls[0],(admission,{'phase':'login','password_sha256':setup['passwordVerifierSha256']}))
        h.p.load=lambda *a:types.SimpleNamespace(verify_current=lambda *a,**k:(_ for _ in()).throw(RuntimeError('prepared ACL drift')))
        with self.assertRaisesRegex(RuntimeError,'prepared ACL drift'):h.files_and_roles()

if __name__=='__main__':unittest.main(verbosity=2)
