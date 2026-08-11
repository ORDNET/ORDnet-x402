/**
 * Persistent store: invoices + anti-replay register.
 * A payment txid may unlock a resource exactly once — the register makes
 * replay attempts fail closed, surviving restarts (SQLite, WAL mode).
 */
import Database from 'better-sqlite3';
import { CONFIG } from './config.js';

const db = new Database(CONFIG.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS invoices (
  invoice_id TEXT PRIMARY KEY,
  resource   TEXT NOT NULL,
  pay_to     TEXT NOT NULL,
  satoshis   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open'   -- open | settled | expired
);
CREATE TABLE IF NOT EXISTS settlements (
  txid       TEXT PRIMARY KEY,              -- anti-replay: one txid, one unlock
  invoice_id TEXT NOT NULL,
  satoshis   INTEGER NOT NULL,
  payer      TEXT,
  settled_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, expires_at);
`);

export interface InvoiceRow {
  invoice_id: string;
  resource: string;
  pay_to: string;
  satoshis: number;
  created_at: number;
  expires_at: number;
  status: string;
}

const insertInvoice = db.prepare(
  `INSERT INTO invoices (invoice_id, resource, pay_to, satoshis, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const getInvoiceStmt = db.prepare(`SELECT * FROM invoices WHERE invoice_id = ?`);
const settleInvoiceStmt = db.prepare(`UPDATE invoices SET status = 'settled' WHERE invoice_id = ?`);
const getSettlementStmt = db.prepare(`SELECT * FROM settlements WHERE txid = ?`);
const insertSettlement = db.prepare(
  `INSERT INTO settlements (txid, invoice_id, satoshis, payer, settled_at) VALUES (?, ?, ?, ?, ?)`
);

export function createInvoice(invoiceId: string, resource: string, payTo: string, satoshis: number): InvoiceRow {
  const now = Math.floor(Date.now() / 1000);
  insertInvoice.run(invoiceId, resource, payTo, satoshis, now, now + CONFIG.invoiceTimeoutSeconds);
  return getInvoice(invoiceId)!;
}

export function getInvoice(invoiceId: string): InvoiceRow | null {
  return (getInvoiceStmt.get(invoiceId) as InvoiceRow | undefined) ?? null;
}

export function isReplayed(txid: string): boolean {
  return getSettlementStmt.get(txid) !== undefined;
}

/**
 * Atomically record a settlement: rejects on replayed txid (PRIMARY KEY)
 * and marks the invoice settled in the same transaction.
 */
export const recordSettlement = db.transaction(
  (txid: string, invoiceId: string, satoshis: number, payer: string | null) => {
    insertSettlement.run(txid, invoiceId, satoshis, payer, Math.floor(Date.now() / 1000));
    settleInvoiceStmt.run(invoiceId);
  }
);

export function stats(): { invoices: number; settlements: number; satsSettled: number } {
  const inv = db.prepare(`SELECT COUNT(*) c FROM invoices`).get() as { c: number };
  const set = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(satoshis),0) s FROM settlements`).get() as { c: number; s: number };
  return { invoices: inv.c, settlements: set.c, satsSettled: set.s };
}

// ============================================================================
// Console queries (v1.1)
// ============================================================================
export function listSettlements(limit: number = 50, offset: number = 0): unknown[] {
  return db.prepare(
    `SELECT s.txid, s.invoice_id, s.satoshis, s.settled_at, i.resource, i.pay_to
     FROM settlements s LEFT JOIN invoices i ON i.invoice_id = s.invoice_id
     ORDER BY s.settled_at DESC LIMIT ? OFFSET ?`
  ).all(Math.min(limit, 200), offset);
}

export function settlementDetail(invoiceId: string): unknown | null {
  return db.prepare(
    `SELECT s.txid, s.invoice_id, s.satoshis, s.settled_at, s.payer, i.resource, i.pay_to, i.created_at, i.expires_at
     FROM settlements s LEFT JOIN invoices i ON i.invoice_id = s.invoice_id
     WHERE s.invoice_id = ?`
  ).get(invoiceId) ?? null;
}

export function dailyTotals(days: number = 14): unknown[] {
  return db.prepare(
    `SELECT date(settled_at, 'unixepoch') d, COUNT(*) n, SUM(satoshis) sats
     FROM settlements WHERE settled_at > unixepoch() - ? * 86400
     GROUP BY d ORDER BY d`
  ).all(days);
}

export function perResourceTotals(): unknown[] {
  return db.prepare(
    `SELECT i.resource, COUNT(*) n, SUM(s.satoshis) sats
     FROM settlements s LEFT JOIN invoices i ON i.invoice_id = s.invoice_id
     GROUP BY i.resource ORDER BY sats DESC`
  ).all();
}
