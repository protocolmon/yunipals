"""Parser and retained-body controls with synthetic credentials; no host effects."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=load('arena-native-derived-projector-v2.py')
old=load(m.FROZEN.name)
installer=load('arena-native-derived-support-install-v2.py')
builder=load('arena-native-derived-projector-v2-manifest.py')
emitter=load('arena-ypal-native-v2.credentials.py')
native=emitter.content({'group':'source','role':'arena_native_reader'},'S'*48)
public_env=b'ARENA_PUBLIC_ROLLBACK_DATABASE_URL=postgresql://synthetic-only\n'
manifest=json.loads((HERE/m.MANIFEST.name).read_bytes())


def public(path,expected=None,maximum=4000000):
    path=Path(path)
    actual=HERE.parent/'arena-public-rollback-target-20261023'/path.name if str(path)in m.EXTERNAL_PROGRAMS else HERE/path.name
    raw=actual.read_bytes();m.need(0<len(raw)<=maximum and(expected is None or m.sha(raw)==expected),'fixture_actual_public_source_bytes_required');return raw


def namespace():
    with patch.object(m,'protected',side_effect=public):return m.composition()


def code(value):
    c=value.__code__
    def constant(value):
        if isinstance(value,types.CodeType):return(value.co_code,tuple(constant(v)for v in value.co_consts),value.co_names,value.co_varnames,value.co_freevars,value.co_cellvars,value.co_flags)
        return value
    return constant(c)


class Controls(unittest.TestCase):
    def test_real_credential_emitter_four_keys_are_accepted_without_changing_bytes(self):
        self.assertEqual(len(native.decode().splitlines()),4)
        self.assertEqual(m.credential_url(native,emitter.RELEASE_ID,True),native.decode().splitlines()[3].split('=',1)[1])
        self.assertEqual(m.credential_url(public_env,emitter.RELEASE_ID,False),'postgresql://synthetic-only')
        self.assertEqual(m.sha(native),m.sha(emitter.content({'group':'source','role':'arena_native_reader'},'S'*48)))

    def test_wrong_native_selectors_keys_shapes_or_empty_values_refuse(self):
        variants=[native.replace(b'=unified',b'=legacy',1),native.replace(b'SOURCE_KIND=unified',b'SOURCE_KIND=legacy'),
            native.replace(emitter.RELEASE_ID.encode(),b'0x'+b'0'*64),native+b'EXTRA=1\n',b'\n'.join(native.splitlines()[1:]),
            native.replace(b'ARENA_INDEXER_DATABASE_URL=',b'OTHER_DATABASE_URL='),native.split(b'ARENA_INDEXER_DATABASE_URL=')[0]+b'ARENA_INDEXER_DATABASE_URL=\n',
            native.replace(b'\n',b'\r\n'),public_env]
        for raw in variants:
            with self.subTest(shape=m.sha(raw)),self.assertRaises(RuntimeError):m.credential_url(raw,emitter.RELEASE_ID,True)
        for raw in [public_env+public_env,b'ARENA_PUBLIC_ROLLBACK_DATABASE_URL=\n',native]:
            with self.assertRaises(RuntimeError):m.credential_url(raw,emitter.RELEASE_ID,False)

    def test_actual_owner_method_authenticates_same_three_existing_credential_hashes(self):
        n=namespace();owner=object.__new__(n.Owner);owner.native={'releaseId':emitter.RELEASE_ID}
        owner.source_auth={'credentialFiles':{str(n.NATIVE_ENV):m.sha(native)}}
        owner.target_auth={'credentialFiles':{str(path):m.sha(public_env)for path in[n.READER_ENV,n.WRITER_ENV]}}
        def credential(path,digest,maximum):
            raw=native if path==n.NATIVE_ENV else public_env
            m.need(m.sha(raw)==digest and len(raw)<=maximum,'fixture_exact_credential_hash_required');return raw
        with patch.object(n,'protected',side_effect=credential):
            for reader in[False,True]:
                files,urls=owner.existing_credentials(reader)
                self.assertEqual(set(files),{n.NATIVE_ENV,n.READER_ENV if reader else n.WRITER_ENV})
                self.assertEqual(urls,{'sourceUrl':m.credential_url(native,emitter.RELEASE_ID,True),'targetUrl':'postgresql://synthetic-only'})
            owner.source_auth['credentialFiles'][str(n.NATIVE_ENV)]='0'*64
            with self.assertRaises(RuntimeError):owner.existing_credentials()
        legacy=object.__new__(old.Owner);legacy.source_auth={'credentialFiles':{str(old.NATIVE_ENV):m.sha(native)}};legacy.target_auth=owner.target_auth
        with patch.object(old,'protected',side_effect=credential),self.assertRaisesRegex(RuntimeError,'one_exact_existing_projector_credential_required'):legacy.existing_credentials()

    def test_every_other_owner_method_and_top_level_algorithm_is_retained(self):
        n=namespace();changes=[]
        for name,value in vars(old.Owner).items():
            if isinstance(value,types.FunctionType)and code(value)!=code(getattr(n.Owner,name)):changes.append(name)
        self.assertEqual(changes,['existing_credentials'])
        changes=[]
        for name,value in vars(old).items():
            if isinstance(value,types.FunctionType)and code(value)!=code(getattr(n,name)):changes.append(name)
        self.assertEqual(changes,['support_manifest'])
        for name in ['UNIT','SOCKET_UNIT','SOCKET','PUBLIC','NODE','NODE_SHA','DEPENDENCIES','SOURCE_AUTH','TARGET_AUTH','SOURCE_ADMISSION_SHA']:
            self.assertEqual(getattr(n,name),getattr(old,name),name)
        self.assertNotEqual(n.BASE,old.BASE);self.assertNotEqual(n.INPUT,old.INPUT);self.assertNotEqual(n.FORMAT,old.FORMAT)
        self.assertEqual(n.UNIT,'yunipals-arena-native-derived-projector-v1.service')

    def test_support_manifest_uses_actual_new_artifact_and_retains_original_facade(self):
        n=namespace()
        with patch.object(n,'protected',side_effect=public):value,files,target=n.support_manifest(installer.MANIFEST_SHA)
        self.assertEqual(value,manifest);self.assertEqual(target,installer.TARGET);self.assertEqual(n.BUILD_SHA,manifest['builderSha256'])
        self.assertEqual(n.PROJECTOR_SHA,files['dist/arena-native-derived-projector-v1.mjs']['sha256'])
        self.assertEqual(value['predecessorArtifactDigest'],'a330c3f1ba2701ba287f0675b0c6c11ca010e85d504d5e8798df574625972f67')
        self.assertEqual(len(value['inputs']),50);self.assertEqual(len(files),3)
        previous=json.loads((HERE/old.MANIFEST.name).read_bytes())
        for name in ['dist/arena-inverse-support.mjs','dist/arena-inverse-support.mjs.map']:
            self.assertEqual(files[name],next(row for row in previous['files']if row['path']==name))
        for change in [lambda v:v.update(officialReducerBodyChanged=True),lambda v:v.update(historicalDepth3ScannerSuccessClaimed=True),lambda v:v['files'][0].update(path='../private')]:
            v=copy.deepcopy(manifest);change(v)
            with patch.object(n,'document',return_value=v),self.assertRaises(RuntimeError):n.support_manifest('a'*64)

    def test_complete_finite_source_manifest_is_real_and_reproducible(self):
        actual=builder.build();self.assertEqual(actual,json.loads((HERE/m.SOURCE_MANIFEST.name).read_bytes()))
        self.assertEqual(len(actual['files']),164);self.assertEqual(len(actual['externalPrograms']),6)
        self.assertEqual(m.sha(m.encoded(actual)),m.sha((HERE/m.SOURCE_MANIFEST.name).read_bytes()))
        with patch.object(m,'protected',side_effect=lambda path,*args,**kwargs:b'{}'if Path(path).name==m.SOURCE_MANIFEST.name else public(path,*args,**kwargs)),self.assertRaises(RuntimeError):m.composition()

    def test_installer_retains_full_exclusive_installation_bodies(self):
        with patch.object(installer,'public',side_effect=public):wrapper=installer.composition()
        with patch.object(wrapper,'public',side_effect=public):n=wrapper.implementation()
        original=load('arena-ordinary-runtime-v1.py')
        for name in ['review','install','installed','layout','exclusive','protected']:self.assertEqual(code(getattr(n,name)),code(getattr(original,name)),name)
        with patch.object(wrapper,'public',side_effect=public):self.assertEqual(n.manifest()[1],manifest)
        self.assertEqual(n.ARTIFACT,installer.ARTIFACT)
        self.assertEqual(n.INPUT,installer.INPUT);self.assertEqual(n.BASE,installer.BASE)
        self.assertIn(3,n.main.__code__.co_consts);self.assertNotIn(16,n.main.__code__.co_consts)

    def test_default_clis_are_inert_without_private_files_or_runtime_construction(self):
        for name in [m.FILE.name,'arena-native-derived-support-install-v2.py','arena-native-derived-projector-v2-manifest.py']:
            value=subprocess.run(['python3','-I','-B',str(HERE/name)],capture_output=True,check=True,text=True)
            result=json.loads(value.stdout);self.assertTrue(result['staticOnly']);self.assertEqual(result['databaseWrites'],0)


if __name__=='__main__':unittest.main()
