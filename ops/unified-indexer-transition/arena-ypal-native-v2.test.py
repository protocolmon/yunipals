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
spec=importlib.util.spec_from_file_location('direct_owner',HERE/'arena-ypal-native-v2.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
proposal=json.loads((HERE/'arena-ypal-native-v1.proposal.json').read_bytes())

manifest={'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in HERE.glob('arena-ypal-native-v*')if p.is_file()}}
proposal['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions']=[{'oid':9000001,'securityDefiner':False},{'oid':9000002,'securityDefiner':False}]

def auth():
    return {'format':'yunipals-arena-ypal-role-auth-v2','roles':{w['role']:100+i for i,w in enumerate(proposal['workers'])},'sourceRole':{'name':'arena_native_reader','oid':200},'credentialFiles':{p:'a'*64 for p in [*[w['privateOverlay']for w in proposal['workers']],'/etc/yunipals-arena/native-read.env']},'operationalDatabaseOid':2303669,'sourceDatabaseOid':17584,'originalActorsReceiptSha256':'b'*64,'grantsVerified':True,'tcpAuthenticationProven':True,'loginEnabled':True,'operatorSha256':manifest['files'][m.AUTH_OPERATOR.name],'admissionResultSha256':'c'*64,'admissionHelperSha256':manifest['files'][m.ADMISSION_HELPER.name],'setupResultSha256':'d'*64,'releaseId':m.SOURCE_ID,'acknowledgedCurrentActors':{'sha256':m.ACTOR_ACK_SHA}}

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
        p={'format':m.FORMAT,'roleAuth':{'file':str(m.AUTH_BASE/'auth-result.json'),'sha256':'a'*64},'currentActorsAck':{'file':str(m.ACTOR_ACK_FILE),'sha256':m.ACTOR_ACK_SHA},'manifestSha256':'e'*64,'admissionProposal':{'file':str(m.PROPOSAL_FILE),'sha256':manifest['files'][m.PROPOSAL_FILE.name]},'floor':{'block':'52900000','hash':'0x'+'c'*64}}
        m.validate_plan(p)
        for update in [{'floor':{'block':'0','hash':'0x'+'c'*64}},{'floor':{'block':'52900000','hash':'unknown'}},{'roleAuth':{'file':'relative.json','sha256':'a'*64}},{'roleAuth':{'file':'/root/x','sha256':'0'*64}},{'extra':'unknown'}]:
            with self.assertRaises(m.CutoverFailure):m.validate_plan({**p,**update})
    def test_auth_requires_same_nine_roles_files_producers_and_target(self):
        a=auth();m.validate_auth_receipt(a,proposal,m.ACTOR_ACK_SHA,manifest)
        cases=[]
        for key,value in [('loginEnabled',False),('operatorSha256','a'*64),('admissionHelperSha256','a'*64),('operationalDatabaseOid',9),('acknowledgedCurrentActors',{'sha256':'e'*64})]:cases.append({**a,key:value})
        cases.extend([{**a,'roles':dict(list(a['roles'].items())[:-1])},{**a,'credentialFiles':{**a['credentialFiles'],'/tmp/foreign.env':'a'*64}},{**a,'roles':{r:101 for r in a['roles']}}])
        for v in cases:
            with self.assertRaises(m.CutoverFailure):m.validate_auth_receipt(v,proposal,m.ACTOR_ACK_SHA,manifest)
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
        raw=(HERE/'arena-ypal-native-v1.mjs').read_bytes();fd=m.sealed('arena-direct-native-child',raw)
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
                kw['path'].write_text(''.join(json.dumps({'format':'yunipals-arena-ypal-native-child-v1',**r})+'\n'for r in rows))
        h=types.SimpleNamespace(child_sha=manifest['files']['arena-ypal-native-v1.mjs'],plan={'manifestSha256':'e'*64,'floor':{'block':'100','hash':'0x'+'a'*64}},verify_old=lambda r:call('verify-old'),install_units=lambda:call('install'),retire_boot=lambda r:call('boot-retire'),drain=lambda r:(call('drain')or{}),quiet=lambda:call('quiet'),backup=lambda:call('backup'),files_and_roles=lambda:call('roles'),normal=lambda:review['normal'],child=child,start_native=lambda epoch:(call('native-start')or{'native':True}),native_set=lambda:{'native':True},binding={'privateInputHashes':{}},o=None)
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
        h=object.__new__(m.Host);h.proposal=proposal;h.manifest=manifest;h.auth=auth();h.urls={};calls=[]
        admission={'roles':h.auth['roles'],'sourceRole':h.auth['sourceRole']};setup={'roles':h.auth['roles'],'sourceRole':h.auth['sourceRole'],'operatorSha256':manifest['files'][m.AUTH_OPERATOR.name],'credentialFiles':{},'passwordVerifierSha256':{n:'f'*64 for n in [*h.auth['roles'],'arena_native_reader']}}
        files={}
        for w in proposal['workers']:
            files[w['privateOverlay']]=('ARENA_DATABASE_URL=postgres://'+w['role']+':fixture@127.0.0.1:15438/yunipals_arena\n').encode()
        files['/etc/yunipals-arena/native-read.env']=('ARENA_INDEXER_MODE=unified\nARENA_INDEXER_SOURCE_KIND=unified\nARENA_INDEXER_RELEASE_ID='+m.SOURCE_ID+'\nARENA_INDEXER_DATABASE_URL=postgres://arena_native_reader:fixture@127.0.0.1:5432/yunipals_backfill\n').encode()
        h.auth['credentialFiles']={p:m.sha(raw)for p,raw in files.items()};setup['credentialFiles']=h.auth['credentialFiles']
        a=m.encoded(admission);s=m.encoded(setup);h.auth['admissionResultSha256']=m.sha(a);h.auth['setupResultSha256']=m.sha(s)
        def verified(receipt,**kw):calls.append((receipt,kw));return{'validated':True,'roleCount':9,'databaseWrites':0}
        h.p=types.SimpleNamespace(protected=lambda p,*a:a_raw if p==m.ADMISSION_RESULT else s,load=lambda p,pin,name:types.SimpleNamespace(verify_current=verified,runner=lambda:None,current_catalog=lambda *_:{}));a_raw=a
        h.o=types.SimpleNamespace(read=lambda p,*a,**k:(files[str(p)],[1,1,0,0,0o100600]),parse_env=lambda raw:dict(line.split('=',1)for line in raw.decode().splitlines()))
        def catalog(names):
            return {'readOnly':True,'isolation':'repeatable read','roles':[{'name':n,'exists':True,'oid':h.auth['roles'].get(n,200),'attributes':{'login':True,'inherit':False,**{k:False for k in ['superuser','createDb','createRole','replication','bypassRls']}},'membershipEdges':0,'ownedRelationCount':0,'ownedFunctionCount':0,'sequencePrivilegeCount':0,'securityDefinerExecuteCount':0,'databaseConnect':True,'databaseCreate':False,'databaseTemp':n=='arena_native_reader','extraTablePrivilegeCount':0,'extraColumnPrivilegeCount':0,'requiredGrants':[{'effective':True,'relation_oid':1}],'schemaPrivileges':{'fixture':{'usage':True,'create':False,'owns':False}},'functionExecuteCount':2 if n=='arena_native_reader'else 0}for n in names]}
        h.inv=types.SimpleNamespace(catalog_sql=lambda names,*a:names,connect=lambda o,p,d,names:catalog(names),stable_catalog=lambda d:d)
        h.files_and_roles();self.assertEqual(len(calls),1);self.assertEqual(calls[0],(admission,{'phase':'login','password_sha256':setup['passwordVerifierSha256']}))
        h.p.load=lambda *a:types.SimpleNamespace(verify_current=lambda *a,**k:(_ for _ in()).throw(RuntimeError('prepared ACL drift')))
        with self.assertRaisesRegex(RuntimeError,'prepared ACL drift'):h.files_and_roles()


class YpalSourceControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        p=HERE/'arena-ypal-native-v1.source.py';cls.source=types.ModuleType('ypal_source_leaf');cls.source.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),cls.source.__dict__)
        cls.actual=json.loads((HERE.parent.parent/'docs/unified-indexer/ypal-combined-source-production-start-2026-10-23.json').read_bytes())
    def test_new_proposal_uses_exact_observed_nine_OIDs_and_four_control_reads(self):
        self.assertEqual(sum(len(w['requiredEdges'])for w in proposal['workers']),227)
        tables=proposal['sourceReader']['tables'];self.assertEqual(len(tables),13)
        native={r['name'].split('.')[1]:str(r['oid'])for r in tables if r['name'].startswith(self.source.SCHEMA+'.')}
        self.assertEqual(native,self.source.TABLES)
        for name,oid in native.items():self.assertEqual(self.actual['native']['tables'][name]['oid'],oid)
        self.assertNotIn('arena_seat',native)
        self.assertEqual(proposal['sourceContext']['applicationBufferBlocks'],0)
    def test_native_identity_uses_actual_acknowledged_catalog_and_refuses_old_namespace(self):
        ack=copy.deepcopy(self.actual);host=types.SimpleNamespace(native=lambda:copy.deepcopy(ack['native']))
        self.assertEqual(self.source.native_identity(host,ack)['schemaOid'],'75963410')
        for key,value in [('schemaOid','73004622'),('app',{**ack['native']['app'],'build_id':'bf4939b3ff'})]:
            changed=copy.deepcopy(ack['native']);changed[key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):self.source.native_identity(types.SimpleNamespace(native=lambda:changed),ack)
        changed=copy.deepcopy(ack['native']);changed['tables']['arena_tournament']['oid']='73032734'
        with self.assertRaises(RuntimeError):self.source.native_identity(types.SimpleNamespace(native=lambda:changed),ack)
    def current_rpc_source_fixture(self):
        p=HERE/'arena-ypal-native-v2.source.py';current=types.ModuleType('actual_current_RPC_source');current.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),current.__dict__)
        ack=copy.deepcopy(self.actual);calls=[]
        op={'sourceCode':{'same':'code'},'sourceRole':{'same':'role'}}
        s=types.SimpleNamespace(NEW='synthetic-source',NEW_LINK=Path('/synthetic-owned-boot'),
            static_inputs=lambda h:calls.append('static'),old_private_inputs=lambda op:calls.append('private'),
            base_code=lambda:op['sourceCode'],exact_link=lambda *a:calls.append('boot'),new_owned=lambda *a:copy.deepcopy(ack['source']))
        h=types.SimpleNamespace(role=lambda:op['sourceRole'],old_terminal=lambda op:calls.append('old-terminal'),
            preserved_old_native=lambda op:calls.append('old-native'),native=lambda:copy.deepcopy(ack['native']),state=lambda name:{'MainPID':'2472127'},
            m=types.SimpleNamespace(route_owner=types.SimpleNamespace(EXPIRY='2026-11-19T00:00:00Z'),load=lambda name:{'binding':{'budgetCapacityIdentity':{'same':'capacity'}}}),
            rpc=types.SimpleNamespace(capacity_snapshot=lambda m:{'same':'capacity'}))
        forbidden=lambda *a:(_ for _ in()).throw(AssertionError('obsolete whole/source/API predicate invoked'))
        leaf=types.SimpleNamespace(load=lambda:(s,h,op,ack),source_actor=self.source.source_actor,native_identity=self.source.native_identity,
            RELEASE=self.source.RELEASE,MANIFEST=self.source.MANIFEST,SCHEMA=self.source.SCHEMA,SOURCE_ACK=self.source.SOURCE_ACK,SOURCE_OP=self.source.SOURCE_OP,boot=lambda:'same-synthetic-boot',
            static_and_financial=forbidden,retained_proxy_frame=forbidden)
        proof={'format':'yunipals-ypal-retained-proxy-current-v3','validated':True,'receiptSha256':current.QUALIFICATION_RECEIPT_SHA,
            'operatorSha256':current.QUALIFIER_SHA,'currentRPCComponentSha256':current.QUALIFICATION_COMPONENT_SHA,
            'rpcScopeOnly':True,'freeOnly':True,'paidAuthority':False,'historicalWholeValidatorPassed':False,
            'sourceActorQualified':False,'temporaryYpalSourceAndApiQualified':False,'sourceReadinessQualified':False,
            'providerCalls':0,'databaseWrites':0,'serviceActions':0}
        q=types.SimpleNamespace(BASE=Path('/var/backups/yunipals-ypal-retained-proxy-current-v3-20261024'),
            qualified_rpc_components=lambda pin:(copy.deepcopy(proof),{}),validate_source_current=forbidden)
        return current,leaf,q,proof,calls
    def test_actual_v3_RPC_only_ACK_composes_same_c96_source_without_old_whole_validator(self):
        current,leaf,q,proof,calls=self.current_rpc_source_fixture()
        with patch.object(current,'load',return_value=(leaf,q)):value=current.validate_current()
        self.assertEqual(value['currentRPCQualification']['sha256'],'152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b')
        self.assertEqual(value['currentRPCQualification']['componentSha256'],current.QUALIFICATION_COMPONENT_SHA)
        self.assertFalse(value['originalWholeValidationPassed']);self.assertFalse(value['nativeReadinessQualified']);self.assertFalse(value['sourceTerminal'])
        self.assertEqual(calls,['static','private','old-terminal','old-native','boot'])
    def test_wrong_v3_component_or_source_scope_refuses_before_source_predicates(self):
        current,leaf,q,proof,calls=self.current_rpc_source_fixture()
        for key,value in [('currentRPCComponentSha256','f'*64),('paidAuthority',True),('temporaryYpalSourceAndApiQualified',True)]:
            bad=copy.deepcopy(proof);bad[key]=value;q.qualified_rpc_components=lambda pin,v=bad:(v,{})
            with patch.object(current,'load',return_value=(leaf,q)),self.assertRaisesRegex(RuntimeError,'independent_current_RPC'):current.validate_current()
            self.assertEqual(calls,[])
    def test_terminal_source_is_inverse_only_and_requires_empty_owned_cgroup(self):
        source=self.source
        with tempfile.TemporaryDirectory()as d:
            (Path(d)/'fixture.service').mkdir();group=Path(d)/'fixture.service/cgroup.procs';group.write_text('');real=Path
            def path(*parts):
                value=real(*parts)
                return real(d) if str(value)=='/sys/fs/cgroup/system.slice'else value
            ack={'source':{'processes':[{'pid':99999991}]}}
            state={'MainPID':'0','ControlPID':'0','ActiveState':'failed','Job':'','FragmentPath':'/owned/source.service','DropInPaths':''}
            old=types.SimpleNamespace(NEW='fixture.service',UNIT=real('/owned/source.service'),TEMPLATE_SHA='a'*64,new_owned=lambda *_:(_ for _ in()).throw(RuntimeError('forward requires live source')))
            host=types.SimpleNamespace(state=lambda _:state,files=lambda _:{str(old.UNIT):old.TEMPLATE_SHA})
            with patch.object(source,'Path',path):
                value=source.source_actor(old,host,{},ack,True);self.assertTrue(value['inverseOnly']);self.assertTrue(value['sourceTerminal'])
                with self.assertRaisesRegex(RuntimeError,'forward requires'):source.source_actor(old,host,{},ack,False)
                group.write_text('123\n')
                with self.assertRaisesRegex(RuntimeError,'cgroup'):source.source_actor(old,host,{},ack,True)
    def test_owner_never_reports_terminal_or_old_source_as_forward_ready(self):
        host=object.__new__(m.Host);host.manifest={'files':{m.SOURCE_CONTEXT.name:'a'*64},'source':m.SOURCE_CONTEXT_VALUE}
        current={'releaseId':m.SOURCE_ID,'manifestHash':m.SOURCE_CONTEXT_VALUE['manifestHash'],'schemaOid':'75963410','buildId':'71e2a7f3b7','originalWholeValidationPassed':False,'paidAuthority':False,'sourceTerminal':True}
        calls=[];leaf=types.SimpleNamespace(QUALIFIER_SHA='e'*64,QUALIFICATION_RECEIPT_SHA='f'*64,validate_current=lambda **kw:(calls.append(kw)or current))
        host.p=types.SimpleNamespace(load=lambda *a:leaf)
        with self.assertRaisesRegex(m.CutoverFailure,'terminal_source'):host.normal()
        self.assertEqual(host.normal(terminal_ok=True),current);self.assertEqual(calls[-1],{'terminal_ok':True})
        current['schemaOid']='73004622'
        with self.assertRaises(m.CutoverFailure):host.normal(terminal_ok=True)
    def test_source_independent_leaf_does_not_call_source_or_provider_and_authenticates_exact_file(self):
        import ast
        tree=ast.parse((HERE/'arena-ypal-native-v2.py').read_text());node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='validate_phase_leaf')
        calls=[n.func.attr for n in ast.walk(node)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)]
        self.assertNotIn('normal',calls);self.assertNotIn('getBlock',calls)
        self.assertIn('files_and_roles',calls);self.assertIn('native_set',calls);self.assertIn('adopted_state',calls)
    def test_pure_adapter_retains_reviewed_private_SQL_and_drops_the_obsolete_CLI(self):
        old=(HERE/'arena-legacy-origin-adopt-v2.mjs').read_text();new=(HERE/'arena-ypal-native-v1.adoption.mjs').read_text()
        retained=old[old.index('export function originBinding('):old.index('async function runtime()')]
        self.assertIn(retained,new);self.assertNotIn('async function runtime()',new);self.assertNotIn('35cdcb',new)
        self.assertEqual(m.ADAPTER_SHA,m.sha((HERE/'arena-ypal-native-v1.adoption.mjs').read_bytes()))

