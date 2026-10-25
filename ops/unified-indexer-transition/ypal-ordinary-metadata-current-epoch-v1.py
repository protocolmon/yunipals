#!/usr/bin/env python3
"""Read-only current metadata authority for an explicitly owned scheduler epoch."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-metadata-current-epoch-v1.py'
FORMAT='yunipals-ypal-ordinary-metadata-current-epoch-v1'
UTILITY=OPS/'ypal-ordinary-cache-continuation-context-v1.py'
UTILITY_SHA='f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449'
OWNER='ypal-native-metadata-approval-epoch-v2.py'
OWNER_MANIFEST='ypal-native-metadata-approval-epoch-v2.manifest.json'
OWNER_FORMAT='yunipals-native-metadata-approval-epoch-v2'
LEGACY=OPS/'ypal-ordinary-metadata-handover-v5.py'
LEGACY_SHA='9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f'
COMMON=OPS/'ypal-ordinary-consumer-handover-v5.py'
COMMON_SHA='dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'
TEMPLATE=OPS/'ypal-restored-metadata-handover-v1.py'
TEMPLATE_SHA='cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'
ARTIFACT='7489372f92886018d06718401fb46dca2f97e840f6ae56b7fa6b19e488de1887'
ARTIFACT_MANIFEST='fc579afc4169b658df1cd3f8faaaba1fa811b0a1db3999c5deba322870712c3b'
WORKER_SHA='dfabd70fb96e21ac5f9fa941308492fbbaf80aa08d7d9527fccf088815a4afb6'
PREDECESSOR_ARTIFACT='cf333946766e6c858d143612827fc52fd2f860e22af746c56e571513729696cc'
PREDECESSOR_MANIFEST='6f348bf121060215eb889364a233b48a35a8308f10c11b36a4c964a9869cb626'
PREDECESSOR_WORKER_SHA='5c868742926fb5a56583bc25d87a814ce91c9509728c67df0ab507f8f40adc21'
SELECTED_SHA='2829182fa96599513f07099118ab0c16b0ceff8d04330537a9c90bd5231e35ba'
SOURCE_PINS={
    'ypal-ordinary-cache-continuation-context-v1.py':'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449',
    'ypal-ordinary-metadata-handover-v5.py':'9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f',
    'ypal-ordinary-consumer-handover-v5.py':'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c',
    'ypal-restored-metadata-handover-v1.py':'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'
}


def utility():
    for item in[*UTILITY.parents,UTILITY]:
        row=item.lstat()
        if row.st_uid!=0 or row.st_gid!=0 or stat.S_ISLNK(row.st_mode)or row.st_mode&0o022:
            raise RuntimeError('protected_metadata_current_epoch_utility_required')
    before=UTILITY.lstat();raw=UTILITY.read_bytes();after=UTILITY.lstat()
    if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or not 0<len(raw)==before.st_size<100000 or \
        hashlib.sha256(raw).hexdigest()!=UTILITY_SHA or any(getattr(before,key)!=getattr(after,key)for key in
        ['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']):
        raise RuntimeError('exact_metadata_current_epoch_utility_required')
    value=types.ModuleType('metadata_current_epoch_utility');value.__file__=str(UTILITY)
    exec(compile(raw,str(UTILITY),'exec'),value.__dict__);return value


def checked_refs(u,refs,inverse):
    u.need(type(inverse)is bool and type(refs)is dict and
        set(refs)=={'mode','resultSha256','inputSha256','producerSha256','manifestSha256'}and
        refs['mode']==('restored'if inverse else'current')and all(u.pin(refs[key])for key in refs if key!='mode'),
        'explicit_actual_metadata_epoch_five_refs_and_direction_required')
    return copy.deepcopy(refs)


def consumer_utility():
    """The new family authenticates its fixed new authority, never C413 as new."""
    base=utility();value=types.SimpleNamespace(**base.__dict__)
    value.AUTHORITY='ypal-ordinary-cache-continuation-authority-v2.py'
    value.AUTHORITY_MANIFEST='ypal-ordinary-cache-continuation-authority-v2.manifest.json'
    original=base.authority;constants=list(original.__code__.co_consts)
    old='yunipals-ypal-ordinary-cache-continuation-authority-v1-source'
    base.need(constants.count(old)==1,'one_fixed_continuation_authority_manifest_domain_seam_required')
    constants[constants.index(old)]='yunipals-ypal-ordinary-cache-continuation-authority-v2-source'
    code=original.__code__.replace(co_consts=tuple(constants))
    value.authority=types.FunctionType(code,{**original.__globals__,'AUTHORITY':value.AUTHORITY,
        'AUTHORITY_MANIFEST':value.AUTHORITY_MANIFEST},original.__name__,original.__defaults__,original.__closure__)
    return value


class Epoch:
    """The lifecycle actor leaf confers no READ or publication authority."""
    def __init__(self,refs,manifest,inverse=False):
        self.u=u=utility();self.refs=checked_refs(u,refs,inverse);self.inverse=inverse
        u.need(type(manifest)is dict and type(manifest.get('dependencies'))is dict and type(manifest.get('files'))is dict,
            'actual_new_consumer_manifest_with_owned_metadata_epoch_sources_required')
        pins={**manifest['dependencies'],**manifest['files']}
        u.need(pins.get(OWNER)==refs['producerSha256']and pins.get(OWNER_MANIFEST)==refs['manifestSha256'],
            'same_actual_owned_metadata_lifecycle_owner_and_manifest_required')
        raw=u.public(OPS/OWNER,refs['producerSha256'])
        nodes=[node for node in ast.parse(raw).body if isinstance(node,ast.Assign)and len(node.targets)==1 and
            isinstance(node.targets[0],ast.Name)and node.targets[0].id=='SOURCE_PINS']
        u.need(len(nodes)==1,'one_literal_owned_metadata_lifecycle_source_closure_required');closure=ast.literal_eval(nodes[0].value)
        u.need(type(closure)is dict and 1<=len(closure)<=512 and all(type(name)is str and name not in{'','.','..'}and
            '/'not in name and '\\'not in name and u.pin(digest)for name,digest in closure.items()),
            'finite_fixed_owned_metadata_lifecycle_source_closure_required')
        actual=json.loads(u.public(OPS/OWNER_MANIFEST,refs['manifestSha256']))
        expected={OWNER:refs['producerSha256'],**closure}
        u.need(actual=={'format':OWNER_FORMAT+'-source','files':expected}and
            all(pins.get(name)==digest for name,digest in expected.items()),
            'complete_actual_metadata_epoch_closure_before_owner_evaluation_required')
        for name,digest in{**SOURCE_PINS,**expected}.items():u.public(OPS/name,digest)
        self.owner=u.load(OPS/OWNER,refs['producerSha256'])
        u.need(self.owner.FORMAT==OWNER_FORMAT and Path(self.owner.FILE)==OPS/OWNER,
            'fixed_actual_metadata_lifecycle_owner_domain_required')
        method=self.owner.inverse_acknowledgement if inverse else self.owner.acknowledgement
        self.ack=method(refs['resultSha256'],refs['inputSha256']);self._check(self.ack,immutable=True)

    def _check(self,value,immutable=False):
        u=self.u;refs=self.refs
        u.need(type(value)is dict and value['format']==OWNER_FORMAT and value['validated']is True and
            value['operatorSha256']==refs['producerSha256']and value['receiptSha256']==refs['resultSha256']and
            value['inputSha256']==refs['inputSha256']and value['metadataSelectedSha256']==SELECTED_SHA and
            all(u.pin(value[key])for key in['operationSha256','metadataInputSha256','metadataOperationSha256'])and
            type(value['actor'])is dict and type(value['boot'])is dict and type(value['historicalActor'])is dict and
            type(value['historicalBoot'])is dict and value['boot']==value['historicalBoot']and
            value['actor']!=value['historicalActor']and
            all(value[key]is False for key in['sourceActorQualified','READAuthorityQualified','publicationAuthorityQualified','financialAuthorityQualified'])and
            value['databaseWrites']==value['serviceActions']==value['providerCalls']==0,
            'actual_new_metadata_epoch_ACK_actor_boot_and_historical_selection_identity_required')
        if immutable:u.need(value['immutableAcknowledgementOnly']is True,'actual_immutable_owned_metadata_epoch_ACK_required')
        if self.inverse:u.need(u.pin(value['upgradeResultSha256']),'actual_upgrade_ACK_ancestry_in_owned_restored_epoch_required')
        target=(PREDECESSOR_ARTIFACT,PREDECESSOR_MANIFEST)if self.inverse else(ARTIFACT,ARTIFACT_MANIFEST)
        u.need((value['artifactDigest'],value['artifactManifestSha256'])==target and
            value['workerSha256']==(PREDECESSOR_WORKER_SHA if self.inverse else WORKER_SHA),
            'actual_owned_metadata_epoch_program_artifact_and_manifest_required')
        return value

    def historical(self,namespace,host,candidate,selection):
        u=self.u;ack=self.ack
        u.need(candidate['metadataOperationSha256']==ack['metadataOperationSha256']and
            host.s.document(namespace.BASE/'selected.json',SELECTED_SHA)==selection and selection['selected']is True and
            selection['nativeActor']==ack['historicalActor']and selection['boot']==ack['historicalBoot'],
            'actual_old_selected282_and_operation_remain_historical_not_current_actor_alias')

    def actor(self,host,operation,pristine):
        host.private(operation['oldWriter'])
        value=self.current()
        host.metadata_epoch_current=value;return copy.deepcopy(value['actor'])

    def current(self):
        method=self.owner.restored_actor_current if self.inverse else self.owner.actor_current
        value=self._check(method(self.refs['resultSha256'],self.refs['inputSha256']))
        self.u.need(value['currentActorQualified']is True and all(value[key]==self.ack[key]for key in
            ['operatorSha256','receiptSha256','inputSha256','operationSha256','metadataInputSha256','metadataOperationSha256',
             'metadataSelectedSha256','actor','boot','historicalActor','historicalBoot','artifactDigest','artifactManifestSha256','workerSha256']),
            'same_actual_owned_metadata_epoch_actor_private_definition_and_boot_current_bookend_required')
        if self.inverse:self.u.need(value['upgradeResultSha256']==self.ack['upgradeResultSha256'],
            'same_actual_upgrade_ACK_before_current_restored_epoch_required')
        return value

    def binding(self):
        keys=['operationSha256','metadataInputSha256','metadataOperationSha256','metadataSelectedSha256','actor','boot',
            'historicalActor','historicalBoot','artifactDigest','artifactManifestSha256','workerSha256']
        if self.inverse:keys.append('upgradeResultSha256')
        return {'refs':copy.deepcopy(self.refs),'acknowledgement':{key:copy.deepcopy(self.ack[key])for key in keys}}

    def reader_operation(self,forward):
        u=self.u;current=self.binding()
        if not self.inverse:
            u.need(forward==current,'same_actual_metadata_epoch_as_owned_reader_operation_required');return
        u.need(type(forward)is dict and set(forward)=={'refs','acknowledgement'}and forward['refs']['mode']=='current'and
            all(forward['refs'][key]==self.refs[key]for key in['inputSha256','producerSha256','manifestSha256'])and
            forward['refs']['resultSha256']==self.ack['upgradeResultSha256']and
            all(forward['acknowledgement'][key]==self.ack[key]for key in['operationSha256','metadataInputSha256',
                'metadataOperationSha256','metadataSelectedSha256','historicalActor','historicalBoot','boot'])and
            forward['acknowledgement']['artifactDigest']==ARTIFACT and forward['acknowledgement']['artifactManifestSha256']==ARTIFACT_MANIFEST and
            forward['acknowledgement']['workerSha256']==WORKER_SHA and forward['acknowledgement']['actor']!=self.ack['actor'],
            'actual_same_lifecycle_upgrade_then_owned_cf333_restore_for_reader_inverse_required')

    def inverse_actor_ancestry(self,owner,host,operation,selection):
        u=self.u
        u.need(self.inverse and self.refs['mode']=='restored'and
            host.s.document(owner.BASE/'selected.json',SELECTED_SHA)==selection and
            selection['nativeActor']==self.ack['historicalActor']and selection['boot']==self.ack['historicalBoot']and
            u.sha(host.s.protected(owner.BASE/'operation.json'))==self.ack['metadataOperationSha256'],
            'only_actual_owned_cf333_restored_epoch_before_genuine_metadata_inverse_required')
        return copy.deepcopy(self.ack['actor'])


def epoch_metadata(phase,candidate,selection,refresh):
    # Keep this public function free of closure cells: the genuine prepared
    # constructor binds construct_context in a fresh authenticated namespace.
    def construct(*args,**kwargs):
        host=construct_context(*args,**kwargs)
        _epoch.historical(_legacy,host,candidate,selection);return host
    fn=types.FunctionType(_raw_metadata.__code__,{**_raw_metadata.__globals__,'construct_context':construct},
        _raw_metadata.__name__,_raw_metadata.__defaults__)
    value=fn(phase,candidate,selection,refresh)
    return{**value,'format':FORMAT,'metadataOperatorSha256':_utility.sha(_utility.public(FILE)),
        'historicalMetadataOperatorSha256':LEGACY_SHA,'metadataEpoch':_epoch.binding(),
        'historicalSelectedActorQualifiedAsCurrent':False,'oldWholeMetadataCurrentPassed':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def namespace(metadata_input_sha,refs,manifest,inverse=False):
    epoch=Epoch(refs,manifest,inverse);u=epoch.u
    u.need(u.pin(metadata_input_sha)and epoch.ack['metadataInputSha256']==metadata_input_sha,
        'same_actual_metadata_execution_input_and_owned_epoch_required')
    old=u.load(LEGACY,LEGACY_SHA).namespace(metadata_input_sha)
    n=types.ModuleType('actual_owned_metadata_current_epoch');n.__dict__.update(old.__dict__)
    parent=old.Host
    class Host(parent):
        metadata_epoch=epoch
        def actor(self,op=None,native=False,pristine=True):
            if not native:return super().actor(op,native,pristine)
            actual=epoch.actor(self,op,pristine)
            if epoch.inverse:
                old_program=super().actor(op,True,pristine)
                u.need(old_program==actual,'genuine_cf333_native_actor_and_actual_owned_restored_epoch_must_agree')
            return actual
    n.Host=Host
    n.construct_context=types.FunctionType(old.construct_context.__code__,{**old.construct_context.__globals__,'Host':Host},
        old.construct_context.__name__,old.construct_context.__defaults__,old.construct_context.__closure__)
    tree=ast.parse(u.public(TEMPLATE,TEMPLATE_SHA));original=copy.deepcopy(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='metadata'))
    changes=0
    for node in ast.walk(original):
        if isinstance(node,ast.Compare)and ast.unparse(node)=="first == selection['nativeActor']":
            node.comparators=[ast.parse('h.metadata_epoch_current["actor"]',mode='eval').body];changes+=1
    u.need(changes==1,'one_explicit_current_epoch_actor_comparison_seam_required')
    scope={**old.metadata.__globals__,'construct_context':n.construct_context}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[original],type_ignores=[])),str(FILE),'exec'),scope)
    actual=scope['metadata']
    n.metadata=types.FunctionType(epoch_metadata.__code__,{**globals(),'construct_context':n.construct_context,
        '_epoch':epoch,'_legacy':old,'_raw_metadata':actual,'_utility':u},'metadata',epoch_metadata.__defaults__)
    n.metadata_inverse_context=types.FunctionType(old.metadata_inverse_context.__code__,
        {**old.metadata_inverse_context.__globals__,'construct_context':n.construct_context},
        old.metadata_inverse_context.__name__,old.metadata_inverse_context.__defaults__,old.metadata_inverse_context.__closure__)
    n.metadata_epoch=epoch;n.metadata_epoch_helper_file=FILE
    return n


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('metadata_current_epoch_requires_actual_lifecycle_ACK_and_consumer_manifest')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'historicalSelectedActorQualifiedAsCurrent':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
