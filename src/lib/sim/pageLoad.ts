// The latency budget of one page load, for the Page Load Timeline lab: DNS, the
// transport and TLS handshakes, the request (through a CDN edge or straight to
// the origin), the HTML download under TCP slow start, the critical CSS/JS, and
// rendering. Simple, explainable arithmetic, not a browser model. Pure
// functions, checkable with tsx.

export type Transport = "tls12" | "tls13" | "quic" | "quic0rtt" | "reused";

export interface PageLoadConfig {
  dnsMs: number; // 0 when the browser has the answer cached
  rttMs: number; // browser ↔ origin round trip
  cdn: boolean;
  edgeRttMs: number; // browser ↔ CDN edge
  edgeOriginRttMs: number; // edge ↔ origin, over an already open connection
  transport: Transport;
  serverMs: number; // time the origin spends producing the HTML
  htmlKB: number;
  assets: number; // critical CSS/JS files, fetched in parallel after the HTML
  assetKB: number; // size of each
  bandwidthMbps: number;
  renderMs: number;
}

export interface Phase {
  key: "dns" | "tcp" | "tls" | "quic" | "request" | "html" | "assets" | "render";
  label: string;
  start: number;
  end: number;
  rtts: number; // round trips spent in this phase
  note: string;
}

export interface PageLoadResult {
  phases: Phase[];
  ttfb: number;
  ready: number;
  rttsBeforeFirstByte: number;
  slowStartRounds: number; // round trips the HTML needs under slow start
}

export const INIT_WINDOW_KB = 14.6; // 10 segments of 1,460 bytes

/** Round trips needed to deliver `kb` when the window starts at 10 segments and doubles each round. */
export function slowStartRounds(kb: number): number {
  let rounds = 0;
  let sent = 0;
  let window = INIT_WINDOW_KB;
  while (sent + 1e-9 < kb) {
    sent += window;
    window *= 2;
    rounds++;
  }
  return Math.max(1, rounds);
}

const HANDSHAKE: Record<Transport, { tcp: number; tls: number; quic: number }> = {
  tls12: { tcp: 1, tls: 2, quic: 0 },
  tls13: { tcp: 1, tls: 1, quic: 0 },
  quic: { tcp: 0, tls: 0, quic: 1 },
  quic0rtt: { tcp: 0, tls: 0, quic: 0 },
  reused: { tcp: 0, tls: 0, quic: 0 },
};

export function simulatePageLoad(c: PageLoadConfig): PageLoadResult {
  const rtt = c.cdn ? c.edgeRttMs : c.rttMs; // the browser's connection ends at the edge with a CDN
  const transferMs = (kb: number) => (kb * 8) / Math.max(0.1, c.bandwidthMbps); // KB → ms at Mb/s
  const phases: Phase[] = [];
  let t = 0;
  const add = (p: Omit<Phase, "start" | "end">, ms: number) => {
    phases.push({ ...p, start: t, end: t + ms });
    t += ms;
  };
  if (c.dnsMs > 0) add({ key: "dns", label: "DNS", rtts: 0, note: "resolve the name" }, c.dnsMs);
  const h = HANDSHAKE[c.transport];
  if (h.tcp) add({ key: "tcp", label: "TCP handshake", rtts: h.tcp, note: "SYN, SYN-ACK" }, h.tcp * rtt);
  if (h.tls) add({ key: "tls", label: c.transport === "tls12" ? "TLS 1.2" : "TLS 1.3", rtts: h.tls, note: c.transport === "tls12" ? "two round trips" : "one round trip" }, h.tls * rtt);
  if (h.quic) add({ key: "quic", label: "QUIC handshake", rtts: h.quic, note: "transport and TLS 1.3 together" }, h.quic * rtt);
  const serverSide = c.serverMs + (c.cdn ? c.edgeOriginRttMs : 0);
  add(
    {
      key: "request",
      label: "Request → first byte",
      rtts: 1,
      note:
        (c.transport === "quic0rtt" ? "sent in the first flight (0-RTT); " : c.transport === "reused" ? "on a reused connection; " : "") +
        (c.cdn ? `edge forwards to the origin (+${c.edgeOriginRttMs} ms) and ${c.serverMs} ms of server time` : `${c.serverMs} ms of server time`),
    },
    rtt + serverSide,
  );
  const ttfb = t;
  const rttsBeforeFirstByte = phases.reduce((a, p) => a + p.rtts, 0);
  const rounds = slowStartRounds(c.htmlKB);
  add({ key: "html", label: "HTML download", rtts: rounds - 1, note: `${rounds} slow-start round${rounds === 1 ? "" : "s"} for ${c.htmlKB} KB` }, (rounds - 1) * rtt + transferMs(c.htmlKB));
  if (c.assets > 0)
    add(
      { key: "assets", label: "CSS and JS", rtts: 1, note: `${c.assets} file${c.assets === 1 ? "" : "s"} in parallel${c.cdn ? ", cached at the edge" : ""}` },
      rtt + transferMs(c.assets * c.assetKB),
    );
  if (c.renderMs > 0) add({ key: "render", label: "Parse, layout, paint", rtts: 0, note: "the browser's CPU" }, c.renderMs);
  return { phases, ttfb, ready: t, rttsBeforeFirstByte, slowStartRounds: rounds };
}

export const PAGE_PRESETS: { id: string; label: string; note: string; cfg: PageLoadConfig }[] = [
  {
    id: "cold",
    label: "Cold visit",
    note: "The lesson's example: 40 ms RTT, DNS not cached in the browser, TLS 1.3, 15 ms of server time.",
    cfg: { dnsMs: 45, rttMs: 40, cdn: false, edgeRttMs: 10, edgeOriginRttMs: 35, transport: "tls13", serverMs: 15, htmlKB: 30, assets: 2, assetKB: 60, bandwidthMbps: 50, renderMs: 60 },
  },
  {
    id: "tls12",
    label: "Old stack",
    note: "The same visit with TLS 1.2, which needs two round trips for its handshake.",
    cfg: { dnsMs: 45, rttMs: 40, cdn: false, edgeRttMs: 10, edgeOriginRttMs: 35, transport: "tls12", serverMs: 15, htmlKB: 30, assets: 2, assetKB: 60, bandwidthMbps: 50, renderMs: 60 },
  },
  {
    id: "repeat",
    label: "Repeat visit",
    note: "DNS cached and the connection reused: only the request and the download remain.",
    cfg: { dnsMs: 0, rttMs: 40, cdn: false, edgeRttMs: 10, edgeOriginRttMs: 35, transport: "reused", serverMs: 15, htmlKB: 30, assets: 0, assetKB: 60, bandwidthMbps: 50, renderMs: 60 },
  },
  {
    id: "far",
    label: "Far away",
    note: "A user 200 ms from the origin, with no CDN: every round trip is expensive.",
    cfg: { dnsMs: 45, rttMs: 200, cdn: false, edgeRttMs: 15, edgeOriginRttMs: 190, transport: "tls13", serverMs: 15, htmlKB: 30, assets: 2, assetKB: 60, bandwidthMbps: 50, renderMs: 60 },
  },
  {
    id: "far-cdn",
    label: "Far away, with a CDN",
    note: "The same user, with a CDN edge 15 ms away. Handshakes and cached assets stay local; only the HTML request travels to the origin, over the edge's open connection.",
    cfg: { dnsMs: 45, rttMs: 200, cdn: true, edgeRttMs: 15, edgeOriginRttMs: 190, transport: "tls13", serverMs: 15, htmlKB: 30, assets: 2, assetKB: 60, bandwidthMbps: 50, renderMs: 60 },
  },
];