class SourceTerminalInverse(unittest.TestCase):
    def test_aborted_owned_cutover_can_restore_legacy_while_source_terminal_without_SQL_writes(self):
        with tempfile.TemporaryDirectory()as d,patch.object(m,'BASE',Path(d)):
            calls=[];started=[False];timepoint=[0.0]
            source={'sourceTerminal':True,'inverseOnly':True,'freeOnly':True,'paidAuthority':False}
            h=object.__new__(m.Host);h.native={};h.base={'services':[{'unit':'legacy.service'}]};h.binding={'privateInputHashes':{'original':'hash'}};h.o=object()
            review={'actors':{'legacy.service':{'invocation':'retained','process':{'pid':1}}},'oldBootLinks':{}}
            h.recovery_binding=lambda:review;h.files_and_roles=lambda:calls.append('roles');h.artifacts=lambda **kw:None
            def normal(**kw):self.assertEqual(kw,{'terminal_ok':True});calls.append('terminal-source-proof');return source
            h.normal=normal;h.quiet=lambda:None;h.native_quiet=lambda:None
            s=state();h.child=lambda action,**kw:[{'phase':'reconciled_state','state':s}]
            def props(*args):return{'MainPID':'42'if started[0]else'0','InvocationID':'restored'if started[0]else'retained','ActiveState':'active'if started[0]else'inactive','SubState':'running'if started[0]else'dead'}
            h.r=types.SimpleNamespace(graph=lambda *a,**kw:None,props=props,cgroup=lambda _:None,database=lambda _:calls.append('readonly-database-check'))
            def manager(argv,**kw):
                calls.append(tuple(argv));self.assertIn(argv[1],['daemon-reload','start'])
                if argv[1]=='start':started[0]=True
            h.m=types.SimpleNamespace(run=manager,verify_inputs=lambda *a:calls.append('private-inputs'),process_identity=lambda *a:{'pid':42})
            inv=h.inverse_review();self.assertTrue(inv['source']['sourceTerminal'])
            def clock():timepoint[0]+=2;return timepoint[0]
            with patch.object(m.time,'monotonic',clock),patch.object(m.time,'sleep',lambda _:None):result=h.inverse(inv,m.sha(m.encoded(inv)))
            self.assertTrue(result['preAdoptionRestored']);self.assertEqual(result['migrationInvocations'],0);self.assertEqual(result['sourceSelectionWrites'],0)
            self.assertEqual(calls.count('terminal-source-proof'),3)
            self.assertTrue((m.BASE/'inverse-result.json').is_file())


