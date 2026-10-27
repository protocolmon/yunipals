"""Expose the actual Reader5 cache-finish review path; no runtime actions."""
import importlib.util,types,unittest
from pathlib import Path
from unittest.mock import Mock

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('actual_cont5_fixture',HERE/'ypal-ordinary-publication-continue-v5.test.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Controls(unittest.TestCase):
 def test_genuine_current_reader5_finish_review_requests_absent_new_stop_receipt(self):
  fixture=m.Controls();fixture.setUp();self.addCleanup(fixture.doCleanups)
  reader=m.actual['ypal-ordinary-reader-continue-v5.py'];proof=reader.Proof(fixture.manifest_sha)
  root=reader.assemble(fixture.public(reader.TEMPLATE,reader.TEMPLATE_SHA),proof);root.public_input=fixture.public
  frame=types.SimpleNamespace(proof=proof,inputs={'sourceManifestSha256':fixture.manifest_sha})
  finish=proof.cache_finish_module(root,frame)
  self.assertEqual(finish.FORMAT,'yunipals-ypal-ordinary-cache-finish-continue-v5')
  self.assertEqual(finish.review.__code__.co_code,m.source('ypal-cache-finish-v2.py').review.__code__.co_code)
  cache=m.actual['ypal-ordinary-read-cache-continue-v5.py']
  expected=cache.BASE/'stopped.json'
  c=types.SimpleNamespace(inputs={'sourceManifestSha256':fixture.manifest_sha,'cachePreparedSha256':'a'*64},
   cache=types.SimpleNamespace(BASE=cache.BASE,stopped=Mock(return_value=({}, {}, {'explicitActualPriorStopFixture':True}))),
   host=object(),scope=Mock(return_value={'explicitCurrentScopeFixture':True}),generation_terminal=Mock())
  requested=[]
  def protected(path,*args):
   requested.append(Path(path))
   if Path(path)==expected:raise FileNotFoundError(str(expected))
   return b'explicit-protected-source-or-operation-IO-fixture'
  root.public_input=protected
  scope=finish.review.__globals__;old_context,old_boot=scope['context'],scope['boot']
  scope['context']=lambda *_:(c,{}, {'generationId':'105'});scope['boot']=lambda:'explicitBootFixture'
  try:
   with self.assertRaises(FileNotFoundError)as caught:finish.review(root,proof,'b'*64)
   self.assertIn(str(expected),str(caught.exception));self.assertIn(expected,requested)
   c.cache.stopped.assert_called_once_with(c.host);c.scope.assert_called_once_with(True);c.generation_terminal.assert_called_once()
  finally:scope['context'],scope['boot']=old_context,old_boot

if __name__=='__main__':unittest.main()
