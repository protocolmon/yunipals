"""Real CONT4 derivations and retained integration controls; ACKs are fixtures."""
import ast
import hashlib
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def source(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def public(path,expected=None,maximum=4000000):
    name=Path(path).name;path=HERE/name
    if not path.exists()and name=='ypal-old-runtime-inventory-v1.py':path=HERE.parent/'booster-launch'/name
    if not path.exists()and name=='final-supervisor-inventory-v1.py':path=HERE.parent/'solana-acceptance'/name
    raw=path.read_bytes()
    if not 0<len(raw)<=maximum or expected is not None and hashlib.sha256(raw).hexdigest()!=expected:
        raise RuntimeError('actual_local_CONT4_source_bytes_required')
    return raw


names=['ypal-ordinary-metadata-current-epoch-v3.py','ypal-ordinary-cache-continuation-authority-v4.py',
    'ypal-ordinary-read-cache-continue-v4.py','ypal-ordinary-reader-continue-v4.py','ypal-ordinary-publication-continue-v4.py',
    'ypal-ordinary-publication-continue-inputs-v4.py']
wrappers={};actual={}
for name in names:
    wrapper=source(name);wrappers[name]=wrapper
    with patch.object(wrapper,'public',side_effect=public):compiler=wrapper.factory()
    native_namespace=compiler.namespace
    def namespace(*args,_native=native_namespace,**kwargs):
        value=_native(*args,**kwargs);value.public=public;return value
    with patch.object(wrapper,'public',side_effect=public),patch.object(wrapper,'factory',return_value=compiler),patch.object(compiler,'namespace',side_effect=namespace):
        actual[name]=wrapper.composition()


def load(name):return actual[name]if name in actual else source(name)


# Retain and execute the reviewed whole integration controls. The only test
# changes are loader injection and their expected new source/feature identities.
raw=(HERE/'ypal-ordinary-publication-continue-v2.test.py').read_bytes()
if hashlib.sha256(raw).hexdigest()!='2d8008a1dabbf84c129824ddd893689d6d7a6d39a7fa3aca09acc4cf70236eb4':
    raise RuntimeError('exact_frozen_CONT2_integration_controls_required')
tree=ast.parse(raw);body=[]
for node in tree.body:
    if isinstance(node,ast.FunctionDef)and node.name=='load':continue
    if isinstance(node,ast.If)and ast.unparse(node.test)=="__name__ == '__main__'":continue
    for item in ast.walk(node):
        if isinstance(item,ast.Constant)and type(item.value)is str:
            item.value=item.value.replace('continue-v2','continue-v4').replace('continue-inputs-v2','continue-inputs-v4').replace('continue-manifest-v2','continue-manifest-v4').replace('authority-v2','authority-v4').replace('metadata-current-epoch-v1','metadata-current-epoch-v3')
    body.append(node)
scope={'load':load,'__file__':str(HERE/'ypal-ordinary-publication-continue-v4.test.py'),'__name__':'retained_CONT4_controls'}
exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),scope['__file__'],'exec'),scope)
Controls=scope['Controls'];PureControls=scope['PureControls']


class SuccessorControls(unittest.TestCase):
    def test_every_thin_wrapper_authenticates_real_frozen_continuation3_bytes(self):
        for name,wrapper in wrappers.items():
            self.assertEqual(hashlib.sha256(public(wrapper.FROZEN)).hexdigest(),wrapper.FROZEN_SHA,name)
            self.assertNotEqual(wrapper.FILE,wrapper.FROZEN,name)
            self.assertIs(wrapper.composition(),actual[name],name)
        self.assertEqual(actual[names[0]].OWNER,'ypal-native-metadata-approval-epoch-v3.py')

    def test_new_static_input_function_and_actual_catalog_API_remain_available(self):
        renderer=actual['ypal-ordinary-publication-continue-inputs-v4.py']
        previous=source('ypal-ordinary-publication-continue-inputs-v2.py')
        self.assertEqual(renderer.reader_inputs.__code__.co_code,previous.reader_inputs.__code__.co_code)
        reader=actual['ypal-ordinary-reader-continue-v4.py']
        self.assertEqual(reader.lifecycle_inverse_catalog.__code__.co_code,source('ypal-ordinary-reader-continue-v2.py').lifecycle_inverse_catalog.__code__.co_code)
        self.assertNotEqual(renderer.EPOCH_SHA,previous.EPOCH_SHA)


def test_real_Session_preflight_retries_only_metadata_capture_not_source_parent(self):
    real=self.h.derive
    def derive(*args,**kwargs):
        value=real(*args,**kwargs)
        if args[1]==scope['prior'].a.KERNEL_SHA:value.helper=lambda:self.h
        return value
    caller_module=actual['ypal-ordinary-publication-continue-v4.py']
    with patch.object(self.h,'derive',side_effect=derive):caller=caller_module.composed(self.manifest_sha,self.refs)
    observation={**scope['copy'].deepcopy(self.ack),'currentActorQualified':True,'immutableAcknowledgementOnly':False}
    self.actual_owner.actor_current.side_effect=[RuntimeError(wrappers[names[0]].RETRY_CODE),
        RuntimeError(wrappers[names[0]].RETRY_CODE),observation,scope['copy'].deepcopy(observation)]
    session=object.__new__(caller.Session)
    with patch.object(caller.Session.__bases__[0],'preflight',return_value={'sourceFullProof':'fixture'})as source_parent:
        value=session.preflight()
    source_parent.assert_called_once();self.assertEqual(self.actual_owner.actor_current.call_count,4)
    self.assertEqual(value['metadataEpoch']['refs'],self.refs)
    self.assertEqual(value['sourceFullProof'],'fixture')

Controls.test_real_Session_preflight_retries_only_metadata_capture_not_source_parent=test_real_Session_preflight_retries_only_metadata_capture_not_source_parent


if __name__=='__main__':unittest.main()