class ActualAmbientBinding(unittest.TestCase):
    def setUp(self):
        p=HERE/'arena-ypal-native-v1.rehearsal.py';self.h=types.ModuleType('ypal_rehearsal');self.h.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),self.h.__dict__)
        p=HERE/'arena-ypal-native-v1.catalog.py';self.helper=types.ModuleType('ypal_catalog');self.helper.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),self.helper.__dict__)
        raw=(HERE/'arena-ypal-native-v1.proposal.json').read_bytes();summary=json.loads((HERE/'arena-ypal-native-v1.catalog.summary.json').read_bytes())
        self.before={'readOnly':True,'isolation':'repeatable read','database':{'acl':[{'granteeOid':0,'privilege':'CONNECT'}],'ownerOid':16388},'schemas':[{'oid':75963410,'ownerOid':73004621,'acl':[{'granteeOid':0,'privilege':'USAGE'}]}],'functions':summary['functions'],'defaultAcl':[],'sourceRole':[],'relationIdentities':summary['relations']}
        self.current=copy.deepcopy(self.before);self.queries=[]
        saved={'format':self.helper.FORMAT,'operatorSha256':self.h.CATALOG_HELPER_SHA,'sqlSha256':self.h.sha(self.helper.sql().encode()),'catalog':self.before}
        def read(path,pin=None,*args):
            if path==self.h.CATALOG_FILE:
                self.assertEqual(pin,'938a9821e266b79c5963f0f66ffc52a9a301bc908d8a870744feeed9272a4083');return json.dumps(saved).encode()
            self.assertEqual(path,self.h.OPS/'arena-ypal-native-v1.proposal.json');return raw
        def run(argv,data,**kwargs):
            self.assertEqual(data,self.helper.sql().encode());self.queries.append(data);return json.dumps(self.current).encode()
        for name,value in [('read',read),('run',run),('peer_args',lambda *a:['fixed-readonly-peer']),('module',lambda path,pin:self.helper)]:
            p=patch.object(self.h,name,value);p.start();self.addCleanup(p.stop)
    def test_current_public_function_body_defaultACL_and_PUBLIC_authority_are_bound(self):
        # Full fresh captured metadata is compared; saved capture time is not
        # relabelled as a new readiness or canonical observation.
        # The fixture public descriptors are converted to the raw ACL shape.
        for f in self.before['functions']:f['acl']=[{'granteeOid':0,'privilege':'EXECUTE'}]
        self.current=copy.deepcopy(self.before)
        result=self.h.source_ambient();self.assertEqual(result['publicNonDefinerFunctions'],[{'oid':75963762,'securityDefiner':False},{'oid':75963763,'securityDefiner':False}]);self.assertEqual(len(self.queries),1)
        changes=[lambda x:x['functions'][0].update(bodySha256='f'*64),lambda x:x['defaultAcl'].append({'foreign':'new'}),lambda x:x['schemas'][0]['acl'].append({'granteeOid':0,'privilege':'CREATE'})]
        for change in changes:
            self.current=copy.deepcopy(self.before);change(self.current)
            with self.assertRaisesRegex(RuntimeError,'ambient_function_defaultACL_or_identity'):self.h.source_ambient()
    def test_unrelated_reader_schema_grant_does_not_impersonate_inherited_Arena_authority(self):
        for f in self.before['functions']:f['acl']=[{'granteeOid':0,'privilege':'EXECUTE'}]
        self.current=copy.deepcopy(self.before);self.current['schemas'][0]['acl'].append({'granteeOid':73187672,'privilege':'USAGE'})
        baseline=self.h.source_ambient();self.current['schemas'][0]['acl'].pop();self.assertEqual(self.h.source_ambient()['sourceAmbientSha256'],baseline['sourceAmbientSha256'])


