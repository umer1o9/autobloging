console.log('[worker] started');

const log = message => console.log(`${new Date().toISOString()} ${message}`);
let store;
let startupPhase = 'loading dependencies';
try {
  log(`[worker] ${startupPhase}; node=${process.version}`);
  // Dynamic imports ensure even a missing dependency is logged after "started".
  const [{ Store }, { Domain }, { createProvider }, { createImageProvider }, { runWorkerOnce }] = await Promise.all([
    import('../src/store.js'), import('../src/domain.js'), import('../src/provider.js'),
    import('../src/image-provider.js'), import('../src/worker.js')
  ]);
  startupPhase = 'checking environment';
  if (!process.env.DATABASE_URL) throw Object.assign(new Error(), { code: 'DATABASE_URL_MISSING' });
  log(`[worker] environment: database=configured; paidGeneration=${process.env.ALLOW_PAID_GENERATION === 'true'}; geminiKey=${!!process.env.GEMINI_API_KEY}`);
  startupPhase = 'processing queue';
  store = new Store();
  const domain = new Domain(store, createProvider(), createImageProvider());
  await runWorkerOnce(store, domain, log);
} catch (error) {
  // Never print connection strings, credentials, or raw provider payloads.
  log(`[worker] failed during ${startupPhase} (${error.code || 'application error'}). Check cron environment and deployment files.`);
  process.exitCode = 1;
} finally {
  try {
    if (store) await store.close();
  } catch (error) {
    log(`Worker cleanup failed (${error.code || 'application error'}).`);
    process.exitCode = 1;
  }
}
log(`[worker] exitCode=${process.exitCode || 0}`);
console.log('[worker] finished');
