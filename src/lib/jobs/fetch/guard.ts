import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { FetchError } from "./types";

/**
 * Keeps fetching on the public internet. Job URLs come from people and from the web (the Daily Job Shortlist's morning
 * run, the MCP endpoint), so a planted link must not make this machine fetch the app itself, the router or a cloud
 * metadata address.
 *
 * Not covered: DNS rebinding between this check and the connection (the name resolves to a public address here and a
 * private one a moment later). Acceptable for a single-user app on a laptop.
 */

const PRIVATE_MESSAGE = "Private or local addresses can't be fetched";

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) ? parts : null;
}

function isPrivateIpv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return true;
  const [a, b] = p;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped (::ffff:127.0.0.1) and the hex form URL parsing produces (::ffff:7f00:1).
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (isIP(rest) === 4) return isPrivateIpv4(rest);
    const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!hex) return true;
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(lower.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 // multicast
  );
}

/** True for an address that is not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const kind = isIP(bare);
  if (kind === 4) return isPrivateIpv4(bare);
  if (kind === 6) return isPrivateIpv6(bare);
  return true;
}

/** Quick check with no DNS: local names (`localhost`, `*.local`, ...) and IP literals in private ranges. */
export function isPrivateHostLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (isIP(host)) return isPrivateAddress(host);
  return LOCAL_NAMES.test(host) || !host.includes(".");
}

export type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Throws `FetchError("invalid_url")` unless every address `url`'s host resolves to is public. A host that does not
 * resolve is left for the fetch itself to fail on.
 */
export async function assertPublicUrl(url: string | URL, resolve: Resolver = systemResolver): Promise<void> {
  const { hostname } = typeof url === "string" ? new URL(url) : url;
  if (isPrivateHostLiteral(hostname)) throw new FetchError("invalid_url", PRIVATE_MESSAGE);
  if (isIP(hostname.replace(/^\[|\]$/g, ""))) return;
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    return;
  }
  if (addresses.some(isPrivateAddress)) throw new FetchError("invalid_url", PRIVATE_MESSAGE);
}

/** Same as {@link assertPublicUrl}, as a yes/no, remembering answers per host (for one page render's requests). */
export function publicHostChecker(resolve: Resolver = systemResolver): (url: string) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>();
  return (url) => {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return Promise.resolve(false);
    }
    let answer = seen.get(host);
    if (!answer) {
      answer = assertPublicUrl(url, resolve).then(
        () => true,
        () => false,
      );
      seen.set(host, answer);
    }
    return answer;
  };
}

export { PRIVATE_MESSAGE };
