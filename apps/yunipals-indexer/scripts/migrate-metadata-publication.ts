import { migrations } from "../lib/offchain/migrations.js";
import { publicationMigrations } from "../lib/metadata/publication-schema.js";
import { argumentsOf,postgresFrom,safeFailure } from "./metadata/support.js";
const args=argumentsOf(),{pool}=await postgresFrom(String(args['env-file'])),client=await pool.connect();
try{
  await client.query("SELECT pg_advisory_lock(hashtext('metadata_source_schema'))");
  await client.query("SET lock_timeout='5s'");
  const offset=migrations.indexOf(publicationMigrations[0]);
  const applied=new Set((await client.query<{version:number}>('SELECT version FROM metadata.schema_migration')).rows.map(row=>row.version));
  for(let n=1;n<=offset;n++)if(!applied.has(n))throw new Error('Existing migration ledger is incomplete');
  let added=0;
  for(const [index,sql] of publicationMigrations.entries()){
    const version=offset+index+1;if(applied.has(version))continue;
    console.log(JSON.stringify({applyingVersion:version,statement:sql.split('\n')[0]}));
    if(sql.startsWith('CREATE INDEX IF NOT EXISTS')){
      const indexName=sql.match(/EXISTS (\w+)/)![1],schema=sql.match(/ON (\w+)\./)![1];
      const existing=await client.query("SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)",[`${schema}.${indexName}`]);
      // Regular builds permit readers but block writes to the indexed table.
      // Install during the coordinated publisher pause before activation; this
      // also avoids unrelated snapshot waits during CONCURRENTLY finalization.
      if(existing.rowCount&&!existing.rows[0].indisvalid)await client.query(`DROP INDEX ${schema}.${indexName}`);
      await client.query(sql);
      const valid=await client.query("SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)",[`${schema}.${indexName}`]);
      if(!valid.rows[0]?.indisvalid)throw new Error('Concurrent publication index is incomplete');
      await client.query('INSERT INTO metadata.schema_migration(version) VALUES($1)',[version]);
    }else{
      await client.query('BEGIN');await client.query(sql);await client.query('INSERT INTO metadata.schema_migration(version) VALUES($1)',[version]);await client.query('COMMIT');
    }
    added++;
  }
  console.log(JSON.stringify({migrationsApplied:added,archiveActivated:false,liveDocumentsChanged:false}));
}catch(error){await client.query('ROLLBACK');console.error(safeFailure(error));process.exitCode=1;}
finally{await client.query("SELECT pg_advisory_unlock(hashtext('metadata_source_schema'))").catch(()=>{});client.release();await pool.end();}
