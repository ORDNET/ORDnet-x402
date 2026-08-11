/**
 * Facilitator core: the x402 V2 /verify and /settle logic for the
 * "exact" scheme on network "bsv" (native satoshis).
 *
 * verify  = dry-run: is this payment payload valid for these requirements?
 * settle  = verify + make it real: broadcast (rawTx) or confirm presence
 *           (txid) via ORDnet's own node, then record it in the anti-replay
 *           register. One txid unlocks exactly one invoice, exactly once.
 */
import {
  NETWORK_BSV, SCHEME_EXACT, X402_VERSION,
  PaymentPayload, PaymentRequirements, VerifyResponse, SettleResponse, DecodedTx
} from './types.js';
import { decodeTx, fetchTx, broadcastTx, checkPayment } from './bsv.js';
import { getInvoice, isReplayed, recordSettlement } from './store.js';

interface ValidatedPayment {
  decoded: DecodedTx;
  rawTx: string | null;
  txid: string | null;
  requiredSats: number;
  payTo: string;
  invoiceId: string;
}

async function validate(
  payload: PaymentPayload,
  requirements: PaymentRequirements
): Promise<ValidatedPayment> {
  if (payload.x402Version !== X402_VERSION) {
    throw new Error(`unsupported x402 version: ${payload.x402Version}`);
  }
  if (payload.scheme !== SCHEME_EXACT || payload.network !== NETWORK_BSV) {
    throw new Error(`unsupported scheme/network: ${payload.scheme}/${payload.network} (this facilitator speaks exact/bsv)`);
  }

  const invoiceId = payload.payload?.invoiceId;
  if (!invoiceId || invoiceId !== requirements.extra?.invoiceId) {
    throw new Error('invoiceId missing or does not match payment requirements');
  }

  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error('unknown invoice');
  if (invoice.status === 'settled') throw new Error('invoice already settled');
  if (invoice.expires_at < Math.floor(Date.now() / 1000)) throw new Error('invoice expired');
  if (invoice.pay_to !== requirements.payTo) throw new Error('payTo mismatch between invoice and requirements');

  const requiredSats = parseInt(requirements.maxAmountRequired, 10);
  if (!Number.isFinite(requiredSats) || requiredSats < 1 || requiredSats !== invoice.satoshis) {
    throw new Error('amount mismatch between invoice and requirements');
  }

  const rawTx = payload.payload.rawTx ?? null;
  const givenTxid = payload.payload.txid ?? null;
  if (!rawTx && !givenTxid) throw new Error('payment payload must contain rawTx or txid');
  if (rawTx && !/^[0-9a-fA-F]+$/.test(rawTx)) throw new Error('rawTx is not valid hex');
  if (givenTxid && !/^[0-9a-fA-F]{64}$/.test(givenTxid)) throw new Error('txid is not valid');

  // Decode via ORDnet's own node — the node is the source of truth.
  const decoded = rawTx ? await decodeTx(rawTx) : await fetchTx(givenTxid!);

  const txid = decoded.txid ?? givenTxid;
  if (txid && isReplayed(txid)) throw new Error('replay rejected: this txid already unlocked a resource');

  // The actual money check: enough sats to the invoice's payTo address.
  checkPayment(decoded, invoice.pay_to, requiredSats);

  return { decoded, rawTx, txid: txid ?? null, requiredSats, payTo: invoice.pay_to, invoiceId };
}

export async function verify(
  payload: PaymentPayload,
  requirements: PaymentRequirements
): Promise<VerifyResponse> {
  try {
    await validate(payload, requirements);
    return { isValid: true, payer: null };
  } catch (error) {
    return { isValid: false, invalidReason: error instanceof Error ? error.message : 'verification failed' };
  }
}

export async function settle(
  payload: PaymentPayload,
  requirements: PaymentRequirements
): Promise<SettleResponse> {
  try {
    const v = await validate(payload, requirements);

    let txid: string;
    if (v.rawTx) {
      // Facilitator settles: broadcast via ORDnet's own node. A rejection is final.
      txid = await broadcastTx(v.rawTx);
    } else {
      // Already broadcast by the payer; fetchTx in validate() proved the node knows it.
      txid = v.txid!;
    }

    // Atomic anti-replay: throws on duplicate txid (PRIMARY KEY).
    recordSettlement(txid, v.invoiceId, v.requiredSats, null);

    return { success: true, transaction: txid, network: NETWORK_BSV, payer: null };
  } catch (error) {
    return {
      success: false,
      errorReason: error instanceof Error ? error.message : 'settlement failed',
      transaction: '',
      network: NETWORK_BSV
    };
  }
}
