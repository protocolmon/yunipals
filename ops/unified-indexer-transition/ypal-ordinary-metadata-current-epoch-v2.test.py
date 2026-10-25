"""Actual derived helper; immutable lifecycle/Host I/O remain explicit fixtures."""
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


wrapper=load('ypal-ordinary-metadata-current-epoch-v2.py')
prior=load('ypal-ordinary-metadata-current-epoch-v1.test.py')


def public(path,expected=None,maximum=4000000):
    raw=(HERE/Path(path).name).read_bytes()
    if not 0<len(raw)<=maximum or expected is not None and wrapper.hashlib.sha256(raw).hexdigest()!=expected:
        raise RuntimeError('actual_local_metadata_epoch_successor_bytes_required')
    return raw


with patch.object(wrapper,'public',side_effect=public):actual=wrapper.composition()
prior.m=actual


class Controls(prior.Controls):
    def test_real_thin_helper_preserves_all_authority_and_metadata_bodies(self):
        original=load(wrapper.FROZEN.name)
        for name,value in vars(original.Epoch).items():
            if isinstance(value,types.FunctionType):
                observed=getattr(actual.Epoch,name)
                self.assertEqual(observed.__code__.co_code,value.__code__.co_code,name)
                self.assertEqual(observed.__code__.co_consts,value.__code__.co_consts,name)
        self.assertEqual(actual.OWNER,'ypal-native-metadata-approval-epoch-v3.py')
        self.assertEqual(actual.OWNER_FORMAT,'yunipals-native-metadata-approval-epoch-v3')
        self.assertNotEqual(actual.FILE,original.FILE)
        self.assertEqual(actual.SELECTED_SHA,original.SELECTED_SHA)
        self.assertEqual(actual.PREDECESSOR_WORKER_SHA,original.PREDECESSOR_WORKER_SHA)
        with patch.object(actual,'utility',return_value=self.utility):utility=actual.consumer_utility()
        self.assertEqual(utility.AUTHORITY,'ypal-ordinary-cache-continuation-authority-v3.py')


if __name__=='__main__':unittest.main()
