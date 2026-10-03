"use client";
import { useMemo, useState } from "react";
import { Explain, Panel, Segmented, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

type Layer = "app" | "tls" | "tcp" | "ip" | "eth";

interface Header {
  layer: Layer;
  label: string;
  bytes: number;
  fields: [string, string][];
  changed?: boolean;
}

const COLORS: Record<Layer, string> = {
  app: "#6366f1",
  tls: "#a855f7",
  tcp: "#0ea5e9",
  ip: "#10b981",
  eth: "#f59e0b",
};

interface Stage {
  where: string;
  title: string;
  text: string;
  headers: Header[];
}

function stages(https: boolean): Stage[] {
  const app: Header = {
    layer: "app",
    label: "HTTP request",
    bytes: 78,
    fields: [
      ["line", "GET /index.html HTTP/1.1"],
      ["Host", "example.com"],
    ],
  };
  const tls: Header = { layer: "tls", label: "TLS record", bytes: 22, fields: [["type", "application_data (23)"], ["payload", "AEAD-encrypted HTTP + 16 B tag"]] };
  const tcp = (changed = false): Header => ({
    layer: "tcp",
    label: "TCP header",
    bytes: 20,
    changed,
    fields: [
      ["ports", "51514 → 443"],
      ["seq / ack", "2837461001 / 4011332001"],
      ["flags", "PSH, ACK"],
      ["window", "502 (× 128)"],
    ],
  });
  const ip = (ttl: number, src: string, changed = false): Header => ({
    layer: "ip",
    label: "IPv4 header",
    bytes: 20,
    changed,
    fields: [
      ["src → dst", `${src} → 93.184.215.14`],
      ["TTL", String(ttl)],
      ["protocol", "6 (TCP)"],
      ["checksum", changed ? "recomputed" : "0x1c46"],
    ],
  });
  const eth = (src: string, dst: string, changed = false): Header => ({
    layer: "eth",
    label: "Ethernet frame",
    bytes: 18,
    changed,
    fields: [
      ["dst MAC", dst],
      ["src MAC", src],
      ["EtherType", "0x0800 (IPv4)"],
      ["FCS", "CRC-32 trailer"],
    ],
  });
  const inner: Header[] = https ? [app, tls] : [app];
  return [
    { where: "Laptop · application", title: "The application writes its message", text: "The browser produces the HTTP request bytes and calls write() on its socket. It knows nothing about routes, MACs or packets.", headers: [...inner.slice(0, 1)] },
    ...(https
      ? [{ where: "Laptop · TLS library", title: "TLS encrypts the request", text: "Inside the application process, TLS wraps the HTTP bytes into an encrypted record. Everything from here down sees only ciphertext.", headers: [...inner] }]
      : []),
    { where: "Laptop · kernel TCP", title: "TCP adds ports and sequence numbers", text: "The kernel's TCP stack segments the byte stream (≤ MSS 1,460 B), adds source/destination ports, sequence and ack numbers, flags and the receive window, and keeps a copy for retransmission.", headers: [...inner, tcp()] },
    { where: "Laptop · kernel IP", title: "IP adds addresses and TTL", text: "IP adds source and destination addresses, protocol number and TTL, and consults the routing table: destination not local → next hop is the default gateway 192.168.1.1.", headers: [...inner, tcp(), ip(64, "192.168.1.20")] },
    { where: "Laptop · link layer", title: "Ethernet/Wi-Fi frame to the gateway's MAC", text: "ARP resolved 192.168.1.1 → 00:1a:2b:3c:4d:5e. The frame is addressed to the router's MAC — not the server's — and the NIC transmits it with a CRC.", headers: [...inner, tcp(), ip(64, "192.168.1.20"), eth("3c:22:fb:9a:10:4e", "00:1a:2b:3c:4d:5e")] },
    { where: "Home router (NAT)", title: "First hop: strip the frame, rewrite, re-frame", text: "The router checks the CRC and removes the Ethernet header, decrements TTL, performs NAT (source 192.168.1.20:51514 → 198.51.100.7:40001, checksums updated), looks up the next hop (ISP) and builds a brand-new frame.", headers: [...inner, { ...tcp(true), fields: [["ports", "40001 → 443 (NAT)"], ["seq / ack", "unchanged"], ["flags", "PSH, ACK"], ["checksum", "updated"]] }, ip(63, "198.51.100.7", true), eth("router WAN MAC", "ISP router MAC", true)] },
    { where: "Internet routers", title: "Each hop: new frame, TTL − 1", text: "About ten routers repeat the same pattern: longest-prefix-match the destination IP, decrement TTL, re-frame for the next link. They never look at TCP ports (unless they're firewalls or NATs) and can't read the TLS payload.", headers: [...inner, { ...tcp(), fields: [["ports", "40001 → 443"], ["seq / ack", "unchanged"], ["flags", "PSH, ACK"], ["window", "unchanged"]] }, ip(55, "198.51.100.7", true), eth("hop N MAC", "hop N+1 MAC", true)] },
    { where: "Server · NIC + kernel", title: "Decapsulation, bottom to top", text: "The server's NIC checks the CRC; IP sees its own address and strips the header; TCP finds the socket by the 4-tuple, puts data in the receive buffer in order, sends an ACK and wakes the web server's read().", headers: [...inner, tcp()] },
    { where: "Server · application", title: "The application reads the request", text: https ? "The web server's TLS library decrypts the record and hands the HTTP request to the application code." : "The web server reads exactly the bytes the browser wrote.", headers: [app] },
  ];
}

export default function Encapsulation() {
  const [https, setHttps] = useState<"http" | "https">("https");
  const all = useMemo(() => stages(https === "https"), [https]);
  const s = useStepper(all.length, { interval: 2400 });
  const st = all[Math.min(s.step, all.length - 1)];
  const total = st.headers.reduce((n, h) => n + h.bytes, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={https}
          onChange={(v) => {
            setHttps(v);
            s.reset();
          }}
          options={[
            { value: "http", label: "HTTP" },
            { value: "https", label: "HTTPS (TLS)" },
          ]}
        />
        <StepControls s={s} total={all.length} />
      </div>
      <div className="text-[12px] font-semibold tracking-wider text-subtle uppercase">{st.where}</div>
      <Panel title={st.title} right={<span className="font-mono text-[12px] text-subtle">~{total} bytes</span>}>
        <div className="flex flex-col-reverse gap-1.5">
          {st.headers.map((h, i) => (
            <div
              key={`${h.layer}-${i}`}
              className={cn("rounded-lg border-2 px-3 py-2 transition-all", h.changed && "ring-2 ring-warn/60")}
              style={{ borderColor: COLORS[h.layer], background: `color-mix(in oklab, ${COLORS[h.layer]} 10%, transparent)`, marginLeft: `${(st.headers.length - 1 - i) * 0}px` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold" style={{ color: COLORS[h.layer] }}>
                  {h.label}
                  {h.changed && <span className="ml-2 text-[11px] font-medium text-warn">rewritten at this hop</span>}
                </span>
                <span className="font-mono text-[11px] text-subtle">{h.bytes} B</span>
              </div>
              <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {h.fields.map(([k, v]) => (
                  <div key={k} className="flex gap-2 font-mono text-[11.5px]">
                    <dt className="text-subtle">{k}</dt>
                    <dd className="text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-subtle">Outermost header at the top, application data at the bottom — the order on the wire is the reverse: Ethernet first.</p>
      </Panel>
      <Explain>{st.text}</Explain>
    </div>
  );
}
