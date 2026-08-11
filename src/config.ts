/** ORDnet x402 Facilitator — configuration (all overridable via env). */

export const CONFIG = {
  port: parseInt(process.env.PORT || '7001', 10),

  /** ORDnet's own API (decode + broadcast via own SV node). */
  ordnetApi: process.env.ORDNET_API_URL || 'https://api.ordnet.io',

  /** ORDnet's own address/UTXO index (ordnet-utxo). */
  utxoIndex: process.env.ORDNET_UTXO_URL || 'http://127.0.0.1:7002',

  /**
   * Per-invoice payTo derivation (BRC-42-style, watch-only):
   * payTo_i = masterPubKey + SHA256(invoiceId)·G
   * The facilitator only ever holds the master PUBLIC key; the private
   * counterpart stays offline and can sweep all invoice addresses later.
   * Falls back to X402_PAYTO_ADDRESS (static) when no pubkey is set.
   */
  masterPubKeyHex: process.env.X402_MASTER_PUBKEY || '',
  staticPayTo: process.env.X402_PAYTO_ADDRESS || '',

  /** Invoice validity window. */
  invoiceTimeoutSeconds: parseInt(process.env.X402_INVOICE_TIMEOUT || '600', 10),

  /** SQLite location (anti-replay register + invoices). */
  dbPath: process.env.X402_DB_PATH || './x402.sqlite',

  /** Public base URL of this facilitator (for discovery metadata). */
  publicUrl: process.env.X402_PUBLIC_URL || 'https://x402.ordnet.io'
} as const;

export function assertConfig(): void {
  if (!CONFIG.masterPubKeyHex && !CONFIG.staticPayTo) {
    console.error(
      'FATAL: set X402_MASTER_PUBKEY (preferred, watch-only per-invoice addresses) ' +
      'or X402_PAYTO_ADDRESS (static fallback).'
    );
    process.exit(1);
  }
}
