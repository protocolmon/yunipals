"""Published full composition controls applied to new actual source identities."""
import ast
import hashlib
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SOURCE=HERE/'ypal-ordinary-publication-accept-v1.test.py'
SOURCE_SHA='f61623c7abe6bde02c495f49a93b374f52db14e5f30f54ca016d173d7e3894ca'
raw=SOURCE.read_bytes()
if hashlib.sha256(raw).hexdigest()!=SOURCE_SHA:raise RuntimeError('actual_published_full_composition_test_template_required')
names={'ypal-ordinary-generation-accept-binding-v1.py':'ypal-ordinary-generation-accept-binding-v2.py',
       'ypal-ordinary-read-cache-accept-v1.py':'ypal-ordinary-read-cache-accept-v2.py',
       'ypal-ordinary-reader-accept-v1.py':'ypal-ordinary-reader-accept-v2.py',
       'ypal-ordinary-publication-accept-v1.py':'ypal-ordinary-publication-accept-v2.py',
       'ypal-ordinary-publication-accept-manifest-v1.py':'ypal-ordinary-publication-accept-manifest-v2.py',
       'ypal-ordinary-publication-input-render-accept-v1.py':'ypal-ordinary-publication-input-render-accept-v2.py'}
tree=ast.parse(raw);counts=dict.fromkeys(names,0)
for node in ast.walk(tree):
    if isinstance(node,ast.Constant)and type(node.value)is str and node.value in names:counts[node.value]+=1;node.value=names[node.value]
if sorted(counts.values())!=[1,1,1,1,1,2]:raise RuntimeError('exact_actual_source_identity_test_seams_required')
tree.body=[node for node in tree.body if not isinstance(node,ast.If)]
value=types.ModuleType('actual_SQL_acceptance_full_controls');value.__file__=str(SOURCE)
exec(compile(ast.fix_missing_locations(tree),str(SOURCE),'exec'),value.__dict__)
value.h.template=lambda:(HERE/value.h.TEMPLATE.name).read_bytes()
original_load=value.load
def actual_load(name):
    module=original_load(name)
    if name=='ypal-ordinary-publication-input-render-accept-v2.py':
        original=module.composition
        def composition():
            result=original()
            while 'Renderer' not in result.__dict__:result=result.composition()
            return result
        module.composition=composition
    return module
value.load=actual_load
def provider(self):
    h,p,old=value.h,value.p,value.old
    binding=self.binding();c=old.old_cache.c;original=c.module
    read=old.old_cache.readtest.namespace();read.protected=self.public
    delta=original_load('ypal-ordinary-read-admission-v5b.py');delta.namespace=lambda:read
    metadata=old.old_cache.metatest.namespace();selector=original_load('ypal-generation-cache-candidates-v1.py')
    config={**old.old_cache.config,'generationBindingSha256':self.binding_sha}
    real=p.composition
    def instrument(module):
        if 'composed'in module.__dict__:
            current=module.composed
            def composed(binding):
                result=current(binding);result.common=lambda:c;return result
            module.composed=composed
        elif 'composition'in module.__dict__:
            current=module.composition;module.composition=lambda:instrument(current())
        return module
    def module(path,digest):
        self.public(path,digest);name=Path(path).name
        if name=='ypal-ordinary-read-admission-v5b.py':return delta
        if name=='ypal-ordinary-metadata-handover-v5.py':return types.SimpleNamespace(namespace=lambda _:metadata)
        if name==h.OWNER_FILE:return binding.owner
        if name=='ypal-ordinary-generation-candidates-v5.py':return types.SimpleNamespace(namespace=lambda _:selector)
        return original(path,digest)
    with patch.object(p,'composition',side_effect=lambda:instrument(real())),patch.object(c,'public',side_effect=self.public), \
         patch.object(c,'load_input',return_value=old.old_cache.execution),patch.object(c,'module',side_effect=module), \
         patch.object(c,'intake',return_value=types.SimpleNamespace(protected=self.public)):
        result=p.namespace(config)
    return result,config
value.Controls.provider=provider
candidate=value.Controls.candidate
def actual_candidate(self,config):
    result=candidate(self,config);result.update(previousSqlAcceptanceProducerSha256=value.h.PREVIOUS_SQL_ACCEPTOR_SHA,previousSqlAcceptanceCLIPassed=False)
    return result
value.Controls.candidate=actual_candidate
setup=value.RendererControls.setUp
def actual_setup(self):
    setup(self);self.candidate.update(previousSqlAcceptanceProducerSha256=value.h.PREVIOUS_SQL_ACCEPTOR_SHA,previousSqlAcceptanceCLIPassed=False);self.accept()
value.RendererControls.setUp=actual_setup
Controls=value.Controls
RendererControls=value.RendererControls


class SQLSuccessorControls(unittest.TestCase):
    def test_new_SQL_acceptor_failure_marker_is_mandatory(self):
        control=Controls();control.setUp()
        try:
            _,config=control.provider();binding=control.binding();row=control.candidate(config)
            binding.candidate(row,config)
            row['previousSqlAcceptanceCLIPassed']=True
            with self.assertRaises(RuntimeError):binding.candidate(row,config)
            row['previousSqlAcceptanceCLIPassed']=False;row['previousSqlAcceptanceProducerSha256']=value.h.BUILD_OWNER_SHA
            with self.assertRaises(RuntimeError):binding.candidate(row,config)
        finally:control.doCleanups()


if __name__=='__main__':unittest.main()
