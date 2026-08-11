/**
 * Offline sweep helper (run manually, NEVER on the facilitator server).
 *
 * The facilitator only ever holds the master PUBLIC key. This tool takes the
 * master PRIVATE key (WIF), reads settled invoices from the x402 database,
 * derives each invoice private key, and prints them so you can sweep the
 * collected sats to a single address with any BSV wallet.
 *
 * Usage:  node dist/sweep.js <master-wif> [db-path]
 */
import Database from 'better-sqlite3';
import { deriveInvoicePrivateKey, deriveInvoiceAddress } from './bsv.js';
import bsv from 'bsv';

const masterWif = process.argv[2];
const dbPath = process.argv[3] || './x402.sqlite';

if (!masterWif) {
  console.error('Usage: node dist/sweep.js <master-wif> [db-path]');
  process.exit(1);
}

// Sanity: does this WIF match the pubkey the server derives against?
process.env.X402_MASTER_PUBKEY = bsv.PrivateKey.fromWIF(masterWif).publicKey.toString();

const db = new Database(dbPath, { readonly: true });
const rows = db.prepare(
  `SELECT invoice_id, satoshis FROM invoices WHERE status = 'settled' ORDER BY created_at`
).all() as Array<{ invoice_id: string; satoshis: number }>;

console.error(`Found ${rows.length} settled invoices.\n`);
let total = 0;
for (const row of rows) {
  const wif = deriveInvoicePrivateKey(masterWif, row.invoice_id);
  const addr = deriveInvoiceAddress(row.invoice_id);
  total += row.satoshis;
  console.log(`${addr}\t${row.satoshis}\t${wif}`);
}
console.error(`\nTotal settled: ${total} sats across ${rows.length} addresses.`);
console.error('Import these WIFs into a wallet and send to your cold address.');
