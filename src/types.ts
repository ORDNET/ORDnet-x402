/**
 * ORDnet x402 Facilitator — core types.
 * Field names follow the x402 V2 specification (coinbase/x402) so that
 * existing x402 SDKs and clients can interoperate with the BSV scheme.
 */

export const X402_VERSION = 2;
export const NETWORK_BSV = 'bsv';
export const SCHEME_EXACT = 'exact';

/** One acceptable way to pay for a resource (402 response, `accepts[]`). */
export interface PaymentRequirements {
  scheme: string;              // 'exact'
  network: string;             // 'bsv'
  maxAmountRequired: string;   // amount in atomic units (satoshis), stringified per spec
  resource: string;            // URL of the paid resource
  description: string;
  mimeType: string;
  payTo: string;               // BSV address (per-invoice derived when master pubkey configured)
  maxTimeoutSeconds: number;   // how long the quote/invoice is valid
  asset: string;               // 'BSV' (native satoshis)
  extra: {
    invoiceId: string;         // unique invoice id — anti-replay anchor
    opReturnHint?: string;     // clients MAY include this in an OP_RETURN output
    ordx402?: import('./ordx402.js').OrdxEnvelope;  // v1.1: on-chain administration envelope
  };
}

/** Body of the HTTP 402 response. */
export interface PaymentRequiredResponse {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
}

/** What the client sends back (X-PAYMENT header, Base64-encoded JSON). */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    /** Preferred: client-signed raw transaction hex; the facilitator broadcasts (settles) it. */
    rawTx?: string;
    /** Alternative: txid of an already-broadcast payment. */
    txid?: string;
    invoiceId: string;
  };
}

/** POST /verify request & response (facilitator interface). */
export interface VerifyRequest {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string | null;
}

/** POST /settle request & response (facilitator interface). */
export type SettleRequest = VerifyRequest;
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction: string;   // txid
  network: string;       // 'bsv'
  payer?: string | null;
}

/** Receipt returned to the client in the X-PAYMENT-RESPONSE header. */
export interface PaymentReceipt {
  success: boolean;
  transaction: string;
  network: string;
  invoiceId: string;
  satoshis: number;
  settledAt: string;     // ISO timestamp
}

/** Decoded transaction shape from api.ordnet.io /v1/bsv/tx/decode. */
export interface DecodedVout {
  value?: number;
  n?: number;
  scriptPubKey?: { type?: string; addresses?: string[]; asm?: string; hex?: string };
}
export interface DecodedTx {
  txid?: string;
  size?: number;
  vin?: unknown[];
  vout?: DecodedVout[];
  error?: unknown;
}

/** Bazaar-compatible discovery metadata (CDP extension shape). */
export interface DiscoveryResource {
  resource: string;
  type: 'http';
  x402Version: number;
  accepts: PaymentRequirements[];
  lastUpdated: string;
  metadata: {
    name: string;
    description: string;
    category: string;
    provider: string;
  };
}
