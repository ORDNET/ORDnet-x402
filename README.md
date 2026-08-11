# ORDnet x402 Facilitator

HTTP 402 payments in **native BSV satoshis**, verified and settled on
ORDnet's **own SV node** and address index — no third-party facilitator, no
stablecoin, true sub-cent micropayments.

Implements the [x402 V2](https://github.com/coinbase/x402) facilitator
interface (`/verify`, `/settle`) with an `exact` scheme on network `bsv`, so
existing x402 clients and SDKs interoperate. Runs on `127.0.0.1:7001` behind
nginx as `x402.ordnet.io`.

## Why this one is different

- **Own-node settlement** — verification and broadcast go through
  api.ordnet.io → ORDnet's own SV node. A node rejection is authoritative.
- **Native sats** — BSV fees make `$0.0001`-per-call economically real, where
  USDC-on-Base bottoms out around a tenth of a cent.
- **Watch-only per-invoice addresses** — BRC-42-style additive derivation:
  the server holds only the master **public** key and issues a unique
  `payTo` per invoice. No hot key on the internet-facing box; sweep offline.
- **Anti-replay** — every settlement txid unlocks exactly one invoice, once,
  in a crash-safe SQLite register.
- **Bazaar-compatible discovery** — `/discovery/resources` follows the CDP
  extension shape so ORDnet endpoints can surface in x402 discovery layers.

## The flow

1. Client requests a paid resource with no `X-PAYMENT` header.
2. Server responds **402** with a `PaymentRequired` object: amount in sats, a
   fresh per-invoice `payTo`, an `invoiceId`, and an `opReturnHint`.
3. Client builds and signs a BSV tx paying `payTo`, then retries with the
   Base64 `X-PAYMENT` header (`rawTx` + `invoiceId`).
4. Server settles: broadcasts via its own node, records the txid against the
   invoice (anti-replay), returns the resource + an `X-PAYMENT-RESPONSE`
   receipt.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | status + settlement stats |
| `POST /verify` | x402 V2 dry-run (no broadcast) |
| `POST /settle` | x402 V2 verify + broadcast + register |
| `GET /discovery/resources` | Bazaar-compatible catalog |
| `GET /paid/echo` | demo paid endpoint (10 sats) |
| `GET /paid/chaininfo` | demo paid endpoint (25 sats) |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `X402_MASTER_PUBKEY` | one of these two | Master **public** key (hex) for watch-only per-invoice `payTo` derivation. Preferred. |
| `X402_PAYTO_ADDRESS` | one of these two | Static fallback address when no master pubkey is set. |
| `PORT` | no | Listen port (default 7001). |
| `ORDNET_API_URL` | no | ORDnet API base (default `https://api.ordnet.io`). |
| `ORDNET_UTXO_URL` | no | ORDnet UTXO index (default `http://127.0.0.1:7002`). |
| `X402_INVOICE_TIMEOUT` | no | Invoice validity in seconds (default 600). |
| `X402_DB_PATH` | no | SQLite path (default `./x402.sqlite`). |
| `X402_PUBLIC_URL` | no | Public base URL for discovery metadata (default `https://x402.ordnet.io`). |

## Build & run

```
npm install && npm run build
X402_MASTER_PUBKEY=<hex> node dist/index.js
```

## Sweeping collected payments (offline)

The server never holds a private key. To collect settled sats, run the sweep
helper on an **offline** machine with the master WIF:

```
node dist/sweep.js <master-wif> /path/to/x402.sqlite
```

It prints `address  satoshis  wif` per settled invoice; import the WIFs into
a wallet and send to your cold address.

## Roadmap

- Mempool-aware 0-conf acceptance (instant settle) via ordnet-utxo.
- x402 payment as an alternative to the bearer token on mcp.ordnet.io.
- Registering ORDnet endpoints in public x402 discovery layers.

## License

MIT © ORDnet / ODNCA
