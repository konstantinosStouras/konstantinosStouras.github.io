(() => {
  const key = 'studio-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  let theme = preference === 'dark' || preference === 'light' ? preference : system.matches ? 'dark' : 'light';
  const buttons = new Set();
  function apply() {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#161f1b' : '#f5f5ef');
    for (const button of buttons) {
      button.textContent = theme === 'dark' ? '☀' : '☾';
      button.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
      button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }
  function makeButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      preference = theme;
      try { localStorage.setItem(key, theme); } catch {}
      apply();
    });
    buttons.add(button);
    return button;
  }
  apply(); // Runs in the head before the first paint.
  system.addEventListener('change', event => {
    if (preference !== 'dark' && preference !== 'light') { theme = event.matches ? 'dark' : 'light'; apply(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = event.newValue;
    theme = preference === 'dark' || preference === 'light' ? preference : system.matches ? 'dark' : 'light';
    apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.className = 'theme-bar';
    bar.setAttribute('aria-label', 'Appearance');
    bar.append(makeButton());
    document.body.prepend(bar);
    const root = document.querySelector('#app');
    const toggle = bar.firstChild;
    const placeToggle = () => {
      if (!root) return;
      const slot = root.querySelector('[data-theme-slot]') || root.querySelector('.welcome-nav');
      if (slot && toggle.parentNode !== slot) slot.append(toggle);
      else if (!slot && toggle.parentNode !== bar) bar.append(toggle);
      bar.hidden = !!slot;
    };
    if (root) new MutationObserver(placeToggle).observe(root, { childList: true, subtree: true });
    placeToggle();
    const dialog = document.querySelector('#dialog');
    if (dialog) new MutationObserver(() => {
      // The shared control may be temporarily detached during a workspace render.
      for (const button of buttons) if (button !== toggle && !button.isConnected) buttons.delete(button);
      if (dialog.open && !dialog.querySelector('.theme-toggle')) {
        const slot = dialog.querySelector('[data-dialog-theme-slot]') || dialog;
        slot.prepend(makeButton());
        apply();
      }
    }).observe(dialog, { childList: true, attributes: true, attributeFilter: ['open'] });
    apply();
  });
})();
