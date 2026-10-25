import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
export async function testDatabase(t, registerCleanup = true) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a dedicated MySQL test account. Tests never use DATABASE_URL.');
  const uri = new URL(process.env.TEST_DATABASE_URL);
  if (!uri.pathname.slice(1).startsWith('abtest')) throw new Error('Test database prefix must start with abtest.');
  const name = `abtest_${randomBytes(10).toString('hex')}`;
  uri.pathname = '/';
  const admin = await mysql.createConnection(uri.toString());
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  uri.pathname = `/${name}`;
  const store = new Store(uri.toString());
  await store.migrate();
  const cleanup = async () => { await store.close(); await admin.query(`DROP DATABASE \`${name}\``); await admin.end(); };
  if (registerCleanup) t.after(cleanup);
  return { store, url: uri.toString(), cleanup };
}
