export const WEATHER_REFRESH_MS = 60_000;

// Browsers may suspend hidden tabs. Check immediately on return when overdue.
export function installWeatherRefresh({refresh, canRefresh, doc = document, win = window,
 now = Date.now, schedule = setTimeout, cancel = clearTimeout}) {
 let lastAttempt = now(), timer;
 function arm() {
  cancel(timer);
  timer = schedule(check, Math.max(1, WEATHER_REFRESH_MS - (now() - lastAttempt)));
 }
 function markRequested() { lastAttempt = now(); arm(); }
 function check() {
  if (now() - lastAttempt < WEATHER_REFRESH_MS) { arm(); return; }
  if (doc.visibilityState === 'hidden' || win.navigator.onLine === false || !canRefresh()) {
   cancel(timer); timer = schedule(check, WEATHER_REFRESH_MS); return;
  }
  markRequested();
  refresh();
 }
 doc.addEventListener('visibilitychange', check);
 win.addEventListener('online', check);
 win.addEventListener('pageshow', check);
 arm();
 return {markRequested, stop() {
  cancel(timer);
  doc.removeEventListener('visibilitychange', check);
  win.removeEventListener('online', check);
  win.removeEventListener('pageshow', check);
 }};
}
