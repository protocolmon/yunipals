#!/usr/bin/env python3
"""Explicit new artifact install; no service, database or default effects."""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-native-metadata-approval-install-v1.py'
FORMAT='yunipals-native-metadata-approval-install-v1'
DIGEST='7489372f92886018d06718401fb46dca2f97e840f6ae56b7fa6b19e488de1887'
MANIFEST_SHA='fc579afc4169b658df1cd3f8faaaba1fa811b0a1db3999c5deba322870712c3b'
META_SHA='4cbb6a2dfaa4b6d52475a15e1a7ed18a43bfd90958d13f57cb592a4551895bd1'
INCOMING=OPS/'ypal-native-metadata-approval-runtime-v1'
TARGET=Path('/opt/yunipals-unified/nonmarket-consumer-releases')/DIGEST
BASE=Path('/var/backups/yunipals-native-metadata-approval-install-v1-20261025')
PREDECESSOR=OPS/'metadata-normalization-runtime-install-v1.py'
PREDECESSOR_SHA='08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
ENTRIES=('metadata-worker','unified-base-metadata','unified-ownership-views')
OUTPUTS={f'dist/{name}.mjs{suffix}'for name in ENTRIES for suffix in('', '.map')}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None and value!='0'*64


def public(path,digest):
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_native_approval_installer_source_required')
    first=path.lstat();raw=path.read_bytes();last=path.lstat()
    need(stat.S_ISREG(first.st_mode)and first.st_nlink==1 and 0<len(raw)==first.st_size<=4000000 and sha(raw)==digest and
        all(getattr(first,key)==getattr(last,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']),
        'same_exact_native_approval_installer_source_required')
    return raw


def evaluate(path,digest):
    raw=public(path,digest);value=types.ModuleType('native_approval_install_'+path.stem);value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value


def payload(m,root):
    manifest=m.document(root/'manifest.json',MANIFEST_SHA)
    need(manifest['format']=='yunipals-native-metadata-approval-runtime-v1'and manifest['artifactDigest']==DIGEST and
        manifest['predecessorArtifactDigest']=='cf333946766e6c858d143612827fc52fd2f860e22af746c56e571513729696cc'and
        manifest['predecessorManifestSha256']=='6f348bf121060215eb889364a233b48a35a8308f10c11b36a4c964a9869cb626'and
        manifest['quietApprovalCheckSeconds']==60 and manifest['approvalValiditySeconds']==90 and
        manifest['sameWorkerAndPool']is manifest['newMetadataEpochRequired']is True and
        manifest['runtimeCadenceQualified']is False and len(manifest['inputs'])==85 and manifest['additionalIngestors']==0 and
        len(manifest['files'])==6 and{row['path']for row in manifest['files']}==OUTPUTS,
        'exact_new_scheduling_only_artifact_and_unmodified_sixty_ninety_second_gates_required')
    files={'manifest.json':m.protected(root/'manifest.json'),'metafile.json':m.protected(root/'metafile.json')}
    need(m.sha(files['metafile.json'])==META_SHA,'actual_native_approval_compiler_metafile_required')
    for row in manifest['files']:
        raw=m.protected(root/row['path'],4000000);need(len(raw)==row['bytes']and m.sha(raw)==row['sha256'],
            'exact_native_approval_compiled_output_required');files[row['path']]=raw
    return manifest,files


def composition():
    previous=evaluate(PREDECESSOR,PREDECESSOR_SHA);factory=evaluate(FACTORY,FACTORY_SHA)
    value=factory.namespace(public(PREDECESSOR,PREDECESSOR_SHA),PREDECESSOR_SHA,FILE,
        {'FORMAT':FORMAT,'DIGEST':DIGEST,'MANIFEST_SHA':MANIFEST_SHA,'META_SHA':META_SHA,'INCOMING':INCOMING,
            'TARGET':TARGET,'BASE':BASE},{'payload':payload})
    return previous,value


def prepare(m,predecessor_install_sha):
    need(pin(predecessor_install_sha),'genuine_existing_normalization_install_ACK_required')
    previous,value=composition();prior=previous.installed(m,predecessor_install_sha)
    result,files=value.prepare(m)
    result.update(predecessorNormalizationInstallSha256=predecessor_install_sha,
        predecessorNormalizationTarget=prior['target'],newMetadataEpochRequired=True,runtimeCadenceQualified=False,
        installerSha256=sha(Path(__file__).read_bytes()))
    return result,files


def installed(m,result_sha):
    previous,value=composition();result=value.installed(m,result_sha)
    need(result['installerSha256']==sha(Path(__file__).read_bytes())and result['newMetadataEpochRequired']is True and
        result['runtimeCadenceQualified']is False and pin(result['predecessorNormalizationInstallSha256']),
        'actual_new_installer_ACK_without_runtime_or_old_epoch_success_alias_required')
    prior=previous.installed(m,result['predecessorNormalizationInstallSha256'])
    need(prior['target']==result['predecessorNormalizationTarget'],'same_actual_retained_normalization_install_required')
    return result


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--predecessor-install-sha')
    parser.add_argument('--review',action='store_true');parser.add_argument('--install');args=parser.parse_args()
    if not args.review and args.install is None:
        need(args.predecessor_install_sha is None,'explicit_review_required_before_install_inputs')
        print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main'and args.review!=(args.install is not None),
        'one_explicit_new_root_artifact_review_or_install_required')
    os.umask(0o077);previous,value=composition();m=previous.shared();result,files=prepare(m,args.predecessor_install_sha)
    binding=m.sha(m.encoded(result))
    if args.review:print(json.dumps({'format':FORMAT,'reviewHash':binding,'artifactDigest':DIGEST,'newMetadataEpochRequired':True,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:
        need(args.install==binding,'same_fresh_actual_new_artifact_install_review_required')
        receipt=value.install(m,result,files);installed(m,receipt)
        print(json.dumps({'format':FORMAT,'installed':True,'resultSha256':receipt,'artifactDigest':DIGEST,
            'newMetadataEpochRequired':True,'runtimeCadenceQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))


if __name__=='__main__':main()
