import { Store } from '../src/store.js';
const store = new Store(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
try { await store.migrate(); console.log('MySQL schema is current (version 2).'); }
finally { await store.close(); }
