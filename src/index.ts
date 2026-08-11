/**
 * ORDnet x402 Facilitator — HTTP 402 payments in native BSV satoshis,
 * verified and settled on ORDnet's OWN node and address index.
 *
 * Endpoints:
 *   GET  /health              — status + settlement stats
 *   POST /verify              — x402 V2 facilitator interface (dry-run)
 *   POST /settle              — x402 V2 facilitator interface (broadcast + register)
 *   GET  /discovery/resources — Bazaar-compatible catalog of paid resources
 *   GET  /paid/echo           — demo paid endpoint (10 sats)
 *   GET  /paid/chaininfo      — demo paid endpoint (25 sats, live chain info)
 */
import express from 'express';
import { consoleRouter } from './console.js';
import { CONFIG, assertConfig } from './config.js';
import { X402_VERSION, VerifyRequest, SettleRequest, DiscoveryResource } from './types.js';
import { verify, settle } from './facilitator.js';
import { paywall, PaywallConfig } from './paywall.js';
import { stats } from './store.js';

assertConfig();

const app = express();
app.use(consoleRouter());
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// ============================================================================
// Facilitator interface (x402 V2)
// ============================================================================

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ordnet-x402', version: '1.1.0', network: 'bsv', ...stats() });
});

app.post('/verify', async (req, res) => {
  const body = req.body as VerifyRequest;
  if (!body?.paymentPayload || !body?.paymentRequirements) {
    res.status(400).json({ error: 'expected { x402Version, paymentPayload, paymentRequirements }' });
    return;
  }
  res.json(await verify(body.paymentPayload, body.paymentRequirements));
});

app.post('/settle', async (req, res) => {
  const body = req.body as SettleRequest;
  if (!body?.paymentPayload || !body?.paymentRequirements) {
    res.status(400).json({ error: 'expected { x402Version, paymentPayload, paymentRequirements }' });
    return;
  }
  res.json(await settle(body.paymentPayload, body.paymentRequirements));
});

// ============================================================================
// Demo paid endpoints (living proof, also the paywall reference usage)
// ============================================================================

const PAID_ROUTES: PaywallConfig = {
  'GET /paid/echo': { satoshis: 10, description: 'Echo service — returns your query, proves the 402 flow end-to-end' },
  'GET /paid/chaininfo': { satoshis: 25, description: 'Live BSV chain info straight from ORDnet\'s own node' }
};

app.use(paywall(PAID_ROUTES));

app.get('/paid/echo', (req, res) => {
  res.json({ echo: req.query, paidWith: (req as express.Request & { x402Receipt?: unknown }).x402Receipt });
});

app.get('/paid/chaininfo', async (_req, res) => {
  try {
    const r = await fetch(`${CONFIG.ordnetApi}/v1/bsv/chain/info`);
    res.json(await r.json());
  } catch {
    res.status(502).json({ error: 'chain info unavailable' });
  }
});

// ============================================================================
// Discovery (Bazaar-compatible catalog)
// ============================================================================

app.get('/discovery/resources', (_req, res) => {
  const resources: DiscoveryResource[] = Object.entries(PAID_ROUTES).map(([key, route]) => {
    const [, path] = key.split(' ');
    return {
      resource: `${CONFIG.publicUrl}${path}`,
      type: 'http',
      x402Version: X402_VERSION,
      accepts: [{
        scheme: 'exact',
        network: 'bsv',
        maxAmountRequired: String(route.satoshis),
        resource: `${CONFIG.publicUrl}${path}`,
        description: route.description,
        mimeType: 'application/json',
        payTo: 'per-invoice (request the resource for a fresh quote)',
        maxTimeoutSeconds: CONFIG.invoiceTimeoutSeconds,
        asset: 'BSV',
        extra: { invoiceId: 'per-invoice' }
      }],
      lastUpdated: new Date().toISOString(),
      metadata: {
        name: key,
        description: route.description,
        category: 'blockchain',
        provider: 'ORDnet.io / Mister HHC B.V.'
      }
    };
  });
  res.json({ x402Version: X402_VERSION, resources });
});

app.listen(CONFIG.port, '127.0.0.1', () => {
  console.error(
    `ORDnet x402 Facilitator v1.0 on http://127.0.0.1:${CONFIG.port} — ` +
    `exact/bsv, payTo: ${CONFIG.masterPubKeyHex ? 'per-invoice (watch-only derivation)' : 'static'}`
  );
});
