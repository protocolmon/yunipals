#!/usr/bin/env python3
"""Private post-failure witness; no live tracing, wrapping or dispatch."""
import hashlib
import json
from pathlib import Path
import stat
import sys
import traceback
import types

FORMAT='yunipals-ypal-cont5-held-after-exception-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
AUTHORITY='ypal-ordinary-cache-continuation-authority-v5.py'
AUTHORITY_MANIFEST='ypal-ordinary-cache-continuation-authority-v5.manifest.json'
AUTHORITY_FORMAT='yunipals-ypal-ordinary-cache-continuation-authority-v5'
SOURCE_PINS={'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-ordinary-cache-callback-timing-v5.py': 'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb', 'ypal-ordinary-cache-continuation-authority-v1.py': 'c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7', 'ypal-ordinary-cache-continuation-authority-v2.py': '6ab6b0ae7e0bff7107cee6c50a709de631e505c1acef101a34ce9ec6290e303f', 'ypal-ordinary-cache-continuation-authority-v3.py': '0446dea37801f282c97d613ded19f75491925487fddbea5dc25441a1733b5ca7', 'ypal-ordinary-cache-continuation-authority-v4.py': '938b15ee463f7c950828eadeac3e599305d01dbfd8b8ddccd8a974f88b31a240', 'ypal-ordinary-cache-continuation-authority-v5.manifest.json': '2b19fe520f291ef01bc2133b18e0fe9406c6a67a0eeae55067ee1dc5fa399d78', 'ypal-ordinary-cache-continuation-authority-v5.py': 'd95bbcceb812dd7d3acc9e828a78f6125870a021dbfeed952f6c477f48003bef', 'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-metadata-current-effect-v1.py': '9d79c54f8828f36a120241c61a36e28a4c3423731a87fc8824aaecdf7c9305c7', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-ordinary-metadata-current-epoch-v2.py': '3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b', 'ypal-ordinary-metadata-current-epoch-v3.py': '33ae8619fe0a43b94745b1a00ae57db166592c83ccf6a997d50cd8c583fdff51', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9'}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def public(path,digest):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_fixed_held_witness_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=4000000 and sha(raw)==digest and
        all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']),
        'same_actual_held_witness_source_bytes_required')
    return raw

def code_identity(code):
    return(code.co_code,code.co_names,code.co_varnames,code.co_argcount,code.co_posonlyargcount,code.co_kwonlyargcount,
        code.co_flags,code.co_exceptiontable,code.co_freevars,code.co_cellvars,code.co_filename,
        tuple(code_identity(item)if isinstance(item,types.CodeType)else item for item in code.co_consts))

def evaluate(raw,path):
    value=types.ModuleType('fixed_held_witness_'+Path(path).stem);value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value

def reference():
    raw=public(OPS/AUTHORITY,SOURCE_PINS[AUTHORITY]);manifest=json.loads(public(OPS/AUTHORITY_MANIFEST,SOURCE_PINS[AUTHORITY_MANIFEST]))
    expected={name:digest for name,digest in SOURCE_PINS.items()if name!=AUTHORITY_MANIFEST}
    need(manifest=={'format':AUTHORITY_FORMAT+'-source','files':expected},'exact_complete_fixed_CONT5_authority_source_manifest_required')
    for name,digest in expected.items():public(OPS/name,digest)
    return evaluate(raw,OPS/AUTHORITY).composition()

class Witness:
    """Created only after the original exception has reached its caller."""
    def __init__(self,error,authority):
        need(isinstance(error,BaseException)and error.__traceback__ is not None,'actual_propagated_exception_required')
        trace,profile=sys.gettrace(),sys.getprofile();expected=reference();actual=authority._qualify_held
        need(type(actual)is types.FunctionType and actual.__globals__ is authority.__dict__ and
            authority.FILE==expected.FILE==OPS/AUTHORITY and authority.FORMAT==expected.FORMAT==AUTHORITY_FORMAT and
            authority.BASE==expected.BASE and authority.NEW_BASE==expected.NEW_BASE and
            code_identity(actual.__code__)==code_identity(expected._qualify_held.__code__)and
            code_identity(authority.qualify_held.__code__)==code_identity(expected.qualify_held.__code__),
            'genuine_complete_CONT5_qualifier_code_and_namespace_required')
        self.outer_error=error;self.inner_error=None;self.frame=None;frames=0;matched=0;tb=error.__traceback__
        while tb is not None:
            frames+=1;need(frames<=128,'bounded_actual_outer_held_exception_traceback_required')
            frame=tb.tb_frame
            if frame.f_code is actual.__code__:
                matched+=1;need(matched==1 and frame.f_globals is authority.__dict__,
                    'one_exact_actual_held_qualifier_frame_required')
                local=frame.f_locals;cache=local.get('cache')
                need(getattr(cache,'continuation_authority',None)is authority,
                    'actual_cache_bound_to_the_genuine_qualifier_authority_required')
                candidate=local.get('error')
                need(candidate is None or isinstance(candidate,BaseException),'actual_caught_inner_exception_or_absence_required')
                if candidate is not None:need(candidate.__traceback__ is not None,'actual_caught_inner_traceback_required')
                self.inner_error=candidate
                self.frame={'file':actual.__code__.co_filename,'function':actual.__name__,'line':tb.tb_lineno,
                    'codeBytesSha256':sha(actual.__code__.co_code)}
            tb=tb.tb_next
        self.matched=matched==1
        need(sys.gettrace()is trace and sys.getprofile()is profile,'post_exception_witness_must_preserve_existing_observer_state')
        self.trace_unchanged=True;self.profile_unchanged=True

    def snapshot(self):
        inner=self.inner_error
        rendered=''.join(traceback.format_exception(type(inner),inner,inner.__traceback__))if inner is not None else None
        need(rendered is None or len(rendered.encode())<=1000000,'bounded_private_inner_exception_text_required')
        return{'format':FORMAT,'actualQualifierFrameMatched':self.matched,'qualifierFrame':self.frame,
            'caughtInnerErrorObserved':inner is not None,'innerErrorClass':type(inner).__name__ if inner is not None else None,
            'innerErrorMessage':str(inner)if inner is not None else None,'innerErrorTraceback':rendered,
            'outerErrorClass':type(self.outer_error).__name__,'outerErrorMessage':str(self.outer_error),
            'liveTraceInstalled':False,'liveProfileInstalled':False,'SQLParentWrapped':False,'subprocessOrPipeWrapped':False,
            'originalExceptionReplaced':False,'argumentsChanged':False,'returnValuesChanged':False,'predicatesChanged':False,
            'deadlinesChanged':False,'approvalClockReset':False,'retryPerformed':False,
            'existingTracePreserved':self.trace_unchanged,'existingProfilePreserved':self.profile_unchanged,
            'timingQualificationClaimed':False,'sourceOrMetadataQualified':False,'transactionOutcomeQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}

if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'liveTraceInstalled':False,'liveProfileInstalled':False,
    'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
