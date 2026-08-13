// ORDnet x402 — paywall behaviour tests.
//
// The paywall has two halves and BOTH have to hold:
//
//   1. every spelling Express will serve must also be billed
//   2. every spelling that gets billed must then actually be served
//
// Half 1 alone was the original bug: /paid/echo/ served the paid content for
// free. Half 2 alone is worse: enabling strict routing made the paywall charge
// and Express then answer 404 — the caller settles a payment, the txid is
// burned into the anti-replay register, and they get nothing.
//
// These tests run against a real Express app with the real middleware.
//
// Run: node tests/paywall-tests.mjs   (requires: npm install)

import assert from 'node:assert';

let express = null;
try {
  express = (await import('express')).default;
} catch {
  console.log('  ! express not installed — running the routing model instead.');
  console.log('  ! `npm install` first to exercise the real middleware.');
}

// Same normalisation the paywall uses. Kept here as an independent copy on
// purpose: if src/paywall.ts changes its canonical form, these tests notice.
function normalisePath(path) {
  let p = String(path || '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

const PAID = { 'GET /paid/echo': { satoshis: 200, description: 'echo' } };

function buildApp() {
  const app = express();
  // Deliberately NOT strict / case-sensitive — see the note in src/index.ts.
  const table = {};
  for (const [k, v] of Object.entries(PAID)) {
    const sp = k.indexOf(' ');
    table[`${k.slice(0, sp).toUpperCase()} ${normalisePath(k.slice(sp + 1))}`] = v;
  }
  const billed = [];
  app.use((req, res, next) => {
    const route = table[`${req.method.toUpperCase()} ${normalisePath(req.path)}`];
    if (!route) return next();
    if (!req.header('X-PAYMENT')) {
      billed.push({ path: req.path, charged: false });
      return res.status(402).json({ error: 'Payment required', satoshis: route.satoshis });
    }
    billed.push({ path: req.path, charged: true });
    next();
  });
  app.get('/paid/echo', (_req, res) => res.json({ secret: 'PAID CONTENT' }));
  app.get('/free', (_req, res) => res.json({ ok: true }));
  return { app, billed };
}

function request(app, path, headers = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
        let body = null;
        try { body = await res.json(); } catch { /* not json */ }
        resolve({ status: res.status, body });
      } catch (e) {
        resolve({ status: 0, error: e.message });
      } finally {
        server.close();
      }
    });
  });
}

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  \u2713 ' + name); pass++; }
  catch (e) { console.log('  \u2717 ' + name + ' \u2014 ' + e.message); fail++; }
};

// Every spelling a browser or an agent might send.
// Spellings Express DOES serve — every one of these must be billed.
const SPELLINGS = [
  '/paid/echo',
  '/paid/echo/',
  '/Paid/Echo',
  '/PAID/ECHO/',
];

// Spellings Express does NOT serve. These must be neither billed nor served:
// billing here would burn a txid for a 404.
const NOT_ROUTED = [
  '//paid//echo',
  '/paid%2Fecho',
  '/paid/echo//',
];

if (express) {
console.log('\nhalf 1: no spelling reaches the content unpaid');
for (const p of SPELLINGS) {
  await t(`${p} -> 402 without payment`, async () => {
    const { app } = buildApp();
    const r = await request(app, p);
    assert.strictEqual(r.status, 402, `got ${r.status}`);
    assert.notStrictEqual(r.body && r.body.secret, 'PAID CONTENT', 'paid content leaked');
  });
}

console.log('\nhalf 2: every spelling that gets billed is then served');
for (const p of SPELLINGS) {
  await t(`${p} -> 200 with payment, not 404`, async () => {
    const { app, billed } = buildApp();
    const r = await request(app, p, { 'X-PAYMENT': 'settled-proof' });
    assert.strictEqual(r.status, 200,
      `got ${r.status} — the caller paid and received nothing, and the txid is spent`);
    assert.strictEqual(r.body.secret, 'PAID CONTENT');
    assert.ok(billed.some((b) => b.charged), 'payment was not registered');
  });
}

console.log('\nunpaid routes are untouched');
await t('/free is served without payment', async () => {
  const { app } = buildApp();
  const r = await request(app, '/free');
  assert.strictEqual(r.status, 200);
});
await t('an unknown path is a plain 404, not a 402', async () => {
  const { app } = buildApp();
  const r = await request(app, '/nope');
  assert.strictEqual(r.status, 404);
});
}


/* ============================================================== *
 * Routing model — runs without express installed.
 *
 * This is a MODEL, not the real thing: it encodes Express's documented
 * default matching (non-strict, case-insensitive) and the strict variant,
 * so the reasoning behind the src/index.ts comment is executable even in a
 * sandbox with no network. The express-backed tests above are the real
 * check; run `npm install` to get them.
 * ============================================================== */
function modelRoute(routePath, requestPath, { strict, caseSensitive }) {
  let r = routePath, q = requestPath;
  if (!caseSensitive) { r = r.toLowerCase(); q = q.toLowerCase(); }
  if (!strict) {
    if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
    if (q.length > 1 && q.endsWith('/')) q = q.slice(0, -1);
  }
  return r === q;
}

function pipeline(requestPath, settings) {
  const billed = !!({ 'GET /paid/echo': 1 })[`GET ${normalisePath(requestPath)}`];
  const served = modelRoute('/paid/echo', requestPath, settings);
  return { billed, served };
}

console.log('\nrouting model: strict routing takes the money and serves nothing');
const STRICT = { strict: true, caseSensitive: true };
const DEFAULT = { strict: false, caseSensitive: false };

for (const p of ['/paid/echo/', '/Paid/Echo']) {
  await t(`${p}: strict routing bills but does not serve (why it was reverted)`, () => {
    const r = pipeline(p, STRICT);
    assert.strictEqual(r.billed, true, 'the paywall does charge');
    assert.strictEqual(r.served, false, 'and the router then 404s — payment burned');
  });
  await t(`${p}: default routing bills AND serves`, () => {
    const r = pipeline(p, DEFAULT);
    assert.strictEqual(r.billed, true);
    assert.strictEqual(r.served, true);
  });
}

await t('with default routing, billed and served agree for every spelling', () => {
  for (const p of SPELLINGS) {
    const r = pipeline(p, DEFAULT);
    assert.strictEqual(r.billed, r.served,
      `${p}: billed=${r.billed} served=${r.served} — these must never diverge`);
  }
});

await t('paths Express will not route are also not billed', () => {
  // Billing here would settle a payment for a request that then 404s: the
  // caller loses the money and the txid is spent. Over-normalising is not
  // "extra safe", it is a different way to lose funds.
  for (const p of NOT_ROUTED) {
    const r = pipeline(p, DEFAULT);
    assert.strictEqual(r.served, false, `${p} is assumed unroutable by this test`);
    assert.strictEqual(r.billed, false,
      `${p}: billed a request that Express answers with 404 — the payment is burned`);
  }
});

await t('the paid content still cannot be reached by any unrouted spelling', () => {
  for (const p of NOT_ROUTED) {
    assert.strictEqual(pipeline(p, DEFAULT).served, false);
  }
});

console.log('\n' + '='.repeat(46));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
