/**
 * ORDX402 envelope (v0.1) — the on-chain administration layer.
 *
 * OPR#1 layout (pushdata fields in one OP_RETURN script):
 *   "ORDX402" | version("01") | commitment(32b merkle root) |
 *   connector_count(1b) | encrypted_payload
 *
 * Public fields: tag, version, commitment, connector_count — enough to find
 * and verify ORDX402 transactions on-chain without revealing content.
 * The payload (invoiceId, resource, amount, timestamp, memo) is encrypted
 * with AES-256-GCM under ORDX402_KEY (v0.1: one server key; per-connector
 * BRC-42 keys arrive in F5 of the design doc).
 *
 * Connector OPRs (#2+) each carry: "ORDX402C" | slot-name | encrypted body.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { CONFIG } from './config.js';

export const ORDX_TAG = 'ORDX402';
export const ORDX_CONNECTOR_TAG = 'ORDX402C';
export const ORDX_VERSION = '01';

function sha256(b: Buffer): Buffer { return createHash('sha256').update(b).digest(); }

function ordxKey(): Buffer | null {
  const hex = process.env.ORDX402_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

export function encryptPayload(obj: unknown): Buffer {
  const key = ordxKey();
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  if (!key) return plain; // no key configured -> plain (operator's explicit choice)
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from('ENC1'), iv, cipher.getAuthTag(), enc]);
}

export function decryptPayload(buf: Buffer): { encrypted: boolean; data: unknown | null } {
  if (buf.subarray(0, 4).toString() !== 'ENC1') {
    try { return { encrypted: false, data: JSON.parse(buf.toString('utf8')) }; }
    catch { return { encrypted: false, data: null }; }
  }
  const key = ordxKey();
  if (!key) return { encrypted: true, data: null };
  try {
    const iv = buf.subarray(4, 16);
    const tag = buf.subarray(16, 32);
    const enc = buf.subarray(32);
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(enc), d.final()]);
    return { encrypted: true, data: JSON.parse(plain.toString('utf8')) };
  } catch { return { encrypted: true, data: null }; }
}

/** Merkle root over the connector payload hashes (empty -> hash of empty). */
export function commitmentRoot(connectorPayloads: Buffer[]): Buffer {
  if (connectorPayloads.length === 0) return sha256(Buffer.alloc(0));
  let level = connectorPayloads.map(sha256);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? a;
      next.push(sha256(Buffer.concat([a, b])));
    }
    level = next;
  }
  return level[0];
}

export interface OrdxEnvelopeInput {
  invoiceId: string;
  resource: string;
  satoshis: number;
  scheme: string;
  network: string;
  memo?: string;
  connectors?: Array<{ slot: string; body: unknown }>;
}

export interface OrdxEnvelope {
  /** hex-encoded pushdata arrays, one entry per OP_RETURN output; index 0 is OPR#1 */
  oprs: string[][];
  commitment: string;
  connectorCount: number;
}

/** Build OPR#1 + connector OPRs as pushdata-hex arrays for the payment tx. */
export function buildEnvelope(input: OrdxEnvelopeInput): OrdxEnvelope {
  const connectors = input.connectors ?? [];
  const connectorBodies = connectors.map(c => encryptPayload(c.body));
  const root = commitmentRoot(connectorBodies);

  const payload = encryptPayload({
    invoiceId: input.invoiceId,
    resource: input.resource,
    satoshis: input.satoshis,
    scheme: input.scheme,
    network: input.network,
    ts: Math.floor(Date.now() / 1000),
    facilitator: CONFIG.publicUrl,
    memo: input.memo ?? null
  });

  const opr1 = [
    Buffer.from(ORDX_TAG, 'utf8').toString('hex'),
    Buffer.from(ORDX_VERSION, 'utf8').toString('hex'),
    root.toString('hex'),
    Buffer.from([connectors.length]).toString('hex'),
    payload.toString('hex')
  ];

  const rest = connectors.map((c, i) => [
    Buffer.from(ORDX_CONNECTOR_TAG, 'utf8').toString('hex'),
    Buffer.from(c.slot, 'utf8').toString('hex'),
    connectorBodies[i].toString('hex')
  ]);

  return { oprs: [opr1, ...rest], commitment: root.toString('hex'), connectorCount: connectors.length };
}

/** Parse pushdata-hex arrays back into a readable envelope (for decode/verify). */
export function parseEnvelope(oprs: string[][]): {
  valid: boolean; version?: string; commitment?: string; connectorCount?: number;
  payload?: { encrypted: boolean; data: unknown | null };
  connectors?: Array<{ slot: string; encrypted: boolean; data: unknown | null }>;
  commitmentMatches?: boolean; error?: string;
} {
  try {
    const first = oprs[0];
    if (!first || Buffer.from(first[0], 'hex').toString() !== ORDX_TAG) {
      return { valid: false, error: 'no ORDX402 tag in first OP_RETURN' };
    }
    const version = Buffer.from(first[1], 'hex').toString();
    const commitment = first[2];
    const connectorCount = Buffer.from(first[3], 'hex')[0];
    const payload = decryptPayload(Buffer.from(first[4], 'hex'));

    const bodies: Buffer[] = [];
    const connectors = oprs.slice(1)
      .filter(p => Buffer.from(p[0], 'hex').toString() === ORDX_CONNECTOR_TAG)
      .map(p => {
        const body = Buffer.from(p[2], 'hex');
        bodies.push(body);
        return { slot: Buffer.from(p[1], 'hex').toString(), ...decryptPayload(body) };
      });

    const commitmentMatches = commitmentRoot(bodies).toString('hex') === commitment;
    return { valid: true, version, commitment, connectorCount, payload, connectors, commitmentMatches };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'parse failed' };
  }
}
