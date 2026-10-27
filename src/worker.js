import { timedOperation } from './timing.js';
// One bounded queue pass, shared by cron callers. No HTTP server is created.
export async function runWorkerOnce(store, domain, log = console.log) {
  const time = (label, operation) => timedOperation(log, `[worker] ${label}`, operation);
  await time('schema check', () => store.assertSchema());
  if (!await time('worker lock', () => store.acquireWorker())) {
    log('Skipped: another worker owns the database lock.');
    return { skipped: true, processed: 0 };
  }
  await time('recovery', () => domain.recoverInterrupted());
  await time('scheduling', () => domain.automate());
  await time('publication', () => domain.publishDue());
  await time('session cleanup', () => store.cleanSessions());
  // One job and a 25-minute provider-call budget fit hPanel's 30-minute limit.
  const deadlineAt = Date.now() + 25 * 60000;
  const queued = await time('queue selection', () => store.queuedJobs(1));
  let processed = 0;
  for (const { workspace, value: job } of queued) {
    if (!store.workerActive) throw new Error('Worker database lock was lost.');
    log(`Starting job ${job.id}.`);
    await domain.runJob(workspace, job.id, { deadlineAt });
    const result = await store.get('job', workspace, job.id);
    log(`Job ${job.id}: ${result.status}; stage: ${result.stage}.`);
    processed++;
  }
  if (!store.workerActive) throw new Error('Worker database lock was lost.');
  // Publish articles completed during this pass; newly scheduled articles
  // that are not due yet will be picked up by the next cron invocation.
  await domain.automate();
  await domain.publishDue();
  log(`Queue pass finished; processed ${processed} job(s).`);
  return { skipped: false, processed };
}
