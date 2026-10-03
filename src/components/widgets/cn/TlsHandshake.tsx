"use client";
import { useMemo, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { Explain, Panel, Segmented, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

interface Msg {
  from: "C" | "S";
  name: string;
  encrypted: boolean;
  fields: string[];
  explain: string;
  rtt: number; // round trip in which it is sent (1-based)
  clientKnows: string[];
  serverKnows: string[];
}

const TLS13: Msg[] = [
  {
    from: "C",
    name: "ClientHello",
    encrypted: false,
    rtt: 1,
    fields: ["versions: TLS 1.3, 1.2", "cipher suites: AES_128_GCM_SHA256, CHACHA20_POLY1305…", "key_share: X25519 public value (client's ephemeral key)", "SNI: shop.example.com", "ALPN: h2, http/1.1", "client random"],
    explain: "The client guesses the key-exchange group (X25519) and sends its ephemeral public key immediately. That guess is what saves a round trip versus TLS 1.2.",
    clientKnows: ["client ephemeral private key"],
    serverKnows: [],
  },
  {
    from: "S",
    name: "ServerHello",
    encrypted: false,
    rtt: 1,
    fields: ["chosen: TLS 1.3, AES_128_GCM_SHA256", "key_share: server's X25519 public value", "server random"],
    explain: "With both public key shares, each side computes the same ECDHE shared secret. Neither private key ever crossed the wire. Handshake traffic keys are derived with HKDF.",
    clientKnows: ["client ephemeral private key"],
    serverKnows: ["ECDHE shared secret", "handshake traffic keys"],
  },
  {
    from: "S",
    name: "EncryptedExtensions",
    encrypted: true,
    rtt: 1,
    fields: ["ALPN selected: h2", "other negotiated extensions"],
    explain: "From here on, everything the server sends is encrypted with handshake keys — including which application protocol was chosen.",
    clientKnows: ["client ephemeral private key"],
    serverKnows: ["ECDHE shared secret", "handshake traffic keys"],
  },
  {
    from: "S",
    name: "Certificate",
    encrypted: true,
    rtt: 1,
    fields: ["leaf: CN=shop.example.com, SAN: shop.example.com", "intermediate: Let's Encrypt E6", "(root is in the client's trust store)"],
    explain: "The certificate chain — encrypted in TLS 1.3, so passive observers can't see which certificate is used. By itself it proves nothing: certificates are public.",
    clientKnows: ["client ephemeral private key"],
    serverKnows: ["ECDHE shared secret", "handshake traffic keys"],
  },
  {
    from: "S",
    name: "CertificateVerify",
    encrypted: true,
    rtt: 1,
    fields: ["signature (ECDSA/RSA-PSS) with the certificate's private key", "over: hash of every handshake message so far"],
    explain: "The proof of identity: only the holder of the certificate's private key can sign the transcript. It also binds the key shares and negotiated parameters, defeating man-in-the-middle and downgrade attacks.",
    clientKnows: ["client ephemeral private key"],
    serverKnows: ["ECDHE shared secret", "handshake traffic keys"],
  },
  {
    from: "S",
    name: "Finished",
    encrypted: true,
    rtt: 1,
    fields: ["HMAC over the transcript with a key derived from the handshake secret"],
    explain: "Confirms the server derived the same keys and saw the same messages. The server can already derive application keys and may even send data now (0.5-RTT data).",
    clientKnows: ["client ephemeral private key"],
    serverKnows: ["ECDHE shared secret", "handshake + application keys"],
  },
  {
    from: "C",
    name: "Finished (+ first HTTP request)",
    encrypted: true,
    rtt: 2,
    fields: ["client Finished HMAC", "then: GET / encrypted with application traffic keys"],
    explain: "The client validated the chain and hostname, verified CertificateVerify and the server's Finished, derived the same keys and sends its own Finished — immediately followed by the HTTP request. One round trip of TLS in total.",
    clientKnows: ["ECDHE shared secret", "handshake + application keys", "server authenticated ✔"],
    serverKnows: ["ECDHE shared secret", "handshake + application keys"],
  },
];

const TLS12: Msg[] = [
  { from: "C", name: "ClientHello", encrypted: false, rtt: 1, fields: ["versions, cipher suites", "client random", "SNI, ALPN"], explain: "No key share yet — the client doesn't know which key exchange the server will pick.", clientKnows: [], serverKnows: [] },
  { from: "S", name: "ServerHello + Certificate + ServerKeyExchange + ServerHelloDone", encrypted: false, rtt: 1, fields: ["chosen suite (e.g., ECDHE-RSA-AES128-GCM)", "certificate chain — in plaintext", "ECDHE public value signed with the certificate key"], explain: "Everything here is visible to passive observers, including the certificate.", clientKnows: [], serverKnows: [] },
  { from: "C", name: "ClientKeyExchange + ChangeCipherSpec + Finished", encrypted: false, rtt: 2, fields: ["client ECDHE public value", "switch to encryption", "Finished (encrypted)"], explain: "Only now can both compute the shared secret. (With legacy RSA key exchange the client would encrypt a pre-master secret to the server's public key — no forward secrecy.)", clientKnows: ["shared secret", "session keys"], serverKnows: ["shared secret", "session keys"] },
  { from: "S", name: "ChangeCipherSpec + Finished", encrypted: true, rtt: 2, fields: ["server Finished"], explain: "Handshake done after two round trips.", clientKnows: ["shared secret", "session keys", "server authenticated ✔"], serverKnows: ["shared secret", "session keys"] },
  { from: "C", name: "HTTP request", encrypted: true, rtt: 3, fields: ["GET / (encrypted)"], explain: "The request leaves one round trip later than with TLS 1.3.", clientKnows: ["session keys"], serverKnows: ["session keys"] },
];

export default function TlsHandshake() {
  const [ver, setVer] = useState<"13" | "12">("13");
  const msgs = useMemo(() => (ver === "13" ? TLS13 : TLS12), [ver]);
  const s = useStepper(msgs.length, { interval: 2600 });
  const cur = msgs[s.step];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={ver}
          onChange={(v) => {
            setVer(v);
            s.reset();
          }}
          options={[
            { value: "13", label: "TLS 1.3" },
            { value: "12", label: "TLS 1.2" },
          ]}
        />
        <StepControls s={s} total={msgs.length} label={`round trip ${cur.rtt} (after TCP's)`} />
      </div>
      <div className="grid gap-4 md:grid-cols-[180px_1fr_180px]">
        <Panel title="Client knows">
          <ul className="space-y-1 text-[12.5px]">
            {cur.clientKnows.length ? cur.clientKnows.map((k) => <li key={k}>• {k}</li>) : <li className="text-subtle">nothing secret yet</li>}
          </ul>
        </Panel>
        <div className="space-y-1.5">
          {msgs.map((m, i) => (
            <button
              key={m.name}
              type="button"
              onClick={() => s.setStep(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                m.from === "S" ? "flex-row-reverse text-right" : "",
                i === s.step ? "border-accent bg-accent/10" : i < s.step ? "border-border bg-surface" : "border-dashed border-border opacity-50",
              )}
            >
              <span className="font-mono text-[11px] text-subtle">{m.from === "C" ? "C →" : "← S"}</span>
              <span className="flex-1 text-[13px] font-medium">{m.name}</span>
              {m.encrypted ? <Lock className="h-3.5 w-3.5 text-ok" aria-label="encrypted" /> : <Unlock className="h-3.5 w-3.5 text-warn" aria-label="plaintext" />}
            </button>
          ))}
        </div>
        <Panel title="Server knows">
          <ul className="space-y-1 text-[12.5px]">
            {cur.serverKnows.length ? cur.serverKnows.map((k) => <li key={k}>• {k}</li>) : <li className="text-subtle">its long-term certificate key only</li>}
          </ul>
        </Panel>
      </div>
      <Panel title={`${cur.name} — ${cur.encrypted ? "encrypted" : "plaintext on the wire"}`}>
        <ul className="space-y-1 font-mono text-[12px]">
          {cur.fields.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Panel>
      <Explain>{cur.explain}</Explain>
    </div>
  );
}
