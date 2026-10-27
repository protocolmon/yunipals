"""Actual lifecycle compilation and real private-file fixtures; no services/DB."""
import ast
import copy
import contextlib
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('ypal-ordinary-cache-finish-retained-stop-v1.py')
graph=load('ypal-ordinary-publication-continue-v5.test.py')
old=load('ypal-cache-guard-owner-v1.py')
P=lambda name:hashlib.sha256(('explicit-cache-owner-fixture:'+name).encode()).hexdigest()

class Controls(unittest.TestCase):
    def setUp(self):
        self.control=graph.Controls();self.control.setUp();self.addCleanup(self.control.doCleanups)
        self.temp=tempfile.TemporaryDirectory(prefix='ypal-retained-cache-stop-');self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.prior=self.base/'prior';self.cache_base=self.base/'cache';self.owner_base=self.base/'owner'
        self.prior.mkdir(mode=0o700);self.cache_base.mkdir(mode=0o700)
        self.input=self.base/'input.json';self.live=self.base/'boot-live';self.archive=self.prior/'original-boot-link'
        self.archive.symlink_to('/etc/systemd/system/yunipals-read-cache.service');self.boot=old.inode(self.archive,True)
        for key,value in [('PRIOR_BASE',self.prior),('CACHE_BASE',self.cache_base),('BASE',self.owner_base),('INPUT',self.input)]:
            self.enterContext(patch.object(m,key,value))
        stage=json.loads((HERE/'ypal-ordinary-publication-continue-v5.stage.json').read_bytes());self.origins=stage['repositoryOrigins']
        self.original_public=m.public
        def public(path,digest=None,maximum=16000000):
            path=Path(path)
            if path==m.READER_BASE/'operation.json':raw=self.reader_operation_raw
            elif path.is_relative_to(self.base):
                before=path.lstat();raw=path.read_bytes();after=path.lstat()
                m.need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and
                    all(getattr(before,k)==getattr(after,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and 0<len(raw)<=maximum,
                    'same_explicit_private_fixture_bytes_required')
            else:
                candidate=HERE/path.name
                if not candidate.exists():candidate=HERE.parents[1]/self.origins[path.name]
                raw=candidate.read_bytes()
            m.need(digest is None or m.sha(raw)==digest,'exact_fixture_protected_hash_required');return raw
        self.public=public;self.enterContext(patch.object(m,'public',side_effect=public))
        self.config=copy.deepcopy(self.control.config);self.actor={'main':{'pid':123,'startTicks':456},'unit':{'InvocationID':'actualStopIOFixture'}}
        self.stop={'actor':self.actor,'sessions':{'owned':[{'pid':321,'backendStart':'explicitOldEpochFixture'}]},'actualOriginalStopFixture':True}
        self.names=['before.json','rehearsed.json','authorization.json','boot-disable-intent.json','boot-disabled.json',
            'disable-reload-intent.json','disable-reload-result.json','stop-intent.json','stopped.json','sql-intent.json','apply-sql-child.json','apply-sql-opened.json']
        for name in self.names:
            value=self.stop if name=='stopped.json'else {'binding':{'config':self.config}}if name=='before.json'else{'explicitRetainedRecordFixture':name}
            self.put(self.prior/name,value)
        self.prior_binding={'priorProducerSha256':m.PRIOR_SHA,'priorBase':str(self.prior),'transactionId':'16540148','transactionStatus':'aborted',
            'priorChildGone':True,'priorBackendGone':True,'records':m.record_frames([self.prior/name for name in self.names]),
            'boot':self.boot,'originalActor':self.actor,'retainedBootArchiveFile':str(self.archive)}
        self.before={'binding':{'operatorSha256':m.PROVIDER_SHA,'config':self.config,'newStopActionPerformed':False,
            'retainedActualStop':self.prior_binding,'boot':self.boot,'originalActor':self.actor}}
        self.before['reviewHash']=m.sha(m.encoded(self.before['binding']))
        self.before_sha=self.put(self.cache_base/'before.json',self.before)
        self.rehearsed={'retainedActualPriorAbortedSha256':m.sha(m.encoded(self.prior_binding))}
        self.retained={'format':m.AUTHORITY_FORMAT+'-retained-stop','actualPriorStopped':self.stop,'priorStoppedFile':str(self.prior/'stopped.json'),
            'priorStoppedSha256':m.sha(public(self.prior/'stopped.json')),'retainedBootArchiveFile':str(self.archive),'newStopActionPerformed':False}
        self.cache=types.SimpleNamespace(FORMAT='yunipals-ypal-ordinary-read-cache-continue-v5',BASE=self.cache_base,
            __file__=str(m.OPS/m.PROVIDER),continuation_authority=types.SimpleNamespace(FORMAT=m.AUTHORITY_FORMAT,NEW_BASE=self.cache_base),
            BOOT=self.live,inode=old.inode,retained_boot_archive=self.archive,
            document=lambda path:json.loads(public(path)),owned=Mock(return_value=(self.before,self.rehearsed)),
            stopped=Mock(return_value=(self.before,self.rehearsed,self.retained)))
        self.prepared={'format':self.cache.FORMAT,'prepared':True,'operatorSha256':m.PROVIDER_SHA,'config':self.config,'beforeSha256':self.before_sha}
        self.prepared_sha=self.put(self.cache_base/'prepared.json',self.prepared)
        self.context=types.SimpleNamespace(cache=self.cache,host=types.SimpleNamespace(config=self.config),prepared=self.prepared)
        self.refs={'resultSha256':P('actualReaderResult'),'producerSha256':m.READER_SHA,'manifestSha256':m.READER_MANIFEST_SHA}
        self.owner_config={'format':m.FORMAT+'-input','readerRefs':self.refs,'cachePreparedSha256':self.prepared_sha}
        self.input_sha=self.put(self.input,self.owner_config)
        self.reader_operation_raw=m.encoded({'explicitImmutableReaderOperationFixture':True})
        self.ack={'receiptSha256':self.refs['resultSha256'],'operationSha256':m.sha(self.reader_operation_raw)}

    def put(self,path,value):
        raw=m.encoded(value);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True);path.write_bytes(raw);path.chmod(0o600);return m.sha(raw)

    def runtime(self):
        reader=graph.actual[m.READER];proof=reader.Proof(self.control.manifest_sha)
        root=reader.assemble(self.control.public(reader.TEMPLATE,reader.TEMPLATE_SHA),proof);root.public_input=self.public
        with patch.object(m,'reader_ancestry',return_value=(self.ack,{'explicitImmutableReaderOperationFixture':True})):
            value=m.runtime(root,proof,self.input_sha)
        return root,proof,value

    def test_actual_literal_manifest_all_sources_and_default_inert(self):
        # The production identities are restored for this pure source check.
        m.authenticate();manifest=json.loads((HERE/m.SOURCE_MANIFEST.name).read_bytes())
        self.assertEqual(len(manifest['files']),324)
        self.assertFalse({'ypal-ordinary-consumer-prefix-source-v3.py','ypal-ordinary-consumer-inverse-prefix-v3.py'}&set(m.SOURCE_PINS))
        parser=types.SimpleNamespace(add_argument=Mock(),add_mutually_exclusive_group=lambda:types.SimpleNamespace(add_argument=Mock()),
            parse_args=lambda:types.SimpleNamespace(input_sha=None,review=False,start=None,accept_review=False,accept=None,reconcile_start=False,
                reload_review=False,reload_config=None,reconcile_reload=None,reload_phase=None))
        with (patch.object(m.argparse,'ArgumentParser',return_value=parser),
            patch.object(m,'session_context',side_effect=AssertionError('default Host construction')),
            patch('builtins.print')as output):m.main()
        self.assertTrue(json.loads(output.call_args.args[0])['staticOnly'])

    def test_real_returned_stop_and_parked_original_inode_are_bound_without_new_ACK(self):
        value=m.retained_stop(self.context,self.cache.stopped(self.context.host))
        self.assertEqual(value['priorStoppedSha256'],self.retained['priorStoppedSha256']);self.assertEqual(value['priorBinding'],self.prior_binding)
        self.assertEqual(value['originalBoot'],old.inode(self.archive,True));self.assertFalse(value['newStopActionPerformed'])
        self.assertFalse((self.cache_base/'stopped.json').exists());self.assertFalse(self.owner_base.exists())

    def test_actual_authority5_stopped_body_returns_the_exact_retained_tuple(self):
        authority=graph.actual[m.AUTHORITY].composition();actual=authority.stopped
        authorization={'format':self.cache.FORMAT,'reviewHash':self.before['reviewHash'],
            'additionalReadDeltaSha256':P('actualFourDeltaIOFixture'),'additionalReadCount':4,
            'retainedActualAuthorization':{'file':str(self.prior/'authorization.json'),'sha256':m.sha(self.public(self.prior/'authorization.json'))},
            'additionalAuthorityRequested':False}
        self.put(self.cache_base/'authorization.json',authorization)
        self.rehearsed.update(newActualRollbackRehearsal=True,additionalReadDeltaSha256=authorization['additionalReadDeltaSha256'])
        scope={**actual.__globals__,'NEW_BASE':self.cache_base,'PRIOR_BASE':self.prior,'public':self.public,'document':m.document,
            'new_identity':lambda *_:{'providerSha256':m.PROVIDER_SHA},
            'prior_aborted':lambda *_:{'binding':self.prior_binding,'bindingSha256':m.sha(m.encoded(self.prior_binding)),
                'actualPriorStopped':self.stop,'retainedBootArchiveFile':str(self.archive)}}
        stopped=types.FunctionType(actual.__code__,scope,actual.__name__,actual.__defaults__,actual.__closure__)
        self.cache.prior_cache=types.SimpleNamespace(explicitOriginalCacheIOFixture=True)
        value=stopped(self.cache,self.context.host)
        self.assertEqual(value,(self.before,self.rehearsed,self.retained))
        self.assertEqual(m.retained_stop(self.context,value)['priorStoppedSha256'],self.retained['priorStoppedSha256'])
        self.assertFalse((self.cache_base/'stopped.json').exists())

    def test_wrong_path_config_producer_before_or_boot_refuses(self):
        for change in[{'priorStoppedFile':str(self.cache_base/'stopped.json')},{'priorStoppedSha256':'0'*64},
            {'retainedBootArchiveFile':str(self.base/'foreign-archive')},{'newStopActionPerformed':True}]:
            actual=(self.before,self.rehearsed,{**self.retained,**change})
            with self.assertRaises((RuntimeError,FileNotFoundError)):m.retained_stop(self.context,actual)
        self.context.host.config={**self.config,'generationSha256':P('foreign')}
        with self.assertRaises(RuntimeError):m.retained_stop(self.context,(self.before,self.rehearsed,self.retained))
        self.context.host.config=self.config;self.cache.continuation_authority.FORMAT='foreign'
        with self.assertRaises(RuntimeError):m.retained_stop(self.context,(self.before,self.rehearsed,self.retained))
        self.cache.continuation_authority.FORMAT=m.AUTHORITY_FORMAT
        self.live.symlink_to('/etc/systemd/system/yunipals-read-cache.service')
        with self.assertRaises(RuntimeError):m.retained_stop(self.context,(self.before,self.rehearsed,self.retained))

    def test_actual_full_lifecycle_bodies_and_own_identity_are_retained(self):
        root,proof,value=self.runtime();prior=proof.cache_finish_module(root,types.SimpleNamespace(proof=proof,inputs={'sourceManifestSha256':proof.manifest_sha}))
        self.assertEqual(value.FORMAT,m.FORMAT);self.assertEqual(value.BASE,self.owner_base);self.assertEqual(value.__file__,str(m.FILE))
        for name,fn in vars(prior).items():
            if type(fn)is types.FunctionType and name not in{'review','load','operation','drain_for_inverse'}:
                new=getattr(value,name);self.assertEqual(new.__code__.co_code,fn.__code__.co_code,name)
                self.assertEqual(new.__code__.co_consts,fn.__code__.co_consts,name);self.assertEqual(new.__defaults__,fn.__defaults__,name)
                self.assertEqual(new.__closure__,fn.__closure__,name);self.assertIs(new.__globals__,value.__dict__,name)
        self.assertNotIn('stopped.json',value.review.__code__.co_consts)
        self.assertIn('retained_stop',value.review.__code__.co_names)
        self.assertNotIn(m.FILE.name,proof.manifest['files'])
        self.assertIn('cache_finish_owner_sha',value.drain_for_inverse.__code__.co_names)

    def lifecycle(self,start_unknown=False):
        root,proof,value=self.runtime();c=self.context
        c.inputs={'sourceManifestSha256':proof.manifest_sha,'cachePreparedSha256':self.prepared_sha};c.proof=proof
        c.scope=Mock(return_value={'explicitOriginalFullCatalogSourceScopeFixture':True});c.inverse_scope=Mock();c.generation_terminal=Mock()
        c.query=Mock(return_value={'max':500,'reserved':10,'total':5})
        proof.document=lambda path,digest=None:m.document(path,digest);proof.protected=self.public;proof.terminal=Mock()
        c.terminal_sessions=Mock(return_value={'owned':[],'explicitTerminalKernelIOFixture':True})
        self.cache.inode=types.FunctionType(old.inode.__code__,{**old.inode.__globals__,'protected':self.public},old.inode.__name__,old.inode.__defaults__)
        self.cache.DROP=self.cache_base/'drop.conf'
        self.cache.publish_drop=Mock(side_effect=lambda host:self.put(self.cache.DROP,{'explicitOwnedNativeCacheDefinitionFixture':True}))
        state={'InvocationID':'prior-stopped-fixture','MainPID':'0','ControlPID':'0','Job':'','UnitFileState':'disabled','WantedBy':'','ActiveState':'inactive'}
        native={'main':{'pid':90001,'startTicks':0},'unit':state,'processes':[{'pid':90001,'startTicks':0}]}
        def manager(action):
            if action=='start':
                native['main']['startTicks']=time.monotonic_ns()*os.sysconf('SC_CLK_TCK')//1_000_000_000
                native['processes'][0]['startTicks']=native['main']['startTicks']
                state.update(InvocationID='new-owned-fixture',MainPID='90001',ActiveState='active')
                if start_unknown:raise RuntimeError('fixture_actual_start_ACK_unknown')
            elif action=='stop':state.update(MainPID='0',ActiveState='inactive')
            elif action=='daemon-reload':state.update(UnitFileState='enabled'if os.path.lexists(self.live)else'disabled',WantedBy='multi-user.target'if os.path.lexists(self.live)else'')
            else:raise AssertionError('unexpected manager action')
        self.cache.manager=Mock(side_effect=manager);self.cache.loaded=Mock(side_effect=lambda *_:copy.deepcopy(state))
        c.host.actor=Mock(side_effect=lambda *_:copy.deepcopy(native));c.host.state=Mock(side_effect=lambda:copy.deepcopy(state))
        c.host.sessions=Mock(return_value={'owned':[],'explicitKernelSessionCaptureFixture':True})
        def terminal(actor,sessions):
            self.assertEqual(state['MainPID'],'0');self.assertEqual(state['InvocationID'],actor['unit']['InvocationID']);return copy.deepcopy(state)
        c.host.terminal=Mock(side_effect=terminal)
        self.cache.sql_child=Mock(return_value={'collections':[{'collection':name,'fresh':True}for name in['ethereum','base','polygon','bnb']]})
        value.context=lambda *_:(c,{}, {'generationId':'105'});root.positive_reader=Mock(return_value={'explicitActualAPIHealthIOFixture':True})
        root.reader_descriptor=lambda operation,name:{'explicitOwnedReaderDescriptorFixture':name};root.owned_reader=Mock()
        canonical=Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-v2-20261025/original-boot-link');archive=self.archive
        def RelocatedPath(*args,**kwargs):
            if args and str(args[0])==str(canonical):args=(str(archive),*args[1:])
            return Path(*args,**kwargs)
        # Explicit test filesystem relocation only: the original four boot
        # expression bodies and the actual kernel symlink inode remain intact.
        value.Path=RelocatedPath
        return root,proof,value,c,state

    def test_actual_start_gap_reconcile_has_real_owned_journals_and_zero_manager_replay(self):
        root,proof,value,c,state=self.lifecycle(start_unknown=True)
        reviewed=value.review(root,proof,self.refs['resultSha256'])
        with self.assertRaisesRegex(RuntimeError,'fixture_actual_start_ACK_unknown'):
            value.start(root,proof,self.refs['resultSha256'],reviewed['reviewHash'])
        self.assertTrue((self.owner_base/'operation.json').exists());self.assertTrue((self.owner_base/'start-intent.json').exists())
        self.assertFalse((self.owner_base/'started.json').exists());before=len(self.cache.manager.call_args_list)
        result=value.reconcile_start(root,proof)
        self.assertTrue(result['reconciled']);self.assertEqual(len(self.cache.manager.call_args_list),before)
        self.assertTrue((self.owner_base/'started.json').exists());self.assertEqual(result['serviceActions'],0)

    def test_real_start_accept_boot_inode_pure_ACK_and_inverse_drain_with_unchanged455c(self):
        root,proof,value,c,state=self.lifecycle();reviewed=value.review(root,proof,self.refs['resultSha256'])
        started=value.start(root,proof,self.refs['resultSha256'],reviewed['reviewHash']);self.assertTrue(started['started']);self.assertFalse(started['accepted'])
        acceptance=value.acceptance_review(root,proof);done=value.accept(root,proof,acceptance['reviewHash'])
        self.assertTrue(done['completed']);self.assertEqual(root.positive_reader.call_count,len(proof.PEERS))
        self.assertEqual(old.inode(self.live,True),self.boot);self.assertFalse(os.path.lexists(self.archive))
        with patch.object(m,'reader_ancestry',return_value=(self.ack,{})):
            ack=m.acknowledgement(done['resultSha256'],self.input_sha)
        self.assertTrue(ack['immutableCacheAcknowledgementOnly']);self.assertEqual(ack['readerRefs'],self.refs)
        self.assertFalse(ack['originalReader5CacheFinishPassed']);self.assertFalse(ack['currentActorQualified'])
        self.assertNotIn(m.FILE.name,c.manifest['files'] if hasattr(c,'manifest')else proof.manifest['files'])
        c.manifest=proof.manifest
        drained=value.drain_for_inverse(c)
        self.assertTrue(drained['nativeCacheStopped']);self.assertEqual(old.inode(self.archive,True),self.boot)
        self.assertFalse(os.path.lexists(self.live));self.assertTrue((self.owner_base/'inverse-stopped.json').exists())
        self.assertEqual(self.cache.manager.call_args_list.count(unittest.mock.call('stop')),1)
        # The immutable new ACK keeps the genuine original journal frames even
        # after this owner's later inverse; changing an old record refuses it.
        self.put(self.prior/'stop-intent.json',{'foreignRetainedStopIntentFixture':True})
        with patch.object(m,'reader_ancestry',return_value=(self.ack,{})),self.assertRaises(RuntimeError):
            m.acknowledgement(done['resultSha256'],self.input_sha)

    def test_later_operation_and_inverse_drain_bind_exact_input_and_reader_lineage(self):
        root,proof,value,c,state=self.lifecycle();reviewed=value.review(root,proof,self.refs['resultSha256'])
        value.start(root,proof,self.refs['resultSha256'],reviewed['reviewHash']);saved=m.document(self.owner_base/'operation.json')
        self.assertEqual(value.operation(root),saved);c.manifest=proof.manifest
        calls=len(self.cache.manager.call_args_list)
        for key in ['cacheOwnerInputSha256','readerAcknowledgementSha256','cutoverSha256','cachePreparedSha256','operationSha256','sourceManifestSha256']:
            changed=copy.deepcopy(saved);changed['binding'][key]=P('foreign-'+key);changed['reviewHash']=m.sha(m.encoded(changed['binding']))
            self.put(self.owner_base/'operation.json',changed)
            with self.assertRaisesRegex(RuntimeError,'same_actual_cache_owner_input_reader_ACK_and_prepared_operation'):
                value.operation(root)
            with self.assertRaisesRegex(RuntimeError,'same_actual_cache_owner_input_reader_ACK_and_prepared_operation'):
                value.drain_for_inverse(c)
            self.assertFalse((self.owner_base/'inverse-stop-intent.json').exists())
            self.assertEqual(len(self.cache.manager.call_args_list),calls)
        self.put(self.owner_base/'operation.json',saved)
        self.assertEqual(old.inode(self.archive,True),self.boot)

    def test_actual_main_uses_real_shared_and_generation_locks_then_source_postflight(self):
        root,proof,value,c,state=self.lifecycle();shared=self.base/'shared.lock';generation_path=self.base/'generation.lock'
        original=root.transition_lock.__wrapped__
        def lock_path(path):return shared if str(path)=='/run/lock/yunipals-ypal-combined-transition.lock'else Path(path)
        root.transition_lock=contextlib.contextmanager(types.FunctionType(original.__code__,{**original.__globals__,'Path':lock_path},
            original.__name__,original.__defaults__,original.__closure__))
        generation=load('ypal-native-generation-v1.py');generation.LOCK=generation_path
        def assert_lock(path,held):
            fd=os.open(path,os.O_RDWR)
            try:
                if held:
                    with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                else:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(fd)
        original_review=value.review
        def review(*args):
            assert_lock(shared,True);assert_lock(generation_path,True);return original_review(*args)
        value.review=review
        def finish():
            assert_lock(shared,False);assert_lock(generation_path,False);return {'explicitFullSourcePostflightIOFixture':True}
        session=types.SimpleNamespace(finish=Mock(side_effect=finish));proof.module=Mock(return_value=generation)
        arguments=[str(HERE/m.FILE.name),'--input-sha',self.input_sha,'--review']
        with patch.object(m,'session_context',return_value=(session,root,proof,value)),\
            patch.object(m.os,'uname',return_value=types.SimpleNamespace(nodename='yunipals-main')),\
            patch('sys.argv',arguments),contextlib.redirect_stdout(io.StringIO())as output:
            m.main()
        self.assertTrue(json.loads(output.getvalue())['fullSourcePostflight']['explicitFullSourcePostflightIOFixture'])
        self.assertEqual(session.finish.call_count,1);self.assertFalse(self.owner_base.exists())
        c.scope.side_effect=RuntimeError('strict_original_current_scope_fixture_refusal')
        with patch.object(m,'session_context',return_value=(session,root,proof,value)),\
            patch.object(m.os,'uname',return_value=types.SimpleNamespace(nodename='yunipals-main')),\
            patch('sys.argv',arguments),self.assertRaisesRegex(RuntimeError,'strict_original_current_scope'):
            m.main()
        assert_lock(shared,False);assert_lock(generation_path,False);self.assertEqual(session.finish.call_count,1)

    def test_original_four_freshness_gate_refuses_before_accept_or_boot_move(self):
        root,proof,value,c,state=self.lifecycle();reviewed=value.review(root,proof,self.refs['resultSha256'])
        value.start(root,proof,self.refs['resultSha256'],reviewed['reviewHash'])
        self.cache.sql_child.return_value={'collections':[{'collection':'ethereum','fresh':True}]}
        with self.assertRaisesRegex(RuntimeError,'all_four_actual_official_native_cache_freshness'):
            value.acceptance_review(root,proof)
        self.assertFalse((self.owner_base/'result.json').exists());self.assertEqual(old.inode(self.archive,True),self.boot)
        self.cache.sql_child.return_value={'collections':[{'collection':name,'fresh':True}for name in['ethereum','base','polygon','bnb']]}
        acceptance=value.acceptance_review(root,proof);root.positive_reader.side_effect=RuntimeError('actual_reader_API_health_IO_fixture_refusal')
        with self.assertRaisesRegex(RuntimeError,'actual_reader_API_health'):
            value.accept(root,proof,acceptance['reviewHash'])
        self.assertFalse((self.owner_base/'result.json').exists());self.assertEqual(old.inode(self.archive,True),self.boot)

    def test_original_global_capacity_refuses_before_native_cache_start(self):
        root,proof,value,c,state=self.lifecycle();reviewed=value.review(root,proof,self.refs['resultSha256'])
        c.query.return_value={'max':20,'reserved':10,'total':5}
        with self.assertRaisesRegex(RuntimeError,'fresh_global_room_for_retained_cache_pool'):
            value.start(root,proof,self.refs['resultSha256'],reviewed['reviewHash'])
        self.assertNotIn(unittest.mock.call('start'),self.cache.manager.call_args_list)
        self.assertFalse((self.owner_base/'start-intent.json').exists());self.assertFalse((self.owner_base/'result.json').exists())
        self.assertEqual(old.inode(self.archive,True),self.boot)

    def test_genuine_review_now_succeeds_with_real_retained_stop_and_provenance(self):
        root,proof,value=self.runtime();c=self.context
        c.inputs={'sourceManifestSha256':proof.manifest_sha,'cachePreparedSha256':self.owner_config['cachePreparedSha256']}
        c.scope=Mock(return_value={'explicitAllOriginalCatalogScopeFixture':True});c.generation_terminal=Mock()
        original_context=value.context;value.context=lambda *_:(c,{}, {'generationId':'105'})
        try:reviewed=value.review(root,proof,self.refs['resultSha256'])
        finally:value.context=original_context
        self.cache.stopped.assert_called_once_with(c.host);c.scope.assert_has_calls([unittest.mock.call(True),unittest.mock.call(True)])
        binding=reviewed['binding'];self.assertEqual(binding['oldCacheStoppedSha256'],self.retained['priorStoppedSha256'])
        self.assertEqual(binding['retainedActualStop']['priorStoppedFile'],str(self.prior/'stopped.json'))
        self.assertEqual(binding['cacheOwnerInputSha256'],self.input_sha);self.assertEqual(reviewed['reviewHash'],m.sha(m.encoded(binding)))
        self.assertFalse((self.cache_base/'stopped.json').exists());self.assertFalse(self.owner_base.exists())

    def test_protected_input_is_exact_private_and_requires_actual_reader5_refs(self):
        self.assertEqual(m.configuration(self.input_sha),self.owner_config)
        self.input.chmod(0o644)
        with self.assertRaises(RuntimeError):m.configuration(self.input_sha)
        self.input.chmod(0o600)
        changed={**self.owner_config,'readerRefs':{**self.refs,'producerSha256':P('foreign')}}
        digest=self.put(self.input,changed)
        with self.assertRaises(RuntimeError):m.configuration(digest)

if __name__=='__main__':unittest.main()
