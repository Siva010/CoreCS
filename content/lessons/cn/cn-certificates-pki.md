---
title: "Certificates and PKI: How Your Browser Knows It's Really the Server"
subject: cn
level: 8
order: 2
summary: "What an X.509 certificate contains, how chains of trust lead to root CAs, what browsers check during validation, how revocation and Certificate Transparency work, and why expired certificates cause outages."
depth: core
difficulty: 3
minutes: 35
relevance: high
stage: 2
prerequisites: [cn-crypto-foundations]
related: [cn-tls-handshake, cn-dns-records, cn-service-networking]
visualizations: [tls-handshake]
tags: [certificate, x.509, certificate authority, ca, root ca, intermediate ca, chain of trust, san, validation, revocation, ocsp, crl, certificate transparency, acme, lets encrypt, mtls, pinning]
---

## Mental Model

Diffie–Hellman gives you a secret shared with *someone* — but who? A certificate is a **passport for a public key**: a document saying "the public key K belongs to `shop.example.com`", **signed by an authority** your device already trusts. Your browser ships with a list of trusted authorities (root CAs); a certificate is trusted if a chain of signatures leads from it back to one of those roots, the names match, and it hasn't expired or been revoked.

## Definition

- **X.509 certificate**: a signed data structure binding a public key to identities (DNS names, IPs), with a validity period, issuer, serial number, key usage constraints and extensions.
- **Certificate Authority (CA)**: an organization that verifies control of names and signs certificates. **Root CAs**' certificates are pre-installed in OS/browser trust stores; **intermediate CAs** are signed by roots and sign end-entity (leaf) certificates.
- **Chain of trust**: leaf → intermediate(s) → root.
- **SAN (Subject Alternative Name)**: the list of hostnames the certificate is valid for (wildcards like `*.example.com` cover one label).

## Why It Exists

Without authentication, an attacker in the middle can run separate encrypted sessions with you and with the server, reading everything. Certificates, validated against a trusted root, let a client verify the server's identity without having met it before.

## How It Works

### What's inside (abridged)

```text
Certificate:
  Version: 3
  Serial Number: 0a:7f:...
  Signature Algorithm: ecdsa-with-SHA256
  Issuer: C=US, O=Let's Encrypt, CN=E6          ← intermediate CA
  Validity: Not Before: Sep  1 00:00:00 2026 GMT
            Not After : Nov 30 23:59:59 2026 GMT
  Subject: CN=shop.example.com
  Subject Public Key Info: id-ecPublicKey (P-256) ...
  X509v3 Subject Alternative Name: DNS:shop.example.com, DNS:www.shop.example.com
  X509v3 Key Usage: Digital Signature
  X509v3 Extended Key Usage: TLS Web Server Authentication
  Authority Information Access: OCSP / CA Issuers URLs
  CT Precertificate SCTs: ...                    ← Certificate Transparency proofs
  Signature: <CA's signature over all of the above>
```

### Validation — what the client checks

1. **Chain building**: the server sends its leaf + intermediates; the client builds a path to a root in its trust store (servers must send intermediates — a missing intermediate is a common misconfiguration that works in some browsers (which cache or fetch intermediates) and fails in others and in API clients).
2. **Signatures**: each certificate's signature verifies with its issuer's public key.
3. **Validity period**: now is between Not Before and Not After.
4. **Name match**: the hostname the client asked for (and sent in SNI) matches a SAN entry.
5. **Key usage / constraints**: e.g., leaf must be for server auth; intermediates must be CAs.
6. **Revocation** (best effort, varies by client): OCSP, CRLs, or browser-pushed lists.
7. **Certificate Transparency**: browsers require proof (SCTs) that the certificate was logged publicly.

Finally, during the TLS handshake the server proves it holds the **private key** matching the certificate by signing the handshake transcript (**CertificateVerify**, [TLS Handshake](lesson:cn-tls-handshake)). A stolen certificate without its private key is useless.

### How CAs verify you control a domain (ACME / Let's Encrypt)

- **HTTP-01**: serve a token at `http://domain/.well-known/acme-challenge/...`.
- **DNS-01**: publish a TXT record `_acme-challenge.domain` (needed for wildcards).
- **TLS-ALPN-01**: answer a special TLS handshake.

