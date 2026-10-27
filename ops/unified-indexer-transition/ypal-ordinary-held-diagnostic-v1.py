"""Passive error/SQL-stderr evidence for one genuine rollback-only qualification.

No import effects. This module never dispatches, retries, changes a deadline,
reads credentials, or writes a receipt. The root caller saves snapshot() private.
"""
import base64
import hashlib
import os
import select
import subprocess
import sys
import traceback
import types

MAXIMUM_STDERR_BYTES=1_000_000

def need(value,code):
    if not value:raise RuntimeError(code)

def sha(raw):return hashlib.sha256(raw).hexdigest()

class StderrTee:
    """Original reads are unchanged; only discarded terminal tail is observed."""
    def __init__(self,raw,process,record):
        self.raw,self.process,self.record=raw,process,record
        self.prefix=bytearray();self.observed=0;self.complete=False;self.truncated=False;self.diagnostic_errors=[]
    def __getattr__(self,name):return getattr(self.raw,name)
    def remember(self,value):
        try:
            if isinstance(value,bytes):
                self.observed+=len(value);remaining=MAXIMUM_STDERR_BYTES-len(self.prefix)
                self.prefix.extend(value[:max(remaining,0)])
                if len(value)>remaining:self.truncated=True
        except (MemoryError,OverflowError,BufferError)as error:self.diagnostic_errors.append(type(error).__name__)
    def read(self,*args,**kwargs):
        value=self.raw.read(*args,**kwargs)
        self.remember(value)
        try:
            requested=args[0]if args else kwargs.get('size',-1)
            if isinstance(value,bytes)and type(requested)is int and(requested<0 or len(value)<requested):self.complete=True
        except (TypeError,AttributeError)as error:self.diagnostic_errors.append(type(error).__name__)
        return value
    def close(self):
        # The genuine parent's finally has already polled/killed/waited. Never
        # drain while its terminal stderr predicate could still read these bytes.
        try:
            if not self.raw.closed and self.process.returncode is not None and not self.complete:
                fd=self.raw.fileno()
                while len(self.prefix)<MAXIMUM_STDERR_BYTES:
                    if not select.select([fd],[],[],0)[0]:break
                    maximum=min(65536,MAXIMUM_STDERR_BYTES-len(self.prefix))
                    read1=getattr(self.raw,'read1',None)
                    value=read1(maximum)if callable(read1)else os.read(fd,maximum)
                    if not value:self.complete=True;break
                    self.remember(value)
                if len(self.prefix)==MAXIMUM_STDERR_BYTES and not self.complete:self.truncated=True
        except (OSError,ValueError,TypeError,AttributeError)as error:self.diagnostic_errors.append(type(error).__name__)
        except BaseException:
            # An alarm or cancellation remains visible; do not turn it into a
            # successful diagnostic close. The original stream still closes.
            self.raw.close();raise
        return self.raw.close()
    def snapshot(self):
        raw=bytes(self.prefix)
        return{'pid':self.process.pid,'returncode':self.process.returncode,'stderrBase64':base64.b64encode(raw).decode(),
            'stderrSha256':sha(raw),'capturedBytes':len(raw),'observedBytes':self.observed,
            'complete':self.complete,'truncatedOrAtCap':self.truncated,'stderrClosed':self.raw.closed,
            'diagnosticErrorClasses':list(self.diagnostic_errors),'originalReadReturnBytesUnchanged':True,
            'unreadTailObservedOnlyAfterTerminalAtOriginalClose':True}

