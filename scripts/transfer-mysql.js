import { Store } from '../src/store.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const source = new Store(process.env.DATABASE_URL);
const target = new Store(process.env.TARGET_DATABASE_URL);
const names = ['workspaces','users','sessions','websites','topics','articles','jobs','approvals','usage_records','audit_events','data_imports'];
if (process.env.DATABASE_URL === process.env.TARGET_DATABASE_URL) throw new Error('Source and destination must differ.');
try {
  await source.assertSchema();
  // Stop application writes before running. The source itself is never mutated.
  const connection = await source.pool.getConnection();
  const snapshot = {};
  try {
    await connection.query('SET TRANSACTION READ ONLY');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    for (const table of names) {
      const [columns] = await connection.execute("SELECT COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND EXTRA NOT LIKE '%STORED GENERATED%' AND EXTRA NOT LIKE '%VIRTUAL GENERATED%' ORDER BY ORDINAL_POSITION", [source.database,table]);
      const [rows] = await connection.query(`SELECT ${columns.map(c=>'`'+c.COLUMN_NAME+'`').join(',')} FROM \`${table}\``);
      snapshot[table] = { columns, rows };
    }
    await connection.commit();
  } catch(error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  if (snapshot.jobs.rows.some(j=>['queued','running'].includes(j.status))) throw new Error('Drain queued/running jobs before transferring.');
  await mkdir('data/backups',{recursive:true,mode:0o700});
  const encoded=JSON.stringify(snapshot), fingerprint=createHash('sha256').update(encoded).digest('hex');
  const backup=`data/backups/mysql-${fingerprint}.json`;
  await writeFile(backup,encoded,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  await target.migrate();
  const counts=await target.transaction(async()=>{
    for(const table of names) if(Number((await target.query(`SELECT COUNT(*) AS n FROM \`${table}\``))[0].n)) throw new Error(`Destination ${table} is not empty; transfer stopped without overwriting data.`);
    const counts={};
    for(const table of names){
      const {columns,rows}=snapshot[table];
      for(const row of rows){
        await target.query(`INSERT INTO \`${table}\` (${columns.map(c=>'`'+c.COLUMN_NAME+'`').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,columns.map(c=>c.DATA_TYPE==='json'&&row[c.COLUMN_NAME]!==null ? JSON.stringify(row[c.COLUMN_NAME]) : row[c.COLUMN_NAME]));
      }
      const imported=await target.query(`SELECT ${columns.map(c=>'`'+c.COLUMN_NAME+'`').join(',')} FROM \`${table}\``);
      const key=r=>JSON.stringify(columns.map(c=>r[c.COLUMN_NAME]));
      // MySQL JSON key order is consistent on both servers; deep comparison verifies every value.
      const sort=items=>items.sort((a,b)=>key(a).localeCompare(key(b)));
      if(!isDeepStrictEqual(sort(imported),sort(rows)))throw new Error(`Content mismatch in ${table}; transfer rolled back.`);
      counts[table]=rows.length;
    }
    return counts;
  },'database-transfer');
  console.log(JSON.stringify({transferred:true,counts,backup},null,2));
} finally { await source.close(); await target.close(); }
