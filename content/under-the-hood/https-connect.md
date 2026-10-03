---
title: "What Happens in an HTTPS Connection Setup"
summary: "After TCP connects, TLS 1.3 turns a plain byte stream into an authenticated, encrypted channel in one round trip: key shares, the certificate chain, the signature that proves identity, key derivation, and the first encrypted HTTP request."
subjects: [cn]
order: 9
related: [cn-tls-handshake, cn-certificates-pki, cn-crypto-foundations, cn-http2, cn-proxies-load-balancers]
---

The browser has an ESTABLISHED TCP connection to `shop.example.com:443` ([TCP Connect](uth:tcp-connect)). Nothing sent so far is protected.

## [tls] ClientHello

The browser sends ClientHello in plaintext: supported TLS versions (1.3, 1.2), cipher suites, a random nonce, **SNI** = `shop.example.com` (so a server hosting many sites picks the right certificate), **ALPN** = `h2, http/1.1`, and a **key share** — an ephemeral X25519 public key, guessed in advance to save a round trip ([TLS Handshake](lesson:cn-tls-handshake)).

## [lb] The edge picks a certificate

The TLS terminator (CDN or load balancer) uses SNI to select the certificate and key for `shop.example.com`, chooses TLS 1.3 with a cipher suite (e.g., AES-128-GCM-SHA256), and generates its own ephemeral key share.

## [tls] ServerHello and key agreement

The server replies with ServerHello (its key share). Both sides now compute the same **ECDHE shared secret** from their private key and the other's public key; nobody observing the wire can. HKDF derives handshake traffic keys. Everything that follows is encrypted ([Crypto Foundations](lesson:cn-crypto-foundations)).

## [tls] Certificate and CertificateVerify

Encrypted: EncryptedExtensions (ALPN chose `h2`), the **certificate chain** (leaf for shop.example.com + intermediate), and **CertificateVerify** — a signature over the handshake transcript made with the certificate's private key. Then the server's Finished (an HMAC over the transcript).

## [browser] Validate identity

The browser builds a chain from the leaf to a root in its trust store, checks signatures, validity dates, that the SAN includes `shop.example.com`, key usage, and revocation/transparency policies ([Certificates & PKI](lesson:cn-certificates-pki)). It verifies CertificateVerify with the leaf's public key: only the holder of the private key could have signed this transcript — that's the actual proof of identity. It verifies the server's Finished.

## [tls] Client Finished + first request

The browser derives application traffic keys, sends its Finished and — in the same flight — the encrypted HTTP/2 connection preface and the first request. **One round trip** after TCP.

## [http] Encrypted HTTP

Each TLS record: type, length, AEAD-encrypted payload (with sequence-number-based nonces), authenticated so tampering is detected. HTTP/2 frames travel inside ([HTTP/2](lesson:cn-http2)).

## [tls] Next time: resumption

The server sends a NewSessionTicket. On a later connection, the browser offers it (PSK) and can skip certificate validation work — even send the request in the first flight (0-RTT), which is replayable, so servers accept only idempotent requests that way.
