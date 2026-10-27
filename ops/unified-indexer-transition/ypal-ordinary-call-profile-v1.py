#!/usr/bin/env python3
"""Private call-duration observations; no wrappers, authority, or retry policy."""
import hashlib
import json
from pathlib import Path
import sys
import time

FORMAT='yunipals-ypal-ordinary-call-profile-v1'


class CallProfile:
    """Observe only explicitly selected Python code in this thread.

    Callers authenticate the finite source files before passing their absolute
    names. A return event also occurs when a function unwinds with an error;
    these records deliberately make no success claim. No arguments or values
    are retained. Profiling time is part of the original measured work.
    """
    def __init__(self,files,names,maximum=10000):
        if type(files)is not dict or not 1<=len(files)<=512 or any(
            type(name)is not str or not Path(name).is_absolute()or
            type(digest)is not str or len(digest)!=64 or any(c not in'0123456789abcdef'for c in digest)
            for name,digest in files.items()):raise ValueError('finite_authenticated_profile_sources_required')
        if type(names)is not set or not names or any(type(name)is not str or not name for name in names)or \
            type(maximum)is not int or not 1<=maximum<=10000:raise ValueError('finite_profile_function_selection_required')
        self.files=dict(files);self.names=set(names);self.maximum=maximum
        self.events=[];self.active={};self.dropped=0;self.observation_errors=0;self.installed=False

    def observe(self,frame,event,arg):
        try:
            if event=='call':
                code=frame.f_code;file=code.co_filename
                if file not in self.files or code.co_name not in self.names:return
                if len(self.events)+len(self.active)>=self.maximum:self.dropped+=1;return
                self.active[id(frame)]=(time.monotonic_ns(),file,code.co_qualname,
                    hashlib.sha256(code.co_code).hexdigest())
            elif event=='return':
                row=self.active.pop(id(frame),None)
                if row is None:return
                started,file,name,code_sha=row
                self.events.append({'file':file,'sourceSha256':self.files[file],
                    'qualifiedName':name,'codeBytesSha256':code_sha,
                    'elapsedNs':max(0,time.monotonic_ns()-started),
                    'returnedOrUnwound':True,'successQualified':False})
        except (AttributeError,TypeError,ValueError,OverflowError,OSError):
            # An observation failure must not replace an original result/error.
            self.observation_errors+=1

    def __enter__(self):
        if self.installed or sys.getprofile()is not None:raise RuntimeError('exclusive_unprofiled_thread_required')
        self.installed=True;sys.setprofile(self.observe);return self

    def __exit__(self,kind,value,tb):
        sys.setprofile(None);self.installed=False;return False

    def snapshot(self):
        if self.installed:raise RuntimeError('profile_snapshot_after_original_calls_required')
        return{'format':FORMAT,'events':list(self.events),'unfinishedCalls':len(self.active),
            'droppedCalls':self.dropped,'observationErrors':self.observation_errors,
            'functionCodeChanged':False,'argumentsChanged':False,'returnValuesChanged':False,
            'approvalClockReset':False,'timingQualificationClaimed':False,'effectsRetried':False}


if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,
    'profilingInstalled':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
