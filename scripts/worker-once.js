import { Store } from '../src/store.js';
import { Domain } from '../src/domain.js';
import { createProvider } from '../src/provider.js';
import { createImageProvider } from '../src/image-provider.js';
import { runWorkerOnce } from '../src/worker.js';

const log = message => console.log(`${new Date().toISOString()} ${message}`);
console.log(`[worker] started ${new Date().toISOString()}`);
let store;
try {
  store = new Store();
  const domain = new Domain(store, createProvider(), createImageProvider());
  await runWorkerOnce(store, domain, log);
} catch (error) {
  // Never print connection strings, credentials, or raw provider payloads.
  log(`Worker failed (${error.code || 'application error'}). Check database availability, schema, and configuration.`);
  process.exitCode = 1;
} finally {
  try {
    if (store) await store.close();
  } finally {
    console.log(`[worker] finished ${new Date().toISOString()} exitCode=${process.exitCode || 0}`);
  }
}
