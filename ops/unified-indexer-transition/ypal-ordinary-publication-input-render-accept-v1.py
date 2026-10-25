#!/usr/bin/env python3
"""Static accepted-receipt renderer; the real build operation keeps its owner."""
import ast
import json
from pathlib import Path

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-input-render-accept-v1.py'
FORMAT='yunipals-ypal-ordinary-publication-input-render-accept-v1'
HELPER=OPS/'ypal-ordinary-generation-accept-binding-v1.py'
HELPER_SHA='4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758'
FROZEN=OPS/'ypal-ordinary-publication-input-render-v1.py'
FROZEN_SHA='edff30e35a7253e2487afb12938f0c93571897c6ec25eff96769a3d405614b31'
BINDING_SHA='3ff3808d4c824509eba0111d3a8d64f33d4fb2fe7da45459bb17d634ff127bf0'
READER_MANIFEST=OPS/'ypal-ordinary-reader-accept-v1.manifest.json'
READER_MANIFEST_SHA='b28fb02092d8b70e442ca9bc9a57526363195fb3b7d106b0f9090c6f2ec53742'
PROVIDER=OPS/'ypal-ordinary-read-cache-accept-v1.py'
PROVIDER_SHA='b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a'


def helper():
    import hashlib
    import stat
    import types
    for path in [*HELPER.parents,HELPER]:
        row=path.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_acceptance_renderer_helper_required')
    before=HELPER.lstat();raw=HELPER.read_bytes();after=HELPER.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or \
       hashlib.sha256(raw).hexdigest()!=HELPER_SHA or any(getattr(before,key)!=getattr(after,key)for key in
           ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_acceptance_renderer_helper_required')
    value=types.ModuleType('acceptance_renderer_binding');value.__file__=str(HELPER)
    exec(compile(raw,str(HELPER),'exec'),value.__dict__);return value


def composition():
    h=helper();counts=dict.fromkeys(['operation','format','operator','files'],0)
    class BuildRoute(ast.NodeTransformer):
        def visit_Call(self,node):
            if ast.unparse(node.func)=='self.document'and node.args and ast.unparse(node.args[0])=="Path(h.ATTEMPT_BASE) / 'operation.json'":
                node.args[0]=ast.parse("Path(candidate['operationFile'])",mode='eval').body;counts['operation']+=1
            return self.generic_visit(node)
        def visit_Compare(self,node):
            seams={"operation['format'] == owner.FORMAT":("owner.composition().FORMAT",'format'),
                   "operation['operatorSha256'] == candidate['operatorSha256']":("candidate['buildOperatorSha256']",'operator'),
                   "operation['newExecutionFiles'] == owner.SOURCE_PINS":
                       ("h.literal_source_pins(h.public(OPS / 'ypal-ordinary-generation-attempt-v2.py',h.BUILD_OWNER_SHA))",'files')}
            code=ast.unparse(node)
            if code in seams:
                expression,key=seams[code];node.comparators[0]=ast.parse(expression,mode='eval').body;counts[key]+=1
            return self.generic_visit(node)
    def transform(node):
        if isinstance(node,ast.ClassDef)and node.name=='Renderer':
            for index,method in enumerate(node.body):
                if isinstance(method,ast.FunctionDef)and method.name=='render':node.body[index]=BuildRoute().visit(method)
        return node
    value=h.derive(h.public(FROZEN,FROZEN_SHA),FROZEN_SHA,FILE,
        {'FORMAT':FORMAT,'HELPER':HELPER,'HELPER_SHA':HELPER_SHA,'BINDING_SHA':BINDING_SHA,
         'READER_MANIFEST':READER_MANIFEST,'READER_MANIFEST_SHA':READER_MANIFEST_SHA,
         'PROVIDER':PROVIDER,'PROVIDER_SHA':PROVIDER_SHA},{'helper':helper},transform)
    h.need(all(count==1 for count in counts.values()),'exact_four_acceptance_renderer_build_operation_lineage_seams_required')
    inherited=value.Renderer
    class Renderer(inherited):
        def render(self,candidate_sha):
            result=super().render(candidate_sha)
            candidate=self.document(Path(h.ATTEMPT_BASE)/'candidate-result.json',candidate_sha)
            proof=candidate['terminalCompletionProof'];binding=proof['binding']
            h.need(set(proof)=={'validated','binding','bindingSha256','databaseWrites','serviceActions','providerCalls'}and
                proof['validated']is True and proof['databaseWrites']==proof['serviceActions']==proof['providerCalls']==0 and
                h.sha(h.encoded(binding))==proof['bindingSha256'] and binding['unit']==h.ATTEMPT_UNIT and
                binding['format']=='yunipals-ypal-ordinary-generation-terminal-v1' and
                binding['unitExecutionFieldsRetained']is binding['originalStrictTerminalInvocationGatePassed']is False,
                'recorded_new_acceptance_terminal_proof_and_no_original_strict_success_required')
            paths={'startIntent':h.BUILD_BASE/(h.ATTEMPT_UNIT+'-start-intent.json'),
                   'runtimeIntent':Path(h.ATTEMPT_WORK)/'intent.json',
                   'started':h.BUILD_BASE/(h.ATTEMPT_UNIT+'-started.json'),
                   'result':Path(h.ATTEMPT_WORK)/'result.json'}
            h.need(set(binding['recordSha256'])==set(paths)and all(h.sha(h.encoded(self.document(path)))==binding['recordSha256'][key]
                for key,path in paths.items()),'same_actual_immutable_terminal_worker_records_in_acceptance_receipt_required')
            return {**result,'buildOperationFile':candidate['operationFile'],'buildOperatorSha256':candidate['buildOperatorSha256'],
                    'acceptanceProducerSha256':candidate['operatorSha256'],'recordedTerminalBindingSha256':proof['bindingSha256'],
                    'liveTerminalRequalified':False,'originalAttemptCandidateCLIPassed':False,
                    'previousAcceptanceProducerSha256':candidate['previousAcceptanceProducerSha256'],
                    'previousAcceptanceCLIPassed':False}
    value.Renderer=Renderer
    return value


def __getattr__(name):return getattr(composition(),name)


if __name__=='__main__':
    import sys
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'inputWrites':0,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:
        try:composition().main()
        except Exception as error:
            import re
            code=str(error)
            print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and
                re.fullmatch('[A-Za-z0-9_]+',code)else'missing_or_invalid_protected_acceptance_lineage','inputWrites':0}))
            raise SystemExit(1)
