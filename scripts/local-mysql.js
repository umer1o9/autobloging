import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, open, unlink, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

const action = process.argv[2] || 'start';
const root = resolve('data/mysql-local'), statePath = resolve('data/mysql-local.json');
const binary = process.env.MYSQLD_PATH || '/usr/local/mysql/bin/mysqld';
const socket = `/private/tmp/autoblog-${createHash('sha256').update(process.cwd()).digest('hex').slice(0,12)}.sock`;
const stateExists = await access(statePath).then(() => true, () => false);
async function ready(url) { let c; try { c = await mysql.createConnection(url); await c.query('SELECT 1'); return true; } catch { return false; } finally { await c?.end(); } }
async function start(state, initFile) {
  if (await ready(state.databaseUrl)) { console.log('Project MySQL is already running on 127.0.0.1:3307.'); return; }
  const log = await open(resolve('data/mysql-local.log'), 'a', 0o600);
  const child = spawn(binary, ['--no-defaults', `--datadir=${root}`, '--port=3307', '--bind-address=127.0.0.1', `--socket=${socket}`, `--pid-file=${resolve('data/mysql-local.pid')}`, '--mysqlx=0', '--skip-log-bin', '--innodb-buffer-pool-size=67108864', '--secure-file-priv=NULL', ...(initFile ? [`--init-file=${initFile}`] : [])], { detached: true, stdio: ['ignore', log.fd, log.fd] });
  let failed = false; child.once('error', () => { failed = true; }); child.unref(); await log.close();
  for (let attempt=0; attempt<60; attempt++) {
    if (await ready(state.databaseUrl)) { if (initFile) await unlink(initFile); console.log('Project MySQL is ready on 127.0.0.1:3307.'); return; }
    if (failed) break;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Project MySQL did not start. Inspect data/mysql-local.log; no existing MySQL service was changed.');
}
if (action === 'setup') {
  if (stateExists) throw new Error('Project MySQL configuration already exists. Use npm run db:local:start.');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const existingEnv = await readFile('.env', 'utf8').catch(() => '');
  if (/^DATABASE_URL=/m.test(existingEnv)) throw new Error('DATABASE_URL is already configured; refusing to replace it.');
  const log = await open(resolve('data/mysql-local.log'), 'a', 0o600);
  const init = spawnSync(binary, ['--no-defaults', '--initialize-insecure', `--datadir=${root}`, '--mysqlx=0'], { stdio: ['ignore', log.fd, log.fd] });
  await log.close();
  if (init.status !== 0) throw new Error('MySQL initialization failed. Inspect data/mysql-local.log.');
  const appPassword = randomBytes(24).toString('hex'), testPassword = randomBytes(24).toString('hex'), rootPassword = randomBytes(32).toString('hex');
  const state = { databaseUrl: `mysql://autoblog:${appPassword}@127.0.0.1:3307/autoblog`, testUrl: `mysql://autoblog_test:${testPassword}@127.0.0.1:3307/abtest`, rootPassword };
  const initFile = resolve('data/mysql-bootstrap.sql');
  await writeFile(initFile, [
    `ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}';`,
    'CREATE DATABASE IF NOT EXISTS autoblog CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;',
    `CREATE USER 'autoblog'@'localhost' IDENTIFIED BY '${appPassword}';`,
    "GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON autoblog.* TO 'autoblog'@'localhost';",
    `CREATE USER 'autoblog_test'@'localhost' IDENTIFIED BY '${testPassword}';`,
    "GRANT ALL PRIVILEGES ON `abtest%`.* TO 'autoblog_test'@'localhost';"
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  const defaults = existingEnv || await readFile('.env.example', 'utf8');
  const clean = defaults.split('\n').filter(line => !/^(DATABASE_URL|TEST_DATABASE_URL|DATABASE_PATH)=/.test(line)).join('\n');
  await writeFile('.env', `${clean}\nDATABASE_URL=${state.databaseUrl}\nTEST_DATABASE_URL=${state.testUrl}\n`, { mode: 0o600 });
  await start(state, initFile);
} else if (action === 'start') {
  if (!stateExists) throw new Error('Run npm run db:local:setup first.');
  const initFile = resolve('data/mysql-bootstrap.sql');
  await start(JSON.parse(await readFile(statePath, 'utf8')), await access(initFile).then(() => initFile, () => undefined));
} else if (action === 'stop') {
  if (!stateExists) throw new Error('No project MySQL configuration exists.');
  // Authenticate to this project's socket before shutdown; never kill an arbitrary reused PID.
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const c = await mysql.createConnection({ socketPath: socket, user: 'root', password: state.rootPassword });
  try { await c.query('SHUTDOWN'); } finally { await c.end().catch(() => {}); }
  console.log('Project MySQL shutdown requested.');
} else throw new Error('Use setup, start, or stop.');
