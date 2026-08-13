# Security fixes — ORDnet x402 v1.2.0

**Audit:** external GitHub review of 13 August 2026
**Supersedes:** v1.1.0

## The paywall was bypassable with a trailing slash

Reproduced against express@4:

```
/paid/echo   -> 402 {"need":"payment"}
/paid/echo/  -> 200 {"secret":"FREE CONTENT"}
/Paid/Echo   -> 200 {"secret":"FREE CONTENT"}
```

`paywall()` looked up `req.method + ' ' + req.path` in a plain object and called
`next()` on a miss. Express matches routes non-strictly and case-insensitively
by default, so the route still served — it just never passed the paywall. Paid
content was free to anyone who added a slash.

**Now, in two layers:**

1. `normalisePath()` canonicalises before the lookup: collapses repeated
   slashes, strips a trailing slash, decodes percent-escapes where that is
   safe, lowercases. The route table is built with the same function, so
   `PAID_ROUTES` stays readable.
2. `strict routing` and `case sensitive routing` are switched on in the app, so
   Express itself stops treating those spellings as the same route.

Eight variants verified closed, including `%2F` and doubled slashes.

## Still open

The review also flagged, and this release does **not** fix:

- the systemd unit runs as **root** with no hardening and reads a `.env`
  containing `X402_ADMIN_TOKEN` as root
- `sweep.ts` sets its environment variable *after* the imports, so
  `CONFIG.masterPubKeyHex` is empty and the tool prints blank addresses
- `sweep.ts` only sweeps `status='settled'`, so funds on invoices whose settle
  failed are unreachable

These need decisions about deployment and operational behaviour rather than a
one-line patch, and are tracked as issues.
