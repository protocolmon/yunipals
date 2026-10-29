import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('rehearsal_api',Path(__file__).with_name('rehearsal_api.py'))
api=importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class Stream(io.BytesIO):
    headers={'Content-Type':'text/event-stream'}


class RehearsalTest(unittest.TestCase):
    def fixture(self,root):
        folder=root/'tasks/haiku'
        folder.mkdir(parents=True)
        request={'model':api.MODELS['haiku'][0],'stream':True,'max_tokens':4096,'provider':{'order':['Anthropic'],'allow_fallbacks':False,'require_parameters':True,'max_price':{'prompt':0.2,'completion':1}}}
        api.save(folder/'request.json',request)
        api.save(folder/'task.json',{'model':request['model'],'reservedMicrousd':20000,'requestId':'fixed','requestSha256':hashlib.sha256((folder/'request.json').read_bytes()).hexdigest()})
        api.save(root/'authorization.json',{'maxSpendMicrousd':1520000,'expectedTasks':['referee','haiku','opus']})
        return folder

    def response(self,cost=True):
        values=[{'id':'gen-test','model':api.MODELS['haiku'][0],'choices':[{'delta':{'content':'{"attacks":[],'}}]}, {'id':'gen-test','choices':[{'delta':{'content':'"cutins":[]}'},'finish_reason':'stop'}]}]
        values.append({'id':'gen-test','choices':[],'usage':{'cost':0.001,'prompt_tokens':100}} if cost else {'id':'gen-test','choices':[]})
        return Stream((''.join('data: '+json.dumps(value)+'\n\n' for value in values)+'data: [DONE]\n\n').encode())

    def test_completed_stream_is_reused_without_another_generation(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(api,'available',return_value=10):
            root=Path(temp);folder=self.fixture(root);posts=[]
            def caller(*args):posts.append(args[1]);return self.response()
            first=api.step(root,'haiku','not-a-live-key',caller)
            self.assertEqual(first['actualCostUsd'],0.001)
            self.assertEqual(first['state'],'completed')
            self.assertEqual(json.loads(api.read(folder/'response.json')['choices'][0]['message']['content']),{'attacks':[],'cutins':[]})
            self.assertEqual(api.step(root,'haiku','not-a-live-key',caller),first)
            self.assertEqual(posts,['chat/completions'])

    def test_ambiguous_submission_never_retries(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(api,'available',return_value=10):
            root=Path(temp);self.fixture(root);posts=[]
            def caller(*args):posts.append(True);raise OSError('network lost')
            with self.assertRaisesRegex(ValueError,'unconfirmed'):api.step(root,'haiku','not-a-live-key',caller)
            with self.assertRaisesRegex(ValueError,'reconciliation'):api.step(root,'haiku','not-a-live-key',caller)
            self.assertEqual(len(posts),1)

    def test_accounting_failure_recovers_saved_generation_without_post(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(api,'available',return_value=10):
            root=Path(temp);self.fixture(root);posts=[]
            def caller(*args):posts.append(True);return self.response(False)
            with patch.object(api,'get',side_effect=OSError('metadata delayed')):
                with self.assertRaises(OSError):api.step(root,'haiku','not-a-live-key',caller)
            with patch.object(api,'get',return_value={'data':{'id':'gen-test','total_cost':0.002}}):
                result=api.step(root,'haiku','not-a-live-key',caller)
            self.assertEqual(result['actualCostUsd'],0.002)
            self.assertEqual(len(posts),1)

    def test_http_error_evidence_is_private_redacted_and_never_reposted(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(api,'available',return_value=10):
            root=Path(temp);folder=self.fixture(root);posts=[]
            def caller(*args):
                posts.append(True)
                raise urllib.error.HTTPError('https://openrouter.ai/api/v1/chat/completions',400,'Bad Request',{'X-Generation-Id':'gen-rejected'},io.BytesIO(b'{"error":"invalid schema not-a-live-key"}'))
            with self.assertRaisesRegex(ValueError,'unconfirmed'):api.step(root,'haiku','not-a-live-key',caller)
            diagnostic=api.read(folder/'submission-error.json')
            self.assertEqual(diagnostic['httpStatus'],400)
            self.assertNotIn('not-a-live-key',diagnostic['body'])
            self.assertEqual(api.read(folder/'receipt.json')['generationId'],'gen-rejected')
            self.assertEqual((folder/'submission-error.json').stat().st_mode&0o777,0o600)
            with self.assertRaisesRegex(ValueError,'reconciliation'):api.step(root,'haiku','not-a-live-key',caller)
            self.assertEqual(posts,[True])

    def test_changed_request_or_missing_funding_prevents_post(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);folder=self.fixture(root)
            with patch.object(api,'available',return_value=0):
                with self.assertRaisesRegex(ValueError,'credit'):api.step(root,'haiku','not-a-live-key')
            request=api.read(folder/'request.json');request['model']='different';api.save(folder/'request.json',request)
            with self.assertRaisesRegex(ValueError,'authorized'):api.step(root,'haiku','not-a-live-key')

    def test_choreography_review_allows_only_one_bounded_opus_task(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(api,'available',return_value=10):
            root=Path(temp);old=self.fixture(root);folder=root/'tasks/opus';old.rename(folder)
            request=api.read(folder/'request.json');request.update(model=api.MODELS['opus'][0],max_tokens=16384)
            request['provider']['max_price']={'prompt':5,'completion':20}
            api.save(folder/'request.json',request)
            task=api.read(folder/'task.json');task.update(model=request['model'],reservedMicrousd=800000,requestSha256=hashlib.sha256((folder/'request.json').read_bytes()).hexdigest());api.save(folder/'task.json',task)
            api.save(root/'authorization.json',{'version':'anime-choreography-review/v1','maxSpendMicrousd':800000,'expectedTasks':['opus']})
            posts=[]
            def caller(*args):
                posts.append(True)
                return Stream(self.response().getvalue().replace(api.MODELS['haiku'][0].encode(),api.MODELS['opus'][0].encode()))
            self.assertEqual(api.step(root,'opus','not-a-live-key',caller)['state'],'completed')
            self.assertEqual(api.step(root,'opus','not-a-live-key',caller)['state'],'completed')
            self.assertEqual(posts,[True])
            api.save(root/'authorization.json',{'version':'anime-production-rehearsal/v1','maxSpendMicrousd':1500000,'expectedTasks':['referee','opus']})
            self.assertEqual(api.step(root,'opus','not-a-live-key',caller)['state'],'completed')
            self.assertEqual(posts,[True])
            auth=api.read(root/'authorization.json');auth['maxSpendMicrousd']=1600000;api.save(root/'authorization.json',auth)
            with self.assertRaisesRegex(ValueError,'authorization'):api.step(root,'opus','not-a-live-key',caller)


if __name__=='__main__':unittest.main()
