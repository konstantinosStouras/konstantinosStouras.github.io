// Run with Node, playwright-core and an installed Google Chrome.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright-core');

const base = 'http://lit.test/lit/';
const routes = ['', 'analytics/', 'about/', 'feedback/', 'use-cases/', 'whats-new/', 'privacy/', 'admin/website-analytics/'];
const root = path.join(__dirname, '..', 'lit');

// Load the requested production page and its local assets. A signed-in fixture exercises
// the full account menu without contacting Firebase or downloading the catalogue.
async function loadPage(page, directory) {
  const address = new URL(directory, base);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href === address.href) {
      return route.fulfill({ path: path.join(root, directory, 'index.html'), contentType: 'text/html' });
    }
    if (url.origin === address.origin && url.pathname === '/lit/analytics/data.json') {
      return route.fulfill({ json: { journals: [], types: [] } });
    }
    if (url.origin === address.origin && /^\/lit\/[\w-]+\.(js|css)$/.test(url.pathname)) {
      return route.fulfill({ path: path.join(root, path.basename(url.pathname)) });
    }
    return route.abort();
  });
  await page.addInitScript(isAdmin => {
    const user = { uid: 'menu-fixture', email: 'reader@example.org', displayName: 'Literature Reader' };
    if (isAdmin) Object.assign(user, { email: 'kstouras@gmail.com', emailVerified: true });
    localStorage.setItem('litProfHint', JSON.stringify({ u: user.uid, ol: true, n: user.displayName, pc: 3 }));
    const auth = { onAuthStateChanged: callback => setTimeout(() => callback(user), 0) };
    const profileSnapshot = {
      exists: true, data: () => ({ orcid: 'fixture', orcidLinked: true, myPubCount: 3, savedCount: 0, alertCount: 0 })
    };
    const ref = {
      doc: id => id === 'main' ? { ...ref, get: async () => profileSnapshot } : ref,
      collection: () => ref, onSnapshot: () => () => {},
      get: async () => ({ exists: false, docs: [], size: 0 }), set: async () => {}
    };
    window.firebase = { apps: [{}], app: () => ({}), initializeApp: () => ({}), auth: () => auth, firestore: () => ref };
  }, directory === 'admin/website-analytics/');
  await page.goto(address.href);
  if (directory === 'analytics/') await page.locator('#app').waitFor();
  if (directory === 'admin/website-analytics/') await page.locator('#usagePanel').waitFor();
}

// Check real hit targets inside the visible intersection. A missing intersection
// is a fixture failure: it would let a broken stacking order pass unnoticed.
async function assertMenuOnTop(page, menu, control) {
  const result = await page.evaluate(({ menu, control }) => {
    const panel = document.querySelector(menu);
    const target = document.querySelector(control);
    const a = panel.getBoundingClientRect(), b = target.getBoundingClientRect();
    const left = Math.max(0, a.left, b.left), right = Math.min(innerWidth, a.right, b.right);
    const top = Math.max(0, a.top, b.top), bottom = Math.min(innerHeight, a.bottom, b.bottom);
    if (right - left < 4 || bottom - top < 4) return 'no visible overlap';
    for (const dx of [0.25, 0.5, 0.75]) {
      for (const dy of [0.25, 0.5, 0.75]) {
        const x = left + dx * (right - left), y = top + dy * (bottom - top);
        const stack = document.elementsFromPoint(x, y);
        if (!stack.some(el => target.contains(el))) return 'control absent from the hit stack';
        const hit = stack[0];
        if (!panel.contains(hit)) return hit?.outerHTML.slice(0, 160) || 'no hit target';
      }
    }
    return 'menu';
  }, { menu, control });
  assert.equal(result, 'menu', `${page.viewportSize().width}px: ${menu} over ${control}: ${result}`);
}

