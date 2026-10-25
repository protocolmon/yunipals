"""Real helper composition and retained predicates; lifecycle I/O is a fixture."""
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

wrapper=load('ypal-ordinary-metadata-current-epoch-v3.py')
prior=load('ypal-ordinary-metadata-current-epoch-v1.test.py')

def public(path,expected=None,maximum=4000000):
    raw=(HERE/Path(path).name).read_bytes()
    if not 0<len(raw)<=maximum or expected is not None and wrapper.hashlib.sha256(raw).hexdigest()!=expected:
        raise RuntimeError('actual_local_metadata_epoch3_source_required')
    return raw

with patch.object(wrapper,'public',side_effect=public):compiler=wrapper.factory()
original_namespace=compiler.namespace
def local_namespace(*args,**kwargs):
    value=original_namespace(*args,**kwargs)
    # Explicit fixture relocation of the inner wrapper's protected source I/O.
    value.public=public;return value
with patch.object(wrapper,'public',side_effect=public),patch.object(wrapper,'factory',return_value=compiler),patch.object(compiler,'namespace',side_effect=local_namespace):
    actual=wrapper.composition()
prior.m=actual

class Controls(prior.Controls):
    def test_all_retained_Epoch_methods_and_original_current_remain_exact(self):
        original=load('ypal-ordinary-metadata-current-epoch-v1.py')
        for name,value in vars(original.Epoch).items():
            if isinstance(value,types.FunctionType)and name!='current':
                observed=getattr(actual.Epoch,name)
                self.assertEqual(observed.__code__.co_code,value.__code__.co_code,name)
                self.assertEqual(observed.__code__.co_consts,value.__code__.co_consts,name)
        self.assertEqual(actual.Epoch.__bases__[0].current.__code__.co_code,original.Epoch.current.__code__.co_code)
        self.assertEqual(actual.Epoch.__bases__[0].current.__code__.co_consts,original.Epoch.current.__code__.co_consts)
        self.assertEqual(actual.OWNER,'ypal-native-metadata-approval-epoch-v3.py')
        self.assertEqual(actual.SELECTED_SHA,original.SELECTED_SHA)
        with patch.object(actual,'utility',return_value=self.utility):utility=actual.consumer_utility()
        self.assertEqual(utility.AUTHORITY,'ypal-ordinary-cache-continuation-authority-v4.py')
        self.assertIs(wrapper.composition(),actual)

    def capture(self,epoch):
        self.enterContext(patch.object(wrapper.time,'sleep',return_value=None))
        return epoch.current()

    def test_two_churn_observations_require_three_fresh_complete_owner_calls(self):
        epoch=self.epoch();value=copy.deepcopy(self.current)
        self.owner.actor_current.side_effect=[RuntimeError(wrapper.RETRY_CODE),RuntimeError(wrapper.RETRY_CODE),value]
        self.assertIs(self.capture(epoch),value)
        self.assertEqual(self.owner.actor_current.call_count,3)
        self.assertEqual(self.owner.acknowledgement.call_count,3)
        self.assertEqual([row['discarded']for row in epoch.current_capture_attempts],[True,True,False])
        self.assertTrue(all(row['effectsRetried']is False and row['partialObservationReused']is False for row in epoch.current_capture_attempts))
        self.owner.actor_current.side_effect=lambda *_:copy.deepcopy(self.current)
        epoch.current();self.assertEqual(len(epoch.current_capture_history),2)

    def test_three_churns_preserve_original_exception_and_all_attempts(self):
        epoch=self.epoch();errors=[RuntimeError(wrapper.RETRY_CODE)for _ in range(3)]
        self.owner.actor_current.side_effect=errors
        with self.assertRaises(RuntimeError)as seen:self.capture(epoch)
        self.assertIs(seen.exception,errors[-1]);self.assertEqual(self.owner.actor_current.call_count,3)
        self.assertEqual(len(seen.exception.metadata_current_capture_attempts),3)
        self.assertTrue(all(row['discarded']for row in epoch.current_capture_attempts))

    def test_only_exact_builtin_RuntimeError_with_exact_code_is_retryable(self):
        class Child(RuntimeError):pass
        for error in[RuntimeError(wrapper.RETRY_CODE+' '),Child(wrapper.RETRY_CODE),PermissionError('denied'),FileNotFoundError('gone'),RuntimeError('bounded_readonly_inventory_command_required')]:
            epoch=self.epoch();self.owner.actor_current.reset_mock();self.owner.actor_current.side_effect=error
            with self.assertRaises(type(error))as seen:self.capture(epoch)
            self.assertIs(seen.exception,error);self.assertEqual(self.owner.actor_current.call_count,1)
            self.assertFalse(epoch.current_capture_attempts[0]['classifiedMetadataBackendChurn'])

    def test_immutable_ACK_change_after_churn_is_not_retried(self):
        epoch=self.epoch()
        def churn(*_):self.ack['actor']['main']['startTicks']+=1;raise RuntimeError(wrapper.RETRY_CODE)
        self.owner.actor_current.side_effect=churn
        with self.assertRaisesRegex(RuntimeError,'actual_immutable_ACK_changed'):self.capture(epoch)
        self.assertEqual(self.owner.actor_current.call_count,1)
        self.assertEqual(len(epoch.current_capture_attempts),1)

    def test_actor_boot_program_drift_after_churn_remains_a_strict_failure(self):
        for key,value in[('actor',self.historical),('boot',{'foreignBoot':True}),('workerSha256','0'*64)]:
            epoch=self.epoch();foreign=copy.deepcopy(self.current);foreign[key]=value
            self.owner.actor_current.reset_mock();self.owner.actor_current.side_effect=[RuntimeError(wrapper.RETRY_CODE),foreign]
            with self.assertRaises(RuntimeError):self.capture(epoch)
            self.assertEqual(self.owner.actor_current.call_count,2)
            self.assertEqual(len(epoch.current_capture_attempts),2)
            self.assertFalse(epoch.current_capture_attempts[-1]['classifiedMetadataBackendChurn'])

    def test_total_window_rejects_nominal_success_at_ninety_seconds(self):
        epoch=self.epoch();clock=[100]
        def late(*_):clock[0]+=wrapper.CAPTURE_WINDOW_NS;return copy.deepcopy(self.current)
        self.owner.actor_current.side_effect=late
        with patch.object(wrapper.time,'monotonic_ns',side_effect=lambda:clock[0]):
            with self.assertRaisesRegex(RuntimeError,'capture_window_expired')as seen:self.capture(epoch)
        self.assertEqual(self.owner.actor_current.call_count,1)
        self.assertTrue(seen.exception.metadata_current_capture_attempts[-1]['discarded'])

    def test_churn_cannot_reset_window_or_start_another_expired_capture(self):
        epoch=self.epoch();clock=[100]
        def late(*_):clock[0]+=wrapper.CAPTURE_WINDOW_NS;raise RuntimeError(wrapper.RETRY_CODE)
        self.owner.actor_current.side_effect=late
        with patch.object(wrapper.time,'monotonic_ns',side_effect=lambda:clock[0]):
            with self.assertRaisesRegex(RuntimeError,'capture_window_expired'):self.capture(epoch)
        self.assertEqual(self.owner.actor_current.call_count,1)

    def test_restored_current_uses_only_fresh_restored_owner_capture(self):
        self.restored();epoch=self.epoch(True)
        self.owner.restored_actor_current.side_effect=[RuntimeError(wrapper.RETRY_CODE),copy.deepcopy(self.current)]
        self.capture(epoch);self.owner.actor_current.assert_not_called()
        self.assertEqual(self.owner.restored_actor_current.call_count,2)
        self.assertEqual(self.owner.inverse_acknowledgement.call_count,2)

    def test_genuine_prepared_callback_also_uses_central_capture_boundary(self):
        self.legacy_host();n=actual.namespace(self.ack['metadataInputSha256'],self.refs,self.manifest)
        self.owner.actor_current.side_effect=[RuntimeError(wrapper.RETRY_CODE),copy.deepcopy(self.current),copy.deepcopy(self.current)]
        with patch.object(wrapper.time,'sleep',return_value=None):result=n.metadata(self.phase,self.candidate,self.selection,lambda:None)
        self.assertEqual(self.owner.actor_current.call_count,3)
        self.assertTrue(result['currentNativeMetadataQualified'])
        epoch=n.metadata.__globals__['_epoch']
        self.assertEqual(len(epoch.current_capture_history),2)
        self.assertEqual([len(row['attempts'])for row in epoch.current_capture_history],[2,1])

if __name__=='__main__':unittest.main()
