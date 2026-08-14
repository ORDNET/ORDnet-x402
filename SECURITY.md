# Security Policy

## Reporting a vulnerability

Please report security issues privately first. Do not open a public issue for
anything that could put funds at risk.

**Preferred channel:** [GitHub private vulnerability reporting](https://github.com/ORDNET/ORDnet-x402/security/advisories/new)
— the "Report a vulnerability" button on the Security tab of this repository.
This creates a private advisory only the maintainers can see.

Please include what the issue is, which file and line, how to reproduce it,
and what an attacker gains.

## What to expect

- **Acknowledgement:** within 3 working days.
- **Assessment:** within 10 working days, with a severity.
- **Credit:** we will name you in the release notes unless you prefer otherwise.

We do not currently operate a bug bounty.

## Threat model

This facilitator stands between paying clients and paid content, and it
holds no spending keys. Three things carry the weight:

1. **The paywall must fail closed.** Any request path that reaches paid
   content without a settled payment is a vulnerability — including route
   aliasing (trailing slashes, case variants), header spoofing, and any
   miss in the route table that falls through to the handler.
2. **A settlement must be real and single-use.** A txid unlocks exactly one
   invoice, once; a way to replay a settlement, settle without a broadcast
   the node accepts, or credit an invoice from someone else's payment is a
   vulnerability.
3. **The internet-facing box must stay keyless.** Per-invoice `payTo`
   addresses derive from the master **public** key only. Anything that
   causes a private key, seed or WIF to exist on, pass through, or be
   logged by the facilitator host is a vulnerability.

Out of scope: availability of the upstream node, and any deployment
operated by someone else.

## Known limitations

Documented in the [changelog](CHANGELOG.md) as known issues, restated here
so an operator cannot miss them:

- The bundled systemd unit runs as root without hardening and reads a
  `.env` containing `X402_ADMIN_TOKEN` as root. Harden before exposing.
- The offline sweep helper currently prints `address satoshis wif` to
  stdout — run it only on an offline machine, and treat the terminal
  output as key material. A sweep that builds a transaction instead of
  printing keys is on the roadmap.

## Known history

Version 1.1.0 served paid content to anyone who added a trailing slash or
changed the case of the path: the paywall looked up the exact route string
and fell through on a miss, while the router matched non-strictly. Fixed in
**1.2.0**, with regression tests for every reproduced variant. See
[SECURITY-FIXES-v1.2.0.md](SECURITY-FIXES-v1.2.0.md).
