// One authenticated request waits for a change; reconnect with the last seen
// revision so changes during reconnects cannot be missed.
export function watchSession({ url, token, revision, changed, closed, fetcher = fetch }) {
  const controller = new AbortController();
  const { signal } = controller;
  let healthy = false;
  const task = (async () => {
    while (!signal.aborted) {
      try {
        const authorization = await token();
        if (signal.aborted) break;
        // A unique, non-secret wait ID prevents intermediaries from combining
        // identical idle long polls belonging to different classroom clients.
        const response = await fetcher(`${url}?revision=${revision}&wait=${crypto.randomUUID()}`, {
          headers: { Authorization: `Bearer ${authorization}` },
          signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]), cache: 'no-store'
        });
        if (signal.aborted) break;
        if ([401, 403, 404].includes(response.status)) { healthy = false; closed(); break; }
        if (!response.ok) throw new Error('Session updates interrupted');
        const update = await response.json();
        if (signal.aborted) break;
        if (update.closed) { healthy = false; closed(); break; }
        healthy = true;
        // Do not reconnect faster than the authorized view can be loaded. Keep
        // the old cursor if the callback fails so a reconnect retries the change.
        if (update.revision !== revision) { await changed(); revision = update.revision; }
      } catch {
        healthy = false;
        if (signal.aborted) break;
        await new Promise(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 1500);
          signal.addEventListener('abort', done, { once: true });
        });
      }
    }
  })();
  return { stop: () => { healthy = false; controller.abort(); }, get healthy() { return healthy && !signal.aborted; }, task };
}