Certificates are short-lived (Let's Encrypt: 90 days; the CA/Browser Forum has voted to reduce maximum public certificate lifetimes toward 47 days by 2029), which makes **automation mandatory**.

## Internal Mechanism

### Revocation is hard

If a private key leaks, the certificate must be revoked before it expires. **CRLs** (lists of revoked serials) grow large; **OCSP** (real-time status queries) adds latency and leaks browsing to the CA, and clients usually "soft-fail" (treat unreachable OCSP as OK). **OCSP stapling** lets servers attach a signed, recent OCSP response in the handshake. Browsers increasingly rely on their own pushed revocation sets and on **short certificate lifetimes** as the practical fix.

### Certificate Transparency

All publicly trusted certificates must be logged in append-only, publicly auditable Merkle-tree logs. Domain owners monitor logs (crt.sh, CT monitors) to detect certificates issued for their names without permission — catching CA mistakes and attacks.

:::depth{level=advanced}
### mTLS and private PKI

In **mutual TLS**, the server also requests a client certificate, authenticating the client cryptographically. Service meshes (Istio, Linkerd) run a **private CA** that issues short-lived workload certificates (identities like SPIFFE IDs `spiffe://cluster/ns/payments/sa/api`) and rotate them automatically — every service-to-service call is encrypted and authenticated ([Service Networking](lesson:cn-service-networking)).

### Pinning

Apps can "pin" expected keys/certificates to resist rogue CAs. Pinning in browsers (HPKP) was abandoned because misconfigured pins bricked sites; mobile apps still pin sometimes, at the risk of outages during certificate rotation — pin to public keys or intermediate CAs with backups, not leaf certificates.
:::

## Example

```bash
$ openssl s_client -connect shop.example.com:443 -servername shop.example.com -showcerts </dev/null 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
subject=CN=shop.example.com
issuer=C=US, O=Let's Encrypt, CN=E6
notBefore=Sep  1 00:00:00 2026 GMT
notAfter=Nov 30 23:59:59 2026 GMT
X509v3 Subject Alternative Name: DNS:shop.example.com, DNS:www.shop.example.com
```

## Visualization

::viz{id=tls-handshake}

## Complexity & Performance

- Chain size matters: every handshake sends the chain (several KB); long chains and RSA-4096 keys increase handshake bytes and CPU; ECDSA certificates are smaller and faster.
- Validation is fast locally; network fetches (OCSP, missing intermediates) add latency — stapling avoids it.

## Trade-offs

- Public CAs: universally trusted vs dependence on the CA ecosystem and its failures.
- Short lifetimes: reduced damage from key compromise and less reliance on revocation vs automation requirements.
- Wildcards: convenient vs larger blast radius if the key leaks.

## Failure Modes

- **Expired certificates** — among the most common outages (including at large companies); often an internal service, an intermediate, or a device's embedded root expiring.
- Missing intermediates → failures in some clients only.
- Hostname mismatch (`www` vs apex, new subdomain not in SAN).
- Clock skew on clients (a device with a wrong date rejects valid certificates).
- CAA records forbidding the CA that tries to renew ([DNS Records](lesson:cn-dns-records)).
- Old clients lacking newer root certificates.

## In Production

- Automate issuance and renewal (cert-manager, ACME clients, cloud certificate managers) and **alert on expiry** (e.g., < 20 days) for every endpoint, including internal ones.
- Case study: [TLS Certificate Expiry](case:tls-expiry).

## Deeper Connections

- Signatures and keys: [Crypto Foundations](lesson:cn-crypto-foundations). How validation fits into the handshake: [TLS Handshake](lesson:cn-tls-handshake).

## Common Misconceptions

- **"The padlock means the site is safe/legitimate."** It means the connection is encrypted to the entity controlling that domain name — phishing sites have valid certificates too.
- **"Certificates encrypt the traffic."** They authenticate the server's public key; traffic is encrypted with session keys.
- **"Revocation reliably protects you."** In practice clients soft-fail; short lifetimes are the safety net.

## Interview Questions

### [L1 · conceptual] What is a certificate authority and what does it do?

A trusted organization that verifies an applicant controls a domain (or identity) and signs a certificate binding that name to the applicant's public key. Clients trust root CAs pre-installed in their trust stores and, through signature chains via intermediate CAs, the certificates they issue.

### [L2 · trace] What does a browser check when validating a server certificate?

It builds a chain from the leaf through intermediates to a trusted root, verifies each signature, checks the validity dates, verifies the requested hostname matches a SAN entry, checks key usage and constraints, considers revocation status and Certificate Transparency proofs, and then, during the handshake, verifies the server's signature proving possession of the private key.

### [L2 · why] Why can't an attacker who copies a site's certificate impersonate it?

The certificate contains only the public key. Impersonation requires proving possession of the matching private key during the handshake (CertificateVerify signature over the handshake transcript), which the attacker doesn't have.

### [L3 · incident] An internal API suddenly fails for all clients with "certificate has expired" though the leaf certificate was renewed last week. What else could be expired?

An intermediate certificate in the chain served by the server (renewal deployed the new leaf with an old bundled intermediate), a cross-signed root/intermediate the clients rely on (e.g., an old root expiring in client trust stores), a client certificate in mTLS, or a separate endpoint (load balancer, sidecar) still serving the old certificate. Check the chain actually served with openssl s_client -showcerts at each hop.

## Practice

### [mcq] Which certificate field determines which hostnames a certificate is valid for?

- [ ] Issuer
- [ ] Serial number
- [x] Subject Alternative Name (SAN)
- [ ] Key Usage

Modern clients validate names against SAN entries.

### [mcq] What is the purpose of Certificate Transparency?

- [ ] Encrypting certificates
- [x] Publicly logging issued certificates so misissuance can be detected
- [ ] Revoking compromised certificates
- [ ] Speeding up the handshake

Domain owners can monitor logs for unexpected certificates.

## Quick Revision

- Certificate = public key + names (SAN) + validity + issuer, signed by a CA.
- Chain: leaf → intermediate(s) → root in trust store; servers must send intermediates.
- Validation: chain + signatures + dates + hostname + usage + (revocation) + CT; possession proven by CertificateVerify.
- ACME (HTTP-01, DNS-01) automates short-lived certs; automate renewal and alert on expiry.
- Revocation (CRL, OCSP, stapling) is weak → short lifetimes. mTLS + private PKI for services.
