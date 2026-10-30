import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import production_rehearsal as production
import rehearsal_api as router


class ProductionRehearsalTest(unittest.TestCase):
    def client(self):
        path=Path(__file__).parents[1]/'arena/validate_api.py'
        spec=importlib.util.spec_from_file_location('test_responses_transport',path)
        value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
        return value

    def fixture(self,root):
        folder=root/'tasks/referee';folder.mkdir(parents=True)
        request={'model':'gpt-6.1-sol','reasoning':{'effort':'xhigh'},'service_tier':'default','background':True,'store':True,'max_output_tokens':32000,'instructions':'Test','input':'{"sourceInputSha256":"source"}','tools':[], 'text':{'format':{'type':'json_schema','name':'arena_outcome','strict':True,'schema':{}}}}
        router.save(folder/'request.json',request)
        router.save(folder/'task.json',{'model':'gpt-6.1-sol','reservedMicrousd':700000,'requestId':'fixed-referee','requestSha256':hashlib.sha256((folder/'request.json').read_bytes()).hexdigest()})
        router.save(root/'authorization.json',{'version':'anime-production-rehearsal/v1','maxSpendMicrousd':1500000,'expectedTasks':['referee','opus'],'providers':{'referee':'openai-responses','opus':'openrouter'},'inputSha256':'source'})
        return folder

    def completed(self):
        return {'id':'resp_test','model':'gpt-6.1-sol','status':'completed','service_tier':'default','usage':{'input_tokens':1000,'input_tokens_details':{'cached_tokens':200,'cache_write_tokens':300},'output_tokens':100,'output_tokens_details':{'reasoning_tokens':60},'total_tokens':1100},'output':[]}

    def test_same_background_response_is_polled_and_never_replaced(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root);client=self.client();calls=[]
            def api(url,key,body=None,request_id=None):
                calls.append(('POST' if body is not None else 'GET',url))
                return {'id':'resp_test','status':'queued'} if body is not None else self.completed()
            with patch.object(client,'api',side_effect=api):
                self.assertEqual(production.referee_step(root,'not-a-live-key',client)['state'],'queued')
                receipt=production.referee_step(root,'not-a-live-key',client)
                self.assertEqual(receipt['usageBasedCostUsd'],.00277)
                self.assertIsNone(receipt['actualCostUsd'])
                self.assertFalse(receipt['billingReconciled'])
                self.assertEqual(receipt['submissions'],1)
                production.referee_step(root,'not-a-live-key',client)
            self.assertEqual([c[0] for c in calls],['POST','GET'])
            self.assertTrue(calls[1][1].endswith('/resp_test'))

    def test_ambiguous_post_does_not_authorize_another_submission(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root);client=self.client()
            with patch.object(client,'api',side_effect=OSError('lost')) as api:
                with self.assertRaises(OSError):production.referee_step(root,'not-a-live-key',client)
                with self.assertRaisesRegex(ValueError,'replacement'):production.referee_step(root,'not-a-live-key',client)
                self.assertEqual(api.call_count,1)

    def test_rate_card_requires_complete_disjoint_cache_counts_and_default_tier(self):
        response=self.completed();self.assertEqual(production.usage_cost(response),.00277)
        for change in [lambda r:r['usage']['input_tokens_details'].pop('cache_write_tokens'),lambda r:r.update(service_tier='fast'),lambda r:r['usage']['input_tokens_details'].update(cached_tokens=1000),lambda r:r['usage'].update(total_tokens=1101)]:
            value=json.loads(json.dumps(response));change(value)
            with self.assertRaises(ValueError):production.usage_cost(value)

    def test_changed_request_and_budget_are_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);folder=self.fixture(root);client=self.client()
            with patch.object(client,'api') as api:
                request=router.read(folder/'request.json');request['service_tier']='fast';router.save(folder/'request.json',request)
                with self.assertRaisesRegex(ValueError,'checksum'):production.referee_step(root,'not-a-live-key',client)
                self.assertFalse(api.called)


if __name__=='__main__':unittest.main()
