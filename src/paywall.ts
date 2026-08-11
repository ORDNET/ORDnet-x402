/**
 * x402 paywall middleware for express.
 *
 * Usage:
 *   app.use(paywall({
 *     'GET /paid/echo': { satoshis: 10, description: 'Echo service' }
 *   }));
 *
 * Flow (x402 V2):
 *  - no X-PAYMENT header  → HTTP 402 + PaymentRequired JSON (also Base64 in
 *    the PAYMENT-REQUIRED header) with a fresh per-invoice payTo address
 *  - X-PAYMENT present    → settle() against the invoice; on success the
 *    request proceeds and the receipt travels in X-PAYMENT-RESPONSE
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import {
  X402_VERSION, NETWORK_BSV, SCHEME_EXACT,
  PaymentRequirements, PaymentRequiredResponse, PaymentPayload, PaymentReceipt
} from './types.js';
import { CONFIG } from './config.js';
import { buildEnvelope } from './ordx402.js';
import { deriveInvoiceAddress } from './bsv.js';
import { createInvoice } from './store.js';
import { settle } from './facilitator.js';

export interface PaywallRoute {
  satoshis: number;
  description: string;
  mimeType?: string;
}
export type PaywallConfig = Record<string, PaywallRoute>;

function buildRequirements(resource: string, route: PaywallRoute): PaymentRequirements {
  const invoiceId = crypto.randomUUID();
  const payTo = deriveInvoiceAddress(invoiceId);
  createInvoice(invoiceId, resource, payTo, route.satoshis);
  return {
    scheme: SCHEME_EXACT,
    network: NETWORK_BSV,
    maxAmountRequired: String(route.satoshis),
    resource,
    description: route.description,
    mimeType: route.mimeType ?? 'application/json',
    payTo,
    maxTimeoutSeconds: CONFIG.invoiceTimeoutSeconds,
    asset: 'BSV',
    extra: {
      invoiceId,
      opReturnHint: `x402:${invoiceId}`,
      // ORDX402 v0.1: the on-chain administration envelope. Clients that
      // understand it write these pushdata arrays as OP_RETURN outputs in
      // the payment tx; clients that don't simply use opReturnHint.
      ordx402: buildEnvelope({
        invoiceId, resource, satoshis: route.satoshis,
        scheme: SCHEME_EXACT, network: NETWORK_BSV,
        memo: route.description
      })
    }
  };
}

export function paywall(routes: PaywallConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.method} ${req.path}`;
    const route = routes[key];
    if (!route) return next(); // not a paid route

    const resourceUrl = `${CONFIG.publicUrl}${req.path}`;
    const paymentHeader = req.header('X-PAYMENT');

    if (!paymentHeader) {
      const requirements = buildRequirements(resourceUrl, route);
      const body: PaymentRequiredResponse = {
        x402Version: X402_VERSION,
        error: 'Payment required',
        accepts: [requirements]
      };
      res.status(402)
        .header('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(body)).toString('base64'))
        .json(body);
      return;
    }

    // Payment attached — parse and settle.
    let payload: PaymentPayload;
    try {
      payload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8')) as PaymentPayload;
    } catch {
      res.status(400).json({ error: 'X-PAYMENT header is not valid base64 JSON' });
      return;
    }

    const invoiceId = payload.payload?.invoiceId;
    if (!invoiceId) {
      res.status(400).json({ error: 'payment payload is missing invoiceId' });
      return;
    }

    // Rebuild the requirements the invoice was issued with (from the store).
    const { getInvoice } = await import('./store.js');
    const invoice = getInvoice(invoiceId);
    if (!invoice) {
      res.status(400).json({ error: 'unknown invoice — request the resource without X-PAYMENT to get a fresh quote' });
      return;
    }
    const requirements: PaymentRequirements = {
      scheme: SCHEME_EXACT,
      network: NETWORK_BSV,
      maxAmountRequired: String(invoice.satoshis),
      resource: invoice.resource,
      description: route.description,
      mimeType: route.mimeType ?? 'application/json',
      payTo: invoice.pay_to,
      maxTimeoutSeconds: CONFIG.invoiceTimeoutSeconds,
      asset: 'BSV',
      extra: { invoiceId }
    };

    const result = await settle(payload, requirements);
    if (!result.success) {
      res.status(402).json({ x402Version: X402_VERSION, error: `Payment failed: ${result.errorReason}`, accepts: [requirements] });
      return;
    }

    const receipt: PaymentReceipt = {
      success: true,
      transaction: result.transaction,
      network: NETWORK_BSV,
      invoiceId,
      satoshis: invoice.satoshis,
      settledAt: new Date().toISOString()
    };
    res.header('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify(receipt)).toString('base64'));
    (req as Request & { x402Receipt?: PaymentReceipt }).x402Receipt = receipt;
    next();
  };
}
