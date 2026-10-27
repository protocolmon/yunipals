#!/usr/bin/env python3
"""Verify and reproduce the finite public split Reader manifest; no operators."""
import ast,hashlib,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OPS=ROOT/'ops/unified-indexer-transition'
SOURCE=OPS/'ypal-native-readiness-split-reader-binding-v1.py'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def build():
 tree=ast.parse(SOURCE.read_bytes());pins=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='SOURCE_PINS'for t in n.targets)))
 files={SOURCE.name:sha(SOURCE.read_bytes()),**pins};origins={};candidates={}
 for folder,dirs,names in os.walk(ROOT):
  dirs[:]=[name for name in dirs if not name.startswith('.')and name!='node_modules']
  for name in set(names)&set(files):candidates.setdefault(name,[]).append(Path(folder)/name)
 for name,digest in files.items():
  if Path(name).name!=name:raise RuntimeError('literal public basename required')
  options=candidates.get(name,[])
  matches=[p for p in options if sha(p.read_bytes())==digest]
  if not matches:raise RuntimeError('actual public source origin missing: '+name)
  preferred=OPS/name;path=preferred if preferred in matches else sorted(matches)[0];origins[name]=str(path.relative_to(ROOT))
 value={'format':'yunipals-native-readiness-split-reader-binding-v1-source','files':files}
 raw=encoded(value)
 if SOURCE.with_suffix('.manifest.json').read_bytes()!=raw:raise RuntimeError('manifest must byte-reproduce actual literal source map')
 return value,origins
if __name__=='__main__':
 value,origins=build();print(json.dumps({'format':value['format'],'sourceFileCount':len(value['files']),'manifestSha256':sha(encoded(value)),'allActualPublicOriginsVerified':True,'sourceOnly':True},sort_keys=True))
