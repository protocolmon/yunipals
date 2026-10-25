"""Real CONT3 derivations and retained integration controls; ACKs are fixtures."""
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
        raise RuntimeError('actual_local_CONT3_source_bytes_required')
    return raw


names=['ypal-ordinary-metadata-current-epoch-v2.py','ypal-ordinary-cache-continuation-authority-v3.py',
    'ypal-ordinary-read-cache-continue-v3.py','ypal-ordinary-reader-continue-v3.py','ypal-ordinary-publication-continue-v3.py',
    'ypal-ordinary-publication-continue-inputs-v3.py']
wrappers={};actual={}
for name in names:
    wrapper=source(name);wrappers[name]=wrapper
    with patch.object(wrapper,'public',side_effect=public):actual[name]=wrapper.composition()


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
            item.value=item.value.replace('continue-v2','continue-v3').replace('continue-inputs-v2','continue-inputs-v3').replace('continue-manifest-v2','continue-manifest-v3').replace('authority-v2','authority-v3').replace('metadata-current-epoch-v1','metadata-current-epoch-v2')
    body.append(node)
scope={'load':load,'__file__':str(HERE/'ypal-ordinary-publication-continue-v3.test.py'),'__name__':'retained_CONT3_controls'}
exec(compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),scope['__file__'],'exec'),scope)
Controls=scope['Controls'];PureControls=scope['PureControls']


class SuccessorControls(unittest.TestCase):
    def test_every_thin_wrapper_authenticates_real_frozen_continuation2_bytes(self):
        for name,wrapper in wrappers.items():
            self.assertEqual(hashlib.sha256(public(wrapper.FROZEN)).hexdigest(),wrapper.FROZEN_SHA,name)
            self.assertNotEqual(wrapper.FILE,wrapper.FROZEN,name)
            self.assertIs(wrapper.composition(),actual[name],name)
        self.assertEqual(actual[names[0]].OWNER,'ypal-native-metadata-approval-epoch-v3.py')

    def test_new_static_input_function_and_actual_catalog_API_remain_available(self):
        renderer=actual['ypal-ordinary-publication-continue-inputs-v3.py']
        previous=source('ypal-ordinary-publication-continue-inputs-v2.py')
        self.assertEqual(renderer.reader_inputs.__code__.co_code,previous.reader_inputs.__code__.co_code)
        reader=actual['ypal-ordinary-reader-continue-v3.py']
        self.assertEqual(reader.lifecycle_inverse_catalog.__code__.co_code,source('ypal-ordinary-reader-continue-v2.py').lifecycle_inverse_catalog.__code__.co_code)
        self.assertNotEqual(renderer.EPOCH_SHA,previous.EPOCH_SHA)


if __name__=='__main__':unittest.main()
