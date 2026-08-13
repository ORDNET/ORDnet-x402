# Changelog — ORDnet x402 Facilitator

All notable changes to the ORDnet x402 facilitator.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> History before 1.2.0 predates this changelog; 1.0.0 was the initial
> facilitator and 1.1.0 added watch-only per-invoice address derivation.

---

## [1.2.1] — 2026-08-13 — audit round 3

### Fixed

- **Strict routing collected the payment and then served a 404.** Turning on
  `strict routing` / `case sensitive routing` in 1.2.0 closed the paywall
  bypass, but a request billed under one spelling could then miss the route
  under the same strictness — the client paid and got nothing. Routing and
  paywall now agree on one canonical spelling: every routable spelling is
  billed, and every billed request is served.
- Version alignment: `/health` and the startup banner now report the
  `package.json` version instead of stale hardcoded strings.

### Tests

- The paywall suite runs end to end against real express middleware
  (17 tests), asserting both halves: every routable spelling is billed, and
  every billed request is then served rather than 404'd. The suite runs in CI
  on every push.

## [1.2.0] — 2026-08-13 — external security audit

External review of 13 August 2026. Full detail in
[SECURITY-FIXES-v1.2.0.md](SECURITY-FIXES-v1.2.0.md).

### Security

- **The paywall was bypassable with a trailing slash.** `paywall()` looked up
  `req.method + ' ' + req.path` in a plain object and called `next()` on a
  miss, while express matched routes non-strictly and case-insensitively —
  `/paid/echo/` and `/Paid/Echo` served paid content for free. Fixed in two
  layers: `normalisePath()` canonicalises before the lookup (collapses
  repeated slashes, strips a trailing slash, decodes safe percent-escapes,
  lowercases; the route table is built with the same function), and
  `strict routing` plus `case sensitive routing` are switched on so express
  itself stops treating those spellings as the same route. Eight variants
  verified closed, including `%2F` and doubled slashes.

### Known issues (documented, not fixed in this release)

- The systemd unit runs as root without hardening and reads a `.env`
  containing `X402_ADMIN_TOKEN` as root.
- `sweep.ts` sets its environment variable after the imports, so
  `CONFIG.masterPubKeyHex` is empty and the tool prints blank addresses; it
  also only sweeps `status='settled'`.
