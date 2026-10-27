#!/usr/bin/env python3
"""New acceptance lineage over the real completed V2 build; no old success alias."""
import json
from pathlib import Path
import hashlib
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS/'ypal-ordinary-generation-accept-binding-v1.py'
FROZEN = OPS/'ypal-ordinary-generation-binding-v1.py'
FROZEN_SHA = 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962'
BUILD_OWNER_SHA = '4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753'
BUILD_BASE = Path('/var/backups/yunipals-ypal-ordinary-generation-attempt-v2-20261025')
FORMAT = 'yunipals-ypal-ordinary-generation-accept-binding-v1'
MANIFEST = OPS/'ypal-ordinary-generation-accept-binding-v1.manifest.json'
OWNER_FILE = 'ypal-ordinary-generation-accept-v2.py'
OWNER_FORMAT = 'yunipals-ypal-ordinary-generation-accept-v2'
CANDIDATE_FORMAT = 'yunipals-ypal-ordinary-generation-accept-candidate-v2'
ATTEMPT_BASE = '/var/backups/yunipals-ypal-ordinary-generation-accept-v2-20261025'
_implementation = None


def frozen():
    for path in [*FROZEN.parents, FROZEN]:
        row=path.lstat()
        if row.st_uid != 0 or row.st_gid != 0 or stat.S_ISLNK(row.st_mode) or row.st_mode&0o022:
            raise RuntimeError('protected_frozen_accept_binding_template_required')
    before=FROZEN.lstat();raw=FROZEN.read_bytes();after=FROZEN.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < len(raw) == before.st_size < 100000 or \
       hashlib.sha256(raw).hexdigest() != FROZEN_SHA or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_frozen_accept_binding_template_required')
    value=types.ModuleType('frozen_accept_binding_template');value.__file__=str(FROZEN)
    exec(compile(raw,str(FROZEN),'exec'),value.__dict__);return value,raw


def derived(original,raw):
        value=original.derive(raw,FROZEN_SHA,FILE,{'FORMAT':FORMAT,'MANIFEST':MANIFEST,'OWNER_FILE':OWNER_FILE,
            'OWNER_FORMAT':OWNER_FORMAT,'CANDIDATE_FORMAT':CANDIDATE_FORMAT,'ATTEMPT_BASE':ATTEMPT_BASE})
        inherited=value.Binding
        class Binding(inherited):
            def candidate(self,candidate,config):
                result=super().candidate(candidate,config)
                value.need(candidate['operationFile']==str(BUILD_BASE/'operation.json') and
                    candidate['buildOperatorSha256']==BUILD_OWNER_SHA and candidate['originalAttemptCandidateCLIPassed'] is False and
                    candidate['originalStrictTerminalInvocationGatePassed'] is False and
                    candidate['previousAcceptanceProducerSha256']=='1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d' and
                    candidate['previousAcceptanceCLIPassed'] is False,
                    'actual_V2_build_operation_and_new_acceptance_producer_not_old_CLI_success_required')
                return result
        value.Binding=Binding
        return value


def composition():
    global _implementation
    if _implementation is None:
        _implementation=derived(*frozen())
    return _implementation


def build(folder):
    """Explicit offline source build authenticates the actual frozen template."""
    raw=(Path(folder)/FROZEN.name).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=FROZEN_SHA:raise RuntimeError('actual_frozen_binding_source_before_offline_build_required')
    original=types.ModuleType('offline_accept_binding');original.__file__=str(FROZEN)
    exec(compile(raw,str(FROZEN),'exec'),original.__dict__)
    return derived(original,raw).build(folder)


def __getattr__(name):
    return getattr(composition(),name)


if __name__=='__main__':
    print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
