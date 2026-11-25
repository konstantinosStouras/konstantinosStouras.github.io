// Run with Node, playwright-core and an installed Google Chrome.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright-core');

const browse = 'http://lit.test/lit/';
const root = path.join(__dirname, '..', 'lit');

// Load the actual Browse page and its local assets. A signed-in fixture exercises
// the full account menu without contacting Firebase or downloading the catalogue.
async function loadBrowse(page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href === browse) return route.fulfill({ path: path.join(root, 'index.html'), contentType: 'text/html' });
    if (url.origin === new URL(browse).origin && /^\/lit\/[\w-]+\.(js|css)$/.test(url.pathname)) {
      return route.fulfill({ path: path.join(root, path.basename(url.pathname)) });
    }
    return route.abort();
  });
  await page.addInitScript(() => {
    const user = { uid: 'menu-fixture', email: 'reader@example.org', displayName: 'Literature Reader' };
    localStorage.setItem('litProfHint', JSON.stringify({ u: user.uid, ol: true, n: user.displayName, pc: 3 }));
    const auth = { onAuthStateChanged: callback => setTimeout(() => callback(user), 0) };
    const ref = {
      doc: () => ref, collection: () => ref, onSnapshot: () => () => {},
      get: async () => ({ exists: false }), set: async () => {}
    };
    window.firebase = { initializeApp: () => ({}), auth: () => auth, firestore: () => ref };
  });
  await page.goto(browse);
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

async function checkMenu(page, trigger, menu, desktop) {
  await page.locator(trigger).click();
  await page.locator(menu).waitFor();
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

  if (desktop && menu === '#acctMenu.open') {
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
  for (const [name, trigger, menu] of [
    ['Account', '.acct-user', '#acctMenu.open'],
    ['Resources', '.lit-site-nav summary', 'details[open] .lit-resource-links']
  ]) {
    test(`${device}: ${name} covers the Year sort control and Browse filters`, async () => {
      const mobile = device === 'mobile';
      const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile });
      try {
        await loadBrowse(page);
        await checkMenu(page, trigger, menu, !mobile);
      } finally {
        await page.close();
      }
    });
  }
}
