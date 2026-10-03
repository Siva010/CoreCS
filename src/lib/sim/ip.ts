// IPv4 helpers used by the subnet and routing labs.

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

export function maskFromPrefix(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function toBinary(n: number): string {
  return (n >>> 0).toString(2).padStart(32, "0");
}

export function parseCidr(text: string): { ip: number; prefix: number } | null {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const ip = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (ip === null || prefix < 0 || prefix > 32) return null;
  return { ip, prefix };
}

export interface SubnetInfo {
  network: number;
  broadcast: number;
  mask: number;
  wildcard: number;
  first: number;
  last: number;
  total: number;
  usable: number;
}

export function subnetInfo(ip: number, prefix: number): SubnetInfo {
  const mask = maskFromPrefix(prefix);
  const network = (ip & mask) >>> 0;
  const wildcard = ~mask >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const total = 2 ** (32 - prefix);
  let first = network + 1;
  let last = broadcast - 1;
  let usable = Math.max(0, total - 2);
  if (prefix === 32) {
    first = last = network;
    usable = 1;
  } else if (prefix === 31) {
    first = network;
    last = broadcast;
    usable = 2;
  }
  return { network, broadcast, mask, wildcard, first: first >>> 0, last: last >>> 0, total, usable };
}

export function ipClass(ip: number): string {
  const a = ip >>> 24;
  if (a < 128) return "A (historical)";
  if (a < 192) return "B (historical)";
  if (a < 224) return "C (historical)";
  if (a < 240) return "D (multicast)";
  return "E (reserved)";
}

export function addressKind(ip: number): string {
  const inCidr = (base: string, p: number) => ((ip & maskFromPrefix(p)) >>> 0) === ipToInt(base);
  if (inCidr("10.0.0.0", 8) || inCidr("172.16.0.0", 12) || inCidr("192.168.0.0", 16)) return "Private (RFC 1918)";
  if (inCidr("127.0.0.0", 8)) return "Loopback";
  if (inCidr("169.254.0.0", 16)) return "Link-local";
  if (inCidr("100.64.0.0", 10)) return "Carrier-grade NAT (RFC 6598)";
  if (inCidr("224.0.0.0", 4)) return "Multicast";
  if (inCidr("0.0.0.0", 8)) return "This network";
  return "Public";
}

/** Longest-prefix match over a table of [cidr, value]. */
export function longestPrefixMatch<T>(ip: number, table: { cidr: string; value: T }[]): { cidr: string; value: T; index: number } | null {
  let best: { cidr: string; value: T; index: number; prefix: number } | null = null;
  table.forEach((row, index) => {
    const c = parseCidr(row.cidr);
    if (!c) return;
    const mask = maskFromPrefix(c.prefix);
    if (((ip & mask) >>> 0) === ((c.ip & mask) >>> 0) && (!best || c.prefix > best.prefix)) best = { ...row, index, prefix: c.prefix };
  });
  return best;
}
