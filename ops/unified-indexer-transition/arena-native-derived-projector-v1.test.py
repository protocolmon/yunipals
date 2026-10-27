"""Source and installer controls; no host, credential, database or service effects."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import types
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=load('arena-native-derived-projector-v1.py')
i=load('arena-native-derived-support-install-v1.py')
manifest=json.loads((HERE/m.MANIFEST.name).read_bytes())


def public(path,expected=None,maximum=4000000):
    path=Path(path)
    if path==m.TARGET_HELPER:path=HERE.parent/'arena-public-rollback-target-20261023/admit-target.py'
    else:path=HERE/path.name
    raw=path.read_bytes()
    m.need(0<len(raw)<=maximum and(expected is None or m.sha(raw)==expected),'actual_fixture_source_bytes_required')
    return raw


class Controls(unittest.TestCase):
    def test_exclusive_public_and_private_directory_modes_survive_restrictive_umask(self):
        with tempfile.TemporaryDirectory(prefix='arena-derived-mode-')as directory:
            previous=os.umask(0o077)
            try:
                for name,mode in [('public',0o755),('private',0o700)]:
                    path=Path(directory)/name;m.new_directory(path,mode)
                    self.assertEqual(path.stat().st_mode&0o777,mode)
                    with self.assertRaises(FileExistsError):m.new_directory(path,mode)
            finally:os.umask(previous)

    def test_actual_public_source_pins_and_compiled_manifest(self):
        for name,digest in m.PROGRAMS.items():self.assertEqual(m.sha(public(HERE/name)),digest)
        self.assertEqual(m.sha(public(m.TARGET_HELPER)),m.TARGET_HELPER_SHA)
        self.assertEqual(m.sha(public(HERE/'arena-native-derived-support-build-v1.mjs')),m.BUILD_SHA)
        self.assertEqual(m.sha(public(HERE/'arena-native-derived-projector-v1.mjs')),m.PROJECTOR_SHA)
        self.assertEqual(m.sha(public(m.MANIFEST)),i.MANIFEST_SHA)
        self.assertEqual(manifest['artifactDigest'],i.ARTIFACT)
        self.assertEqual(len(manifest['files']),3);self.assertEqual(len(manifest['inputs']),49)
        for name,digest in m.SOURCE_PINS.items():self.assertEqual(m.sha(public(HERE/name)),digest)
        self.assertFalse(any('business-inverse'in name or 'source-prefix'in name for name in m.SOURCE_PINS))

    def test_actual_support_manifest_and_finite_layout_contract(self):
        with patch.object(m,'protected',side_effect=public):value,files,target=m.support_manifest(i.MANIFEST_SHA)
        self.assertEqual(value,manifest);self.assertEqual(target,i.TARGET)
        self.assertEqual(files['dist/arena-native-derived-projector-v1.mjs']['sha256'],m.PROJECTOR_SHA)
        for change in [lambda v:v.update(officialReducerBodyChanged=True),lambda v:v.update(historicalDepth3ScannerSuccessClaimed=True),
                       lambda v:v['files'][0].update(path='../private'),lambda v:v.update(sourceOrigin='RPC-getLogs')]:
            changed=copy.deepcopy(manifest);change(changed)
            with patch.object(m,'document',return_value=changed),self.assertRaises(RuntimeError):m.support_manifest('a'*64)

    def test_installer_preserves_genuine_exclusive_installation_and_layout_bodies(self):
        with patch.object(i,'public',side_effect=public):
            value=i.implementation()
            self.assertEqual(value.manifest()[1],manifest)
        original=load(i.FROZEN.name)
        self.assertEqual(value.TARGET,i.TARGET);self.assertEqual(value.INPUT,i.INPUT);self.assertEqual(value.BASE,i.BASE)
        for name in ['review','install','installed','layout','exclusive','protected']:
            self.assertEqual((getattr(value,name).__code__.co_code,getattr(value,name).__code__.co_consts),
                             (getattr(original,name).__code__.co_code,getattr(original,name).__code__.co_consts),name)
        self.assertIn(3,value.main.__code__.co_consts);self.assertNotIn(16,value.main.__code__.co_consts)

    def test_stable_binding_uses_actual_target_source_actor_and_support(self):
        owner=object.__new__(m.Owner);owner.input_sha='a'*64;owner.support={'artifactDigest':i.ARTIFACT,'manifestSha256':i.MANIFEST_SHA,'facadeSha256':'b'*64}
        owner.config={'targetAdmissionSha256':'c'*64,'targetAuthSha256':'d'*64,'sourceAuthSha256':'e'*64,
                      'maximumBlocks':100,'maximumEvents':10,'pollMilliseconds':1000}
        owner.source_auth={'sourceRole':{'name':'arena_native_reader','oid':123}}
        owner.provision={'database':{'name':'fixture','oid':456},'tables':{'chain_event':1,'credit':2,'deployment':3,'tournament':4}}
        owner.native={'releaseId':'fixture-known-source'}
        actor={'pid':123,'startTicks':456,'invocation':'f'*32}
        data={'nativeTableIdentities':[{'fixture':n}for n in range(44)],'syncCacheIdentity':{'fixture':True},'registeredDataSha256':'1'*64}
        with patch.object(owner,'public_config',return_value={'fixtureOnly':True}),patch.object(owner,'pool_identity',return_value={'fixtureOnly':True}), \
             patch.object(owner,'socket_identity',return_value={'inode':'fixture'}):value=owner.binding(actor,{'nativeData':data})
        self.assertEqual(value['actor'],actor);self.assertEqual(value['target'],owner.provision)
        self.assertEqual(value['sourceRole'],owner.source_auth['sourceRole']);self.assertEqual(value['nativeRelease'],owner.native)
        self.assertEqual(value['targetAdmissionSha256'],owner.config['targetAdmissionSha256'])
        self.assertFalse(value['historicalDepth3ScannerSuccessClaimed'])
        self.assertNotIn('completeThrough',value)

    def test_public_config_preserves_actual_nested_receipt_and_explicit_catalog_adapter(self):
        owner=object.__new__(m.Owner);owner.config={'maximumBlocks':100,'maximumEvents':10,'pollMilliseconds':1000}
        owner.native={'fixture':True};owner.source_auth={'sourceRole':{'name':'arena_native_reader','oid':123}}
        owner.provision={'database':{'name':'fixture','oid':456},'tables':{'fixture':True},'writerRole':{'name':'writer','oid':12},'readerRole':{'name':'reader','oid':13}}
        with patch.object(owner,'existing_credentials',return_value=({m.NATIVE_ENV:'a'*64,m.WRITER_ENV:'b'*64,m.READER_ENV:'c'*64},{})), \
             patch.object(owner,'pool_identity',return_value={'fixtureOnly':True}):
            value=owner.public_config()
        self.assertEqual(value['provision']['databaseOid'],456)
        self.assertEqual(value['provision']['database'],owner.provision['database'])
        self.assertNotIn('sourceUrl',value);self.assertNotIn('targetUrl',value)

    def test_owned_service_has_no_restart_RPC_or_extra_credentials(self):
        owner=object.__new__(m.Owner);owner.target=i.TARGET;text=owner.definition().decode()
        self.assertIn('DynamicUser=yes',text);self.assertIn('Restart=no',text);self.assertIn('NoNewPrivileges=yes',text)
        self.assertIn('IPAddressAllow=localhost',text);self.assertEqual(text.count('LoadCredential='),3)
        self.assertNotIn('RPC',text);self.assertNotIn('19222',text)
        self.assertIn(str(i.TARGET/'dist/arena-native-derived-projector-v1.mjs'),text)
        self.assertIn(m.SOCKET_UNIT,text)
        self.assertIn('SocketMode=0600',owner.socket_definition().decode())
        self.assertIn('StartLimitIntervalSec=infinity',text);self.assertIn('StartLimitBurst=1',text)

    def test_capacity_is_full_capped_population_budget_not_fictitious_connection_ownership(self):
        native={'name':'native','oid':1};reader={'name':'reader','oid':2};writer={'name':'writer','oid':3}
        value={'readOnly':True,'isolation':'repeatable read','maximum':100,'reserved':3,'used':20,
            'roles':[{'name':'native','oid':1,'limit':32,'used':8},{'name':'reader','oid':2,'limit':32,'used':3},
                     {'name':'writer','oid':3,'limit':2,'used':1}]}
        result=m.capacity_checked(value,native,reader,writer)
        self.assertEqual(result['requiredGlobalSlots'],67)
        self.assertFalse(result['liveConnectionOwnershipQualified']);self.assertFalse(result['originalNativeCapacityPredicatePassed'])
        for change in [lambda v:v.update(maximum=60),lambda v:v['roles'][2].update(limit=4),lambda v:v['roles'][0].update(used=33),
                       lambda v:v.update(readOnly=False)]:
            row=copy.deepcopy(value);change(row)
            with self.assertRaises(RuntimeError):m.capacity_checked(row,native,reader,writer)

    def test_root_connector_authenticates_actual_ack_and_never_enters_current_validation(self):
        owner=object.__new__(m.Owner);owner.support={'artifactDigest':i.ARTIFACT,'manifestSha256':i.MANIFEST_SHA,'facadeSha256':'a'*64}
        owner.source_auth={'sourceRole':{'name':'arena_native_reader','oid':123}};owner.native={'fixtureNative':True};owner.provision={'fixtureTarget':True}
        owner.actor=lambda:{'fixtureActor':True};owner.socket_identity=lambda:{'fixtureSocket':True};owner.pool_identity=lambda actor=None:{'fixtureIdentity':True}
        owner.public_config=lambda:{'fixtureConfig':True};owner.connect_pool=lambda kind:types.SimpleNamespace(fileno=lambda:123)
        owner.current_catalogs=lambda:(_ for _ in ()).throw(AssertionError('recursive current'))
        owner.inspect=lambda:(_ for _ in ()).throw(AssertionError('recursive snapshot'))
        binding={'actor':owner.actor(),'readPoolSocket':owner.socket_identity(),'readPoolIdentity':owner.pool_identity(),
            'publicConfigSha256':m.sha(m.encoded(owner.public_config())),'inputSha256':'b'*64,'support':owner.support,
            'sourceRole':owner.source_auth['sourceRole'],'nativeRelease':owner.native,'target':owner.provision}
        value={'format':m.FORMAT,'operatorSha256':m.sha(public(m.FILE)),'inputSha256':'b'*64,'support':owner.support,'ready':True,
            'binding':binding,'bindingSha256':m.sha(m.encoded(binding))}
        with patch.object(m,'Owner',return_value=owner),patch.object(m,'protected',side_effect=public),patch.object(m,'document',return_value=value):
            result=m.open_read_pool('c'*64,'b'*64,i.MANIFEST_SHA,'target')
            self.assertEqual(set(result),{'socket','identity','bindingSha256'})
            self.assertEqual(result['identity'],owner.pool_identity())
            binding['actor']={'foreign':True}
            with self.assertRaises(RuntimeError):m.open_read_pool('c'*64,'b'*64,i.MANIFEST_SHA,'target')

    def test_runtime_epoch_is_added_from_actual_captured_actor_not_static_config(self):
        owner=object.__new__(m.Owner);owner.input_sha='a'*64;owner.support={'fixtureSupport':True};owner.native={'fixtureNative':True}
        owner.source_auth={'sourceRole':{'name':'arena_native_reader','oid':123}}
        owner.provision={'readerRole':{'name':'reader','oid':124},'database':{'oid':456}}
        owner.config={'targetAdmissionSha256':'b'*64,'targetAuthSha256':'c'*64}
        actor={'pid':123,'startTicks':456,'invocation':'a'*32,'bootId':'11111111-1111-1111-1111-111111111111'}
        with patch.object(m,'protected',side_effect=public):
            static=owner.pool_identity();dynamic=owner.pool_identity(actor)
        self.assertEqual(len(static),17);self.assertEqual(len(dynamic),18)
        self.assertNotIn('runtimeEpoch',static);self.assertEqual(dynamic['runtimeEpoch'],actor)

    def test_default_CLIs_are_inert_without_OPS_or_private_inputs(self):
        for name in [m.FILE.name,i.FILE.name]:
            result=subprocess.run(['python3','-I','-B',str(HERE/name)],capture_output=True,check=True)
            value=json.loads(result.stdout);self.assertEqual(value['serviceActions'],0);self.assertEqual(value['databaseWrites'],0)
            self.assertEqual(value['providerCalls'],0)


if __name__=='__main__':unittest.main()
