import http from 'node:http';

// Bind promptly, but wait for readiness within the first request. Managed hosts
// can treat an immediate cold-start 503 as an unsuccessful application launch.
export function startServer({ initialize, host = '127.0.0.1', port = 3210, timeoutMs = 60000, log = console.log }) {
  let app, failed = false, phase = 'Opening HTTP listener', closePromise, disposePromise, timer;
  const report = message => { phase = message; log(`[startup] ${message}`); };
  const dispose = () => app ? (disposePromise ||= app.close()) : Promise.resolve();
  const server = http.createServer(async (req, res) => {
    try {
      await ready;
      if (res.destroyed) return;
      if (app.handle) return await app.handle(req, res);
      return app.server.emit('request', req, res);
    } catch {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' });
      res.end(JSON.stringify({ error: 'Application initialization failed. Check the server runtime logs.', stage: phase }));
    }
  });
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
    server.listen(port, host);
  });
  // Start initialization after calling listen(), without depending on a host's
  // patched listen callback/event. Some launchers manage that notification.
  const initialization = Promise.resolve().then(() => {
    report('Initializing application');
    return initialize(server, report);
  }).then(value => {
    app = value;
    if (failed) void dispose().catch(() => log('[startup] Late initialization cleanup failed.'));
    return value;
  });
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Startup timed out during: ${phase}`), { code: 'STARTUP_TIMEOUT' })), timeoutMs);
    timer.unref();
  });
  const bindFailure = listening.then(() => new Promise(() => {}));
  const ready = Promise.race([initialization, bindFailure, deadline]).then(value => {
    clearTimeout(timer); report('Application ready'); return value;
  }, error => {
    failed = true; clearTimeout(timer); throw error;
  });
  return {
    server, listening, ready,
    close() {
      return closePromise ||= (async () => {
        // Do not await a launcher-owned listening notification during shutdown.
        await new Promise(resolve => server.close(resolve));
        await ready.catch(() => {});
        await dispose();
      })();
    }
  };
}
