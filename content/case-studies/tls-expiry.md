---
title: "The Certificate That Expired on a Sunday"
subject: cn
summary: "An internal API's TLS certificate, issued manually two years earlier, expired at 02:00 on a Sunday. Service-to-service calls failed with certificate errors, while external traffic kept working — until the mobile app's pinned intermediate also changed."
difficulty: 2
concepts: [cn-certificates-pki, cn-tls-handshake, cn-crypto-foundations, cn-proxies-load-balancers]
tags: [certificate expiry, tls, pki, acme, cert monitoring, mtls, certificate pinning, x509]
order: 32
---

## Context

External traffic terminates TLS at a CDN with automatically renewed certificates. Internally, the payments API uses a certificate issued manually by the company's internal CA, installed on its load balancer, valid for two years. Internal callers verify it (and some use mutual TLS).

## Symptoms

- Sunday 02:00: order confirmations stop; payment calls from the order service fail.
- Logs: `x509: certificate has expired or is not yet valid: current time 2024-06-02T02:00:14Z is after 2024-06-02T01:59:59Z`.
- The public website works; the on-call engineer initially suspects the payment provider.

## Metrics

| Metric | Value |
|---|---|
| Order service → payments API error rate | 100% from 02:00:00 |
| TLS handshake failures on internal LB | spike to all attempts |
| Certificate `notAfter` | 2024-06-02 01:59:59 UTC |

## Hypotheses

1. Payments API down → its health endpoint (plain HTTP from inside) is fine.
2. TLS failure → error text says expired certificate.
3. Clock skew on callers → all callers fail at the same instant; clocks are NTP-synced.

## Investigation

```bash
openssl s_client -connect payments.internal:443 -servername payments.internal </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
# notAfter=Jun  2 01:59:59 2024 GMT
```

The leaf certificate had expired. The renewal reminder had gone to the mailbox of an engineer who left the company. There was no expiry monitoring for internal endpoints.

Complication found during the fix: the team issued a new certificate from a **new** intermediate CA (the old one was near expiry too). A mobile app that pinned the old intermediate's public key would have broken on the public side if the same change had been made there — pinning turns routine rotation into an outage ([Certificates & PKI](lesson:cn-certificates-pki)).

## Root Cause

A manually managed certificate with no automated renewal and no expiry monitoring reached its `notAfter` date. Clients correctly rejected it during the TLS handshake ([TLS Handshake](lesson:cn-tls-handshake)).

## Fix

1. Issued and deployed a new certificate (from the existing intermediate, to avoid pinning issues); service restored at 03:10.
2. Moved internal certificates to automated issuance (ACME against the internal CA / a service mesh issuing short-lived certificates rotated daily).

## Prevention

- Inventory every certificate (internal and external) and alert at 30/14/7 days before expiry — from probes that perform real handshakes.
- Prefer short-lived, automatically rotated certificates: rotation becomes routine and tested.
- Avoid pinning leaf/intermediate keys in clients unless you control rotation carefully (pin to your own CA, keep backups).

## Interview Angle

Simple but common: explain what the client validates (chain to a trusted root, hostname/SAN, validity period, revocation), why expiry is a hard failure, how to inspect certificates with openssl, and how automation (ACME, mesh-issued short-lived certs) eliminates the failure class ([Crypto Foundations](lesson:cn-crypto-foundations)).
