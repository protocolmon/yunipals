#!/usr/bin/env python3
"""Synthetic local tests only; no host actor, credential, SQL or provider access."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
BASELINE=HERE/'arena-owner-migration-v10.py'
OWNER=HERE/'arena-owner-migration-v11.py'
M=types.ModuleType('owner_actual_v11_test');M.__file__=str(OWNER)
raw=BASELINE.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='916990726b874f9a9b31719a61e14ac465470326d96cd54dba7b2911018f1f76'
exec(compile(OWNER.read_bytes(),str(OWNER),'exec'),M.__dict__)

class Tests(unittest.TestCase):
    def setUp(self):
        self.root=Path('/fixture/installed')
        self.unit='yunipals-arena-api.service'
        self.config=b'public synthetic config';self.helper=b'public synthetic private-file reader'
        self.manifest={'files':[{'path':'apps/yunipals-market-api/src/arena/live/'+name,'bytes':len(body),'sha256':M.sha(body)}for name,body in [('config.ts',self.config),('privateFile.ts',self.helper)]]}
        self.private_reads=[];self.reads=[]
        self.props={'MainPID':'12345','InvocationID':'a'*32}
        self.identity={'pid':12345,'startTicks':123}
        self.baseline={'services':[{'unit':self.unit,'credentialFileReferences':['strategy-encryption.key:/etc/yunipals-arena/strategy-encryption.key']}]}
        self.addCleanup(patch.stopall)
        patch.object(M,'ROOT',self.root).start()
        patch.object(M,'MANIFEST_SHA',M.sha(self.manifest_bytes())).start()
        patch.object(M,'process_identity',return_value=self.identity).start()
        patch.object(M,'secret_reader_script',return_value=b'only official reader').start()
        self.reply=json.dumps([{'id':'strategy-encryption.key','sha256':M.sha(b'fixture-key')}]).encode()

    def manifest_bytes(self):return json.dumps(self.manifest).encode()
    def reader(self,changed=None):
        def read(path,*_,**options):
            self.reads.append(path)
            if options.get('private'):
                self.private_reads.append(path);return b'fixture-key',[]
            if path.name=='RELEASE-MANIFEST.json':return self.manifest_bytes(),[]
            if path.name=='config.ts':return self.config,[]
            if path.name=='privateFile.ts':return self.helper,[]
            self.fail('unplanned source read')
        return types.SimpleNamespace(read=read,unit_state=lambda *_:dict(self.props))
    def compatible(self):return M.compatible_secret_reader(self.reader(),None,self.baseline,{self.unit:self.identity})
    def source_failure(self,change):
        change();M.MANIFEST_SHA=M.sha(self.manifest_bytes())
        with patch.object(M,'run')as run,self.assertRaises(M.MigrationFailure):self.compatible()
        run.assert_not_called();self.assertEqual(self.private_reads,[])

    def test_clean_probe_binds_both_sources_and_exact_directory(self):
        with patch.object(M,'run',return_value=self.reply)as run:result=self.compatible()
        argv=run.call_args.args[0]
        self.assertEqual([v for v in argv if v.startswith('CREDENTIALS_DIRECTORY=')],['CREDENTIALS_DIRECTORY=/run/credentials/'+self.unit])
        for token in ['--reuid=971','--regid=965','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','-i','TSX_DISABLE_CACHE=1']:self.assertIn(token,argv)
        self.assertFalse(any(v.startswith(('PG','OPENAI_','ARENA_DATABASE_URL='))for v in argv))
        self.assertEqual(result[self.unit]['officialConfigSourceSha256'],M.sha(self.config))
        self.assertEqual(result[self.unit]['officialPrivateFileSourceSha256'],M.sha(self.helper))
        self.assertNotIn('fixture-key',json.dumps(result))

    def test_missing_helper_row_refuses_before_namespace(self):self.source_failure(lambda:self.manifest['files'].pop())
    def test_duplicate_helper_row_refuses_before_namespace(self):self.source_failure(lambda:self.manifest['files'].append(self.manifest['files'][-1]))
    def test_modified_helper_body_refuses_before_namespace(self):self.source_failure(lambda:setattr(self,'helper',self.helper+b'changed'))
    def test_modified_config_body_refuses_before_namespace(self):self.source_failure(lambda:setattr(self,'config',self.config+b'changed'))
    def test_wrong_manifest_hash_refuses_before_namespace(self):
        M.MANIFEST_SHA='0'*64
        with patch.object(M,'run')as run,self.assertRaises(M.MigrationFailure):self.compatible()
        run.assert_not_called()
    def test_foreign_unit_refuses_before_namespace(self):
        self.baseline['services'][0]['unit']='foreign.service'
        with patch.object(M,'run')as run,self.assertRaises(M.MigrationFailure):self.compatible()
        run.assert_not_called();self.assertEqual(self.private_reads,[])
    def test_actor_drift_refuses_before_namespace_or_private_read(self):
        with patch.object(M,'process_identity',return_value={'pid':12346}),patch.object(M,'run')as run,self.assertRaises(M.MigrationFailure):self.compatible()
        run.assert_not_called();self.assertEqual(self.private_reads,[])
    def test_wrong_loaded_bytes_refuse(self):
        with patch.object(M,'run',return_value=b'[]'),self.assertRaises(M.MigrationFailure):self.compatible()

class BuildEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.path=Path('/mnt/HC_Volume_107222036/arena-credential-package-20261022-b/attempt-result.json')
        self.source='110c622afa37745cd78877e0a5b9e124f20965934e816f060e071d974d2e0158'
        self.review='b'*64;self.proof_sha='c'*64;self.manifest_sha='d'*64
        self.patches={
            'apps/yunipals-market-api/src/arena/live/config.ts':'fdb0f1f29cacbc6a58b78a40c0d96cd38ff82b2b0caec8d49c12a99ca8c1e14e',
            'apps/yunipals-market-api/src/arena/live/privateFile.ts':'0e89988993ceda801201803f454ea6d1dd12b90d669368d509e476b568465750',
            'apps/yunipals-market-api/src/arena/live/privateFile.test.ts':'2b2aa80c0732db2814d8484b968b96159d22379aa67c0ceba90902191ae59b54'}
        self.proof={'format':'yunipals-arena-credential-dependency-clone-package-v2','status':'passed','sourceDigest':self.source,'reviewHash':self.review,'source':{'manifestSha256':self.manifest_sha,'exactPatchedSources':self.patches,'archiveSha256':'e'*64},'runtime':{'archiveSha256':'f'*64,'inventorySha256':'1'*64},'verification':{'targetedCredentialReaderSuites':2}}
        self.result={'format':self.proof['format'],'status':'passed','sourceDigest':self.source,'reviewHash':self.review,'proofSha256':self.proof_sha,'sourceArchiveSha256':'e'*64,'runtimeArchiveSha256':'f'*64,'runtimeInventorySha256':'1'*64,'steps':[{'name':name,'exitCode':0,'stdoutSha256':M.sha(('79 tests '+name).encode()),'stderrSha256':M.sha(b'')}for name in ('credential-reader-controls','relocated-credential-reader-controls')]}
        self.addCleanup(patch.stopall)
        for name,value in [('SOURCE',self.source),('MANIFEST_SHA',self.manifest_sha),('PROOF_SHA',self.proof_sha)]:patch.object(M,name,value).start()
        self.reads=[]
    def validate(self,path=None,pin=None,review=None):
        raw=json.dumps(self.result).encode()
        def read(p,*_):self.reads.append(p);return raw,[]
        return M.credential_build_evidence(types.SimpleNamespace(read=read),self.proof,attempt_result_file=path or self.path,attempt_result_sha256=pin or M.sha(raw),build_review_hash=review or self.review)
    def test_actual_named_two_steps_and_same_raw_pin_accept(self):
        self.result['steps'].insert(0,{'name':'full-typecheck','exitCode':0})
        value=self.validate();self.assertTrue(value['twoActualCredentialSuitesAccepted']);self.assertEqual(self.reads,[self.path]);self.assertEqual(len(value['suiteSteps']),2)
    def test_wrong_path_or_placeholder_refuses_before_read(self):
        for kwargs in [{'path':Path('/tmp/untrusted')},{'pin':'0'*64},{'review':'0'*64}]:
            with self.subTest(kwargs=kwargs),self.assertRaises(M.MigrationFailure):self.validate(**kwargs)
        self.assertEqual(self.reads,[])
    def test_raw_result_hash_mismatch_refuses(self):
        with self.assertRaises(M.MigrationFailure):self.validate(pin='9'*64)
    def test_missing_first_or_second_suite_refuses(self):
        for index in (0,1):
            original=copy.deepcopy(self.result);self.result['steps'].pop(index)
            with self.subTest(index=index),self.assertRaises(M.MigrationFailure):self.validate()
            self.result=original
    def test_duplicate_suite_refuses(self):
        self.result['steps'].append(copy.deepcopy(self.result['steps'][0]))
        with self.assertRaises(M.MigrationFailure):self.validate()
    def test_failed_non_numeric_or_boolean_exit_refuses(self):
        for value in (1,'0',False):
            self.result['steps'][0]['exitCode']=value
            with self.subTest(exit=value),self.assertRaises(M.MigrationFailure):self.validate()
    def test_empty_stdout_or_invalid_log_hash_refuses(self):
        for value in (M.sha(b''),'0'*64,'not-a-hash'):
            self.result['steps'][0]['stdoutSha256']=value
            with self.subTest(hash=value),self.assertRaises(M.MigrationFailure):self.validate()
    def test_wrong_proof_source_review_or_runtime_binding_refuses(self):
        for key in ('sourceDigest','reviewHash','proofSha256','runtimeArchiveSha256','runtimeInventorySha256','sourceArchiveSha256'):
            original=self.result[key];self.result[key]='8'*64
            with self.subTest(key=key),self.assertRaises(M.MigrationFailure):self.validate()
            self.result[key]=original
    def test_wrong_patch_test_suite_count_or_old_format_refuses(self):
        for change in ('patch','count','format'):
            original=copy.deepcopy(self.proof)
            if change=='patch':self.proof['source']['exactPatchedSources']['apps/yunipals-market-api/src/arena/live/privateFile.test.ts']='8'*64
            elif change=='count':self.proof['verification']['targetedCredentialReaderSuites']=1
            else:self.proof['format']='yunipals-arena-credential-dependency-clone-package-v1'
            with self.subTest(change=change),self.assertRaises(M.MigrationFailure):self.validate()
            self.proof=original
    def test_missing_both_archive_pins_cannot_match_as_none(self):
        self.proof['runtime'].pop('archiveSha256');self.result.pop('runtimeArchiveSha256')
        with self.assertRaises(M.MigrationFailure):self.validate()
    def test_evidence_reader_has_no_writes_or_child_operations(self):
        tree=ast.parse(OWNER.read_text())
        node=next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='credential_build_evidence')
        called={call.func.id if isinstance(call.func,ast.Name)else call.func.attr if isinstance(call.func,ast.Attribute)else ''for call in ast.walk(node)if isinstance(call,ast.Call)}
        self.assertTrue({'save','run','sql','open','write','write_bytes','write_text','subprocess','mkdir','unlink'}.isdisjoint(called))

class StructureTests(unittest.TestCase):
    def test_only_approved_constants_review_binding_and_functions_change(self):
        oldtext=BASELINE.read_text();newtext=OWNER.read_text()
        old=ast.parse(oldtext);new=ast.parse(newtext)
        oldfn={n.name:n for n in old.body if isinstance(n,ast.FunctionDef)}
        newfn={n.name:n for n in new.body if isinstance(n,ast.FunctionDef)}
        dump=lambda node:ast.dump(node,include_attributes=False)
        self.assertEqual(set(newfn)-set(oldfn),{'credential_build_evidence'})
        self.assertEqual({name for name in oldfn if dump(oldfn[name])!=dump(newfn[name])},{'compatible_secret_reader','review'})
        reviewed={'compatible_secret_reader':'7a22688e7638589d6d35fa358539cd747fa95b95bbff7d932d432ae2728efd51','credential_build_evidence':'e6a3b33e53365ad4f4f2cb2a890d1baf8b6eb36269c1c362212e31733765e230'}
        for name,pin in reviewed.items():self.assertEqual(hashlib.sha256(dump(newfn[name]).encode()).hexdigest(),pin)
        review=ast.get_source_segment(newtext,newfn['review'])
        call="    credential_evidence=credential_build_evidence(o,proof,attempt_result_file=CREDENTIAL_BUILD_RESULT_FILE,attempt_result_sha256=CREDENTIAL_BUILD_RESULT_SHA,build_review_hash=CREDENTIAL_BUILD_REVIEW_SHA)\n"
        self.assertEqual(review.count(call),1)
        review=review.replace(call,'').replace(",'credentialBuildEvidence':credential_evidence",'')
        self.assertEqual(review,ast.get_source_segment(oldtext,oldfn['review']))
        changed={'FORMAT','BASE','ROOT','ARTIFACT','MANIFEST_SHA','PROOF_SHA','INVENTORY_SHA','RUNTIME_SHA'}
        added={'CREDENTIAL_BUILD_RESULT_FILE','CREDENTIAL_BUILD_RESULT_SHA','CREDENTIAL_BUILD_REVIEW_SHA'}
        def invariant(tree):
            values=[]
            for node in tree.body:
                if isinstance(node,ast.FunctionDef)and node.name in {'compatible_secret_reader','review','credential_build_evidence'}:continue
                if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id in changed|added:continue
                values.append(dump(node))
            return values
        self.assertEqual(invariant(old),invariant(new))
        self.assertEqual(M.SOURCE,'110c622afa37745cd78877e0a5b9e124f20965934e816f060e071d974d2e0158')
        self.assertEqual(M.MANIFEST_SHA,'4a615755939d813251e585676f287c5696a76d6e8627c35fcbae1546e2716359')
        self.assertEqual(M.PROOF_SHA,'357bf57f4443f2eac239699793281a7317b46bc97e93340dd671db3aab4ff0b2')
        self.assertEqual(M.INVENTORY_SHA,'32935e1cc702f8d513c89d377dab45e399a6ad839ee5b2304d67e7c269ddc84d')
        self.assertEqual(M.RUNTIME_SHA,'f34a10658b97ea96fb46b45220eb0182cc494a497396b0b65d9b930fd60a35f5')
        self.assertEqual(M.CREDENTIAL_BUILD_RESULT_SHA,'203073f7f2e7018b3030501dc7374825b0cd1978260cb7f780ec59171a7f036e')
        self.assertEqual(M.CREDENTIAL_BUILD_REVIEW_SHA,'4782a418113b72a5fb4d7428d6a3c99c480b0d394a1a10d3883106e914988dfa')
        plan=json.loads((HERE/'arena-owner-migration-v11.plan.json').read_bytes())
        self.assertEqual(plan,{'format':M.FORMAT,'packageProofFile':str(M.ARTIFACT/'arena-consumer-package-proof.json'),'packageProofSha256':M.PROOF_SHA,'runtimeInventoryFile':str(M.ARTIFACT/'runtime-supplement.inventory.json'),'runtimeInventorySha256':M.INVENTORY_SHA})

if __name__=='__main__':unittest.main()