async function checkBrowseControls(page, menu, desktop) {
  // The ordinary Browse form already intersects both menus. Check every
  // visible input or trigger in that region at its unmodified position.
  const filters = await page.locator('.filters-bar input[id], .filters-bar .custom-select[id]').evaluateAll((nodes, menu) => {
    const panel = document.querySelector(menu).getBoundingClientRect();
    return nodes.filter(node => {
      const r = node.getBoundingClientRect();
      return Math.min(innerWidth, panel.right, r.right) - Math.max(0, panel.left, r.left) >= 4 &&
        Math.min(innerHeight, panel.bottom, r.bottom) - Math.max(0, panel.top, r.top) >= 4;
    }).map(node => '#' + node.id);
  }, menu);
  assert.ok(filters.length, `Expected Browse filters under ${menu} at ${page.viewportSize().width}px`);
  for (const filter of filters) await assertMenuOnTop(page, menu, filter);

  if (desktop && menu === '.acct-menu.open') {
    // Reproduce the original Browse layout before adjusting any geometry.
    await assertMenuOnTop(page, menu, '#sortBy');
  }

  // The tall mobile form and shorter Resources menu can put the sort row
  // below the panel. Move only its flow margin, preserving its real stacking context.
  await page.evaluate(menu => {
    const panel = document.querySelector(menu).getBoundingClientRect();
    const sort = document.querySelector('#sortBy').getBoundingClientRect();
    document.querySelector('#litSearchSummary').style.marginTop = (panel.top + panel.height / 2 - sort.top) + 'px';
  }, menu);
  await assertMenuOnTop(page, menu, '#sortBy');
  await page.evaluate(() => document.querySelector('#litSearchSummary').style.removeProperty('margin-top'));

  // Exercise the real expanded filter, including its own stacking context.
  // Align it under the menu without changing positioning, ancestry or z-index.
  for (const id of ['csJType', 'csJournal', 'csYear']) {
    await page.evaluate(({ menu, id }) => {
      toggleDrop(id);
      window.scrollTo(0, 0);
      const panel = document.querySelector(menu).getBoundingClientRect();
      const filter = document.querySelector('#' + id + ' .custom-select-dropdown');
      const box = filter.getBoundingClientRect();
      filter.style.marginTop = (panel.top + panel.height / 2 - box.top) + 'px';
      filter.style.marginLeft = (panel.left + panel.width / 2 - box.left) + 'px';
      filter.style.width = box.width + 'px';
    }, { menu, id });
    await assertMenuOnTop(page, menu, '#' + id + ' .custom-select-search');
  }
}

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome' }); });
after(async () => { await browser?.close(); });

for (const [device, viewport] of [['desktop', { width: 1450, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
  const mobile = device === 'mobile';
  for (const directory of routes) {
    for (const [name, trigger, menu, itemSelector] of [
      ['Account', '.acct-user', '.acct-menu.open', '.acct-menu-item'],
      ['Resources', '.lit-site-nav summary', 'details[open] .lit-resource-links', 'a']
    ]) {
      test(`${device} /lit/${directory} — ${name} menu covers page content`, async () => {
        const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile });
        page.setDefaultTimeout(5000);
        try {
          await loadPage(page, directory);
          const toggle = page.locator(trigger);
          if (mobile) await toggle.tap();
          else await toggle.click();
          const panel = page.locator(menu);
          await panel.waitFor();

          if (directory) {
            await assertMenuOnTop(page, menu, directory === 'analytics/' ? '.wrap' : 'main');
          } else {
            await checkBrowseControls(page, menu, !mobile);
          }
          // Trial interactions check that even items requiring scrolling can
          // receive a pointer or touch event without activating their actions.
          const items = await panel.locator(itemSelector).all();
          assert.ok(items.length, `Expected actions in the ${name} menu`);
          for (const item of items) {
            if (mobile) await item.tap({ trial: true });
            else await item.click({ trial: true });
          }
        } finally {
          await page.close();
        }
      });
    }
  }
}
