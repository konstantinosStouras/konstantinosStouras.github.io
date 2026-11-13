// One authenticated request waits for a change; reconnect with the last seen
// revision so changes during reconnects cannot be missed.
export function watchSession({ url, token, revision, changed, closed, fetcher = fetch }) {
  const controller = new AbortController();
  const { signal } = controller;
  const task = (async () => {
    while (!signal.aborted) {
      try {
        const authorization = await token();
        if (signal.aborted) break;
        const response = await fetcher(`${url}?revision=${revision}`, {
          headers: { Authorization: `Bearer ${authorization}` },
          signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]), cache: 'no-store'
        });
        if (signal.aborted) break;
        if ([401, 403, 404].includes(response.status)) { closed(); break; }
        if (!response.ok) throw new Error('Session updates interrupted');
        const update = await response.json();
        if (signal.aborted) break;
        if (update.closed) { closed(); break; }
        if (update.revision !== revision) { revision = update.revision; changed(); }
      } catch {
        if (signal.aborted) break;
        await new Promise(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 1500);
          signal.addEventListener('abort', done, { once: true });
        });
      }
    }
  })();
  return { stop: () => controller.abort(), task };
}
