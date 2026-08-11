/**
 * BSV layer: watch-only per-invoice address derivation, transaction decode
 * & verification via ORDnet's own node, and settlement (broadcast).
 *
 * Derivation (BRC-42-style, additive tweak):
 *   payTo_i = P_master + SHA256("ordnet-x402" || invoiceId) · G
 * The facilitator holds only the master PUBLIC key. The offline holder of
 * the master private key computes k_i = k_master + SHA256(...) mod n to
 * sweep any invoice address. Every invoice gets a unique, deterministic,
 * unlinkable-looking address without any hot key on this server.
 */
import bsv from 'bsv';
import crypto from 'crypto';
import { CONFIG } from './config.js';
import type { DecodedTx, DecodedVout } from './types.js';

// ============================================================================
// payTo derivation
// ============================================================================

export function deriveInvoiceAddress(invoiceId: string): string {
  if (!CONFIG.masterPubKeyHex) {
    return CONFIG.staticPayTo;
  }
  const master = bsv.PublicKey.fromString(CONFIG.masterPubKeyHex);
  const tweak = crypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from('ordnet-x402', 'utf8'), Buffer.from(invoiceId, 'utf8')]))
    .digest();
  const tweakBn = bsv.crypto.BN.fromBuffer(tweak).mod(bsv.crypto.Point.getN());
  const tweakPoint = bsv.crypto.Point.getG().mul(tweakBn);
  const derivedPoint = master.point.add(tweakPoint);
  const derivedPub = bsv.PublicKey.fromPoint(derivedPoint, true);
  return bsv.Address.fromPublicKey(derivedPub).toString();
}

/** Offline helper (documented for the sweep tool; not used by the server). */
export function deriveInvoicePrivateKey(masterWif: string, invoiceId: string): string {
  const masterKey = bsv.PrivateKey.fromWIF(masterWif);
  const tweak = crypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from('ordnet-x402', 'utf8'), Buffer.from(invoiceId, 'utf8')]))
    .digest();
  const tweakBn = bsv.crypto.BN.fromBuffer(tweak).mod(bsv.crypto.Point.getN());
  const derivedBn = masterKey.bn.add(tweakBn).mod(bsv.crypto.Point.getN());
  return new bsv.PrivateKey(derivedBn).toWIF();
}

// ============================================================================
// Node interaction (via ORDnet's own API → own SV node)
// ============================================================================

export async function decodeTx(rawTx: string): Promise<DecodedTx> {
  const response = await fetch(`${CONFIG.ordnetApi}/v1/bsv/tx/decode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawtx: rawTx })
  });
  if (!response.ok) {
    throw new Error(`decode failed: HTTP ${response.status}`);
  }
  const decoded = await response.json() as DecodedTx;
  if (!decoded || decoded.error || !Array.isArray(decoded.vout)) {
    throw new Error(`transaction could not be decoded by ORDnet's node`);
  }
  return decoded;
}

export async function broadcastTx(rawTx: string): Promise<string> {
  const response = await fetch(`${CONFIG.ordnetApi}/v1/bsv/tx/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawtx: rawTx })
  });
  const body = await response.json() as { txid?: string; error?: string; detail?: string };
  if (!response.ok || !body.txid) {
    // Node rejection is authoritative — surface the honest reason.
    throw new Error(`broadcast rejected: ${body.error ?? 'unknown'}${body.detail ? ` (${body.detail})` : ''}`);
  }
  return body.txid;
}

/** Fetch an already-broadcast tx (mempool or chain) as decoded JSON. */
export async function fetchTx(txid: string): Promise<DecodedTx> {
  const response = await fetch(`${CONFIG.ordnetApi}/v1/bsv/tx/${txid}`);
  if (!response.ok) {
    throw new Error(`tx lookup failed: HTTP ${response.status}`);
  }
  const decoded = await response.json() as DecodedTx & { error?: unknown };
  if (!decoded || decoded.error || !Array.isArray(decoded.vout)) {
    throw new Error(`txid not found on ORDnet's node (not in mempool or chain)`);
  }
  return decoded;
}

// ============================================================================
// Payment verification
// ============================================================================

export interface PaymentCheck {
  paidSats: number;
  payer: string | null;
  txid: string | null;
}

/**
 * Verify that a decoded transaction pays at least `requiredSats` to `payTo`.
 * Sums ALL outputs to payTo (a payment may be split across outputs).
 */
export function checkPayment(decoded: DecodedTx, payTo: string, requiredSats: number): PaymentCheck {
  let paidSats = 0;
  for (const v of (decoded.vout ?? []) as DecodedVout[]) {
    const addr = v.scriptPubKey?.addresses?.[0];
    if (addr === payTo) {
      paidSats += Math.round((v.value ?? 0) * 1e8);
    }
  }
  if (paidSats < requiredSats) {
    throw new Error(`insufficient payment: ${paidSats} sats to ${payTo}, required ${requiredSats}`);
  }
  return { paidSats, payer: null, txid: decoded.txid ?? null };
}
