// Log identifiers and timings only; never include credentials or AI payloads.
export async function timedOperation(log, label, operation) {
  const started = Date.now();
  log(`${label} started`);
  try {
    const result = await operation();
    log(`${label} finished elapsedMs=${Date.now() - started}`);
    return result;
  } catch (error) {
    log(`${label} failed elapsedMs=${Date.now() - started}`);
    throw error;
  }
}
