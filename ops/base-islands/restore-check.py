"""Restore a downloaded Islands archive into a disposable local database and verify relationships."""
import hashlib,json,subprocess,time
from pathlib import Path
work=Path('/srv/yunipals-islands/base-integration-v1')
report=json.loads((work/'storage-box-verification.json').read_text())
backup=Path(report['backupDirectory']);assert report['downloadedArchiveVerified']
manifest=json.loads((backup/'manifest.json').read_text())
for name,expected in manifest['files'].items():assert hashlib.sha256((backup/name).read_bytes()).hexdigest()==expected
name='yunipals_islands_restore_20261013'
def admin(args,**kw):
 kw.setdefault('text',True)
 return subprocess.run(['runuser','-u','postgres','--',*args],check=True,capture_output=True,**kw)
def sql(query):return admin(['psql','-X','-v','ON_ERROR_STOP=1','-A','-t','-d',name],input=query).stdout.strip()
# Refuse to overwrite a pre-existing database.
admin(['createdb',name]);created=True
try:
 sql('CREATE SCHEMA metadata; CREATE SCHEMA metadata_source;')
 for dump in ['foundation.dump','islands.dump','base-islands.dump']:
  admin(['pg_restore','--no-owner','--no-privileges','--exit-on-error','-d',name],input=(backup/dump).read_bytes(),text=False)
 sources=json.loads((backup/'sources.json').read_text())
 # Populate using the actual restored source table type, preserving every column.
 payload=json.dumps(sources,separators=(',',':')).replace("'","''")
 sql("INSERT INTO metadata_source.source_blob SELECT * FROM jsonb_populate_recordset(NULL::metadata_source.source_blob,'"+payload+"'::jsonb);")
 admin(['pg_restore','--no-owner','--no-privileges','--exit-on-error','-d',name],input=(backup/'publication.dump').read_bytes(),text=False)
 readiness=json.loads((backup/'readiness.json').read_text());payload=json.dumps(readiness,separators=(',',':')).replace("'","''")
 sql("INSERT INTO metadata.chain_readiness SELECT * FROM jsonb_populate_recordset(NULL::metadata.chain_readiness,'"+payload+"'::jsonb);")
 counts=json.loads(sql("SELECT json_build_object('originals',(SELECT count(*) FROM yunipals_islands_v2.token),'airdropped',(SELECT count(*) FROM yunipals_base_islands_v1.token),'provenance',(SELECT count(*) FROM metadata.island_airdrop_origin),'publications',(SELECT count(*) FROM metadata.island_publication WHERE status='published'),'revisions',(SELECT count(*) FROM metadata_source.island_revision),'sourceBlobs',(SELECT count(*) FROM metadata_source.source_blob),'missingSources',(SELECT count(*) FROM metadata_source.island_revision r LEFT JOIN metadata_source.source_blob b ON b.content_hash=r.source_hash WHERE b.content_hash IS NULL),'baseVerified',(SELECT verified_block IS NOT NULL FROM yunipals_base_islands_v1.sync_state))"))
 assert counts['originals']==898 and counts['airdropped']==898 and counts['provenance']==898 and counts['publications']==1796 and counts['missingSources']==0 and counts['baseVerified'],counts
 result={'restoredAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'backupDirectory':str(backup),'archiveSha256':report['archiveSha256'],'restorePassed':True,'temporaryDatabase':name,'counts':counts,'temporaryDatabaseRemoved':True}
 (work/'database-restore-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
except subprocess.CalledProcessError as error:
 print(error.stderr[-2500:].decode() if isinstance(error.stderr,bytes) else error.stderr[-2500:]);raise
finally:
 if created:admin(['dropdb',name])