class CurrentActorOwnerSeams(unittest.TestCase):
    def test_native_owner_qualifies_new_ack_tuple_without_rewriting_historical_restore(self):
        prior=copy.deepcopy(proposal['current']['actors']);unit=next(iter(prior));current=copy.deepcopy(prior[unit]);current['invocation']='a'*32;current['process']['pid']+=100000;current['process']['startTicks']+=1000000
        h=object.__new__(m.Host);h.actor_receipt={'binding':{'snapshot':{'actors':{unit:current}}}};h.restored={'originalActors':prior}
        props={'ActiveState':'active','SubState':'running','InvocationID':current['invocation']}
        h.r=types.SimpleNamespace(props=lambda *a:dict(props));h.m=types.SimpleNamespace(process_identity=lambda *a:copy.deepcopy(current['process']))
        self.assertEqual(h.current_actor({'unit':unit}),current);self.assertEqual(h.restored['originalActors'],prior)
        props['InvocationID']='b'*32
        with self.assertRaisesRegex(m.CutoverFailure,'acknowledged_current_actor'):h.current_actor({'unit':unit})
    def test_constructor_and_phase_leaf_do_not_unconditionally_recheck_live_old_ack(self):
        import ast
        tree=ast.parse((HERE/'arena-ypal-native-v2.py').read_text());host=next(n for n in tree.body if isinstance(n,ast.ClassDef)and n.name=='Host');constructor=next(n for n in host.body if isinstance(n,ast.FunctionDef)and n.name=='__init__');leaf=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='validate_phase_leaf')
        for node in [constructor,leaf]:
            calls=[n.func.attr for n in ast.walk(node)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)]
            self.assertNotIn('current_actors',calls);self.assertNotIn('current_actor',calls)
        self.assertEqual(m.ACTOR_ACK_SHA,'d3f1b61c244979dbf8b94281ba0d062e35fbca5ee52a1c92d9b9d97bd52781d4')
    def test_unqualified_19212_dependency_refuses_before_any_input_or_host_read(self):
        p=HERE/'arena-ypal-native-v2.source.py';source=types.ModuleType('pending_current_RPC_source');source.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),source.__dict__)
        if source.QUALIFIER_SHA is None or source.QUALIFICATION_RECEIPT_SHA is None:
            with self.assertRaisesRegex(RuntimeError,'actual_frozen_19212'):source.load()
        else:self.assertTrue(source.pin(source.QUALIFIER_SHA)and source.pin(source.QUALIFICATION_RECEIPT_SHA))

if __name__=='__main__':unittest.main(verbosity=2)
