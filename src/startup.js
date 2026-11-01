import http from 'node:http';

// Bind before database initialization: managed Node hosts require listen() promptly.
// Requests reach the application only after its database and worker are ready.
export function startServer({ initialize, host = '127.0.0.1', port = 3210 }) {
  let app, failed = false, closePromise;
  const server = http.createServer((req, res) => {
    if (app) return app.server.emit('request', req, res);
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' });
    res.end(JSON.stringify({ error: failed ? 'Application initialization failed. Check the server runtime logs.' : 'Application is starting. Database updates may be running. Please retry shortly.' }));
  });
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const ready = listening.then(initialize).then(value => {
    app = value;
    return app;
  }, error => {
    failed = true;
    throw error;
  });
  return {
    server, listening, ready,
    close() {
      return closePromise ||= (async () => {
        await listening.catch(() => {});
        await new Promise(resolve => server.close(resolve));
        await ready.catch(() => {});
        if (app) await app.close();
      })();
    }
  };
}