class CaughtErrorTrace:
    def __init__(self,code):self.code=code;self.error=None;self.trace_errors=[];self.previous=None;self.started=False
    def local(self,frame,event,arg):
        try:
            if frame.f_code is self.code:
                error=frame.f_locals.get('error')
                if isinstance(error,BaseException)and self.error is None:self.error=error
        except (AttributeError,TypeError)as error:self.trace_errors.append(type(error).__name__)
        return self.local
    def global_trace(self,frame,event,arg):
        return self.local if frame.f_code is self.code else None
    def __enter__(self):
        need(not self.started and sys.gettrace()is None,'one_diagnostic_trace_without_existing_trace_required')
        self.started=True;self.previous=sys.gettrace();sys.settrace(self.global_trace);return self
    def __exit__(self,kind,value,tb):
        sys.settrace(self.previous);return False
    def snapshot(self):
        error=self.error
        return{'caughtInnerErrorObserved':error is not None,'innerErrorClass':type(error).__name__ if error is not None else None,
            'innerErrorMessage':str(error)if error is not None else None,
            'innerErrorTraceback':''.join(traceback.format_exception(type(error),error,error.__traceback__))if error is not None else None,
            'traceDiagnosticErrorClasses':list(self.trace_errors),'onlyActualQualifierCodeRecorded':True,
            'originalExceptionPropagatesUnchanged':True}

class ObservedQualification:
    """Same code/defaults/closure; one explicit subprocess-observation seam."""
    def __init__(self,cache,authority):
        self.cache,self.authority=cache,authority;self.original=cache._sql_child;self.started=False;self.processes=[]
        raw=self.original
        need(type(raw)is types.FunctionType and raw.__globals__.get('subprocess')is subprocess,
            'genuine_uninstrumented_SQL_parent_subprocess_required')
        # This only constructs the actual wrong-ACK code for exact caller
        # attribution; no callback is invoked and no SQL is dispatched.
        expected=authority.rollback_transport(raw,cache.prior_cache._sql_child,lambda *_:None)
        self.expected_code=authority.code_identity(expected.__code__)
        proxy=types.ModuleType('root_diagnostic_subprocess');proxy.__dict__.update(subprocess.__dict__)
        proxy.Popen=self.popen
        self.instrumented=types.FunctionType(raw.__code__,{**raw.__globals__,'subprocess':proxy},raw.__name__,raw.__defaults__,raw.__closure__)
        need(authority.code_identity(self.instrumented.__code__)==authority.code_identity(raw.__code__)and
            self.instrumented.__defaults__ is raw.__defaults__ and self.instrumented.__closure__ is raw.__closure__,
            'whole_SQL_parent_code_defaults_and_closure_unchanged_required')
        self.trace=CaughtErrorTrace(authority._qualify_held.__code__)
    def popen(self,*args,**kwargs):
        need(self.authority.code_identity(sys._getframe(1).f_code)==self.expected_code,
            'only_actual_rollback_only_SQL_parent_can_use_diagnostic_Popen')
        # Pass the original argument objects without alteration.
        process=subprocess.Popen(*args,**kwargs)
        record={'process':process,'tee':None}
        self.processes.append(record)
        need(process.stderr is not None,'actual_SQL_stderr_pipe_required')
        tee=StderrTee(process.stderr,process,record);record['tee']=tee;process.stderr=tee
        return process
    def __enter__(self):
        need(not self.started and self.cache._sql_child is self.original,'one_unmodified_parent_diagnostic_scope_required')
        self.started=True
        self.trace.__enter__()
        self.cache._sql_child=self.instrumented;return self
    def __exit__(self,kind,value,tb):
        try:self.cache._sql_child=self.original
        finally:self.trace.__exit__(kind,value,tb)
        return False
    def snapshot(self):
        return{'format':'yunipals-ypal-ordinary-held-diagnostic-v1','caughtError':self.trace.snapshot(),
            'transports':[row['tee'].snapshot()for row in self.processes if row['tee']is not None],
            'wholeParentCodeUnchanged':self.authority.code_identity(self.instrumented.__code__)==self.authority.code_identity(self.original.__code__),
            'parentRestored':self.cache._sql_child is self.original,'traceRestored':sys.gettrace()is self.trace.previous,
            'SQLBytesChanged':False,'predicatesChanged':False,'deadlinesChanged':False,'clockReset':False,
            'effectOrCaptureRetried':False,'newQualificationAuthorityConferred':False}

if __name__=='__main__':
    import json
    print(json.dumps({'staticOnly':True,'dispatches':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
