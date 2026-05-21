/*
 * Self-contained IPv4 / IPv6 address + CIDR parsing and matching.
 *
 * Drop has no IP library in its dependency tree, and the IP allowlist /
 * blocklist feature needs three things:
 *
 *   1. validate that an admin-supplied pattern is a well-formed IP or CIDR
 *      (so we reject garbage at the API boundary), and
 *   2. given a client IP and a rule pattern, decide whether they match.
 *
 * Both IPv4 and IPv6 are normalised to a fixed-width array of bytes (4 or
 * 16). A CIDR match is then a prefix comparison on those bytes. Working in
 * bytes sidesteps every textual-representation pitfall — `::` compression,
 * leading zeroes, IPv4-mapped IPv6 (`::ffff:1.2.3.4`), upper/lower case.
 *
 * This is a security boundary, so the parser is deliberately strict: it
 * rejects anything it does not fully understand rather than guessing.
 */

/** A parsed IP address: its family and big-endian byte representation. */
export interface ParsedIp {
  family: 4 | 6;
  /** 4 bytes for IPv4, 16 bytes for IPv6. Each value 0-255. */
  bytes: number[];
}

/** A parsed CIDR range: the network address and prefix length in bits. */
export interface ParsedCidr {
  family: 4 | 6;
  bytes: number[];
  /** Prefix length in bits: 0-32 for IPv4, 0-128 for IPv6. */
  prefix: number;
}

/**
 * Parse a bare IPv4 address ("a.b.c.d") into 4 bytes. Returns null if the
 * string is not exactly four 0-255 decimal octets.
 */
function parseIpv4(input: string): number[] | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    // Reject empty, non-digit, or leading-zero-padded octets ("01").
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part[0] === "0") return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

/**
 * Parse a bare IPv6 address into 16 bytes. Handles `::` zero-compression
 * and a trailing embedded IPv4 ("::ffff:192.0.2.1"). Returns null on any
 * malformed input.
 */
function parseIpv6(input: string): number[] | null {
  // A zone index ("%eth0") is not meaningful for rule matching — reject it
  // rather than silently stripping, to keep stored patterns canonical.
  if (input.includes("%")) return null;

  // Split on "::" — at most one is allowed (it marks the zero run).
  const doubleColonParts = input.split("::");
  if (doubleColonParts.length > 2) return null;

  const hasDoubleColon = doubleColonParts.length === 2;
  const headText = doubleColonParts[0] ?? "";
  const tailText = hasDoubleColon ? (doubleColonParts[1] ?? "") : "";

  // Each side is a colon-separated list of 16-bit hextets. A trailing
  // embedded IPv4 in the last group expands to two hextets.
  function parseGroups(text: string, isTail: boolean): number[] | null {
    if (text === "") return [];
    const groups = text.split(":");
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const isLast = i === groups.length - 1;
      // The final group of the whole address may be dotted IPv4.
      if (isLast && group.includes(".")) {
        const v4 = parseIpv4(group);
        if (!v4) return null;
        out.push((v4[0]! << 8) | v4[1]!);
        out.push((v4[2]! << 8) | v4[3]!);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    // Suppress unused-param lint without changing behaviour.
    void isTail;
    return out;
  }

  const head = parseGroups(headText, false);
  const tail = parseGroups(tailText, true);
  if (head === null || tail === null) return null;

  let hextets: number[];
  if (hasDoubleColon) {
    // "::" fills the gap with enough zero hextets to reach 8 total.
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand for at least one group
    hextets = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    hextets = head;
  }

  if (hextets.length !== 8) return null;

  const bytes: number[] = [];
  for (const hextet of hextets) {
    if (hextet < 0 || hextet > 0xffff) return null;
    bytes.push((hextet >> 8) & 0xff);
    bytes.push(hextet & 0xff);
  }
  return bytes;
}

/**
 * Parse a bare IP address (no prefix). Returns null if it is neither a
 * valid IPv4 nor a valid IPv6 address.
 */
export function parseIp(input: string): ParsedIp | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.includes(":")) {
    const bytes = parseIpv6(trimmed);
    if (bytes) return { family: 6, bytes };
    return null;
  }

  const v4 = parseIpv4(trimmed);
  if (v4) return { family: 4, bytes: v4 };
  return null;
}

/**
 * Parse a CIDR range ("network/prefix"). Returns null on malformed input
 * or an out-of-range prefix length.
 */
export function parseCidr(input: string): ParsedCidr | null {
  const trimmed = input.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash === -1) return null;

  const addressPart = trimmed.slice(0, slash);
  const prefixPart = trimmed.slice(slash + 1);

  if (!/^\d{1,3}$/.test(prefixPart)) return null;
  const prefix = Number(prefixPart);

  const ip = parseIp(addressPart);
  if (!ip) return null;

  const maxPrefix = ip.family === 4 ? 32 : 128;
  if (prefix > maxPrefix) return null;

  return { family: ip.family, bytes: ip.bytes, prefix };
}

/**
 * Validate an admin-supplied rule pattern. Accepts either a bare IP
 * address or a CIDR range. Used by the create endpoint to reject garbage
 * before it is persisted.
 */
export function isValidIpRulePattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.includes("/")) return parseCidr(trimmed) !== null;
  return parseIp(trimmed) !== null;
}

/**
 * Compare the first `prefixBits` bits of two equal-length byte arrays.
 * Returns true when they are identical over that prefix.
 */
function bytesMatchPrefix(
  a: number[],
  b: number[],
  prefixBits: number,
): boolean {
  let bitsLeft = prefixBits;
  for (let i = 0; i < a.length && bitsLeft > 0; i++) {
    if (bitsLeft >= 8) {
      if (a[i] !== b[i]) return false;
      bitsLeft -= 8;
    } else {
      // Partial byte: compare only the high `bitsLeft` bits.
      const mask = (0xff << (8 - bitsLeft)) & 0xff;
      if ((a[i]! & mask) !== (b[i]! & mask)) return false;
      bitsLeft = 0;
    }
  }
  return true;
}

/**
 * Decide whether `clientIp` matches `rulePattern`.
 *
 * `rulePattern` may be a bare IP (exact match) or a CIDR range (prefix
 * match). Address families must agree — an IPv4 client never matches an
 * IPv6 rule and vice versa. IPv4-mapped IPv6 addresses ("::ffff:a.b.c.d")
 * are normalised to plain IPv4 first, so a v4 rule still catches a client
 * that arrived over a v6 socket.
 *
 * Returns false (rather than throwing) for any unparseable input, so a
 * corrupt stored pattern fails closed without taking the request down.
 */
export function ipMatchesPattern(
  clientIp: string,
  rulePattern: string,
): boolean {
  const client = normalizeForMatch(clientIp);
  if (!client) return false;

  const trimmed = rulePattern.trim();

  if (trimmed.includes("/")) {
    const cidr = parseCidr(trimmed);
    if (!cidr) return false;
    const network = normalizeForMatch(cidrNetworkText(cidr));
    if (!network) return false;
    if (network.family !== client.family) return false;
    return bytesMatchPrefix(client.bytes, network.bytes, cidr.prefix);
  }

  const rule = normalizeForMatch(trimmed);
  if (!rule) return false;
  if (rule.family !== client.family) return false;
  return bytesMatchPrefix(
    client.bytes,
    rule.bytes,
    rule.family === 4 ? 32 : 128,
  );
}

/** Render a ParsedCidr's network bytes back to a plain IP string. */
function cidrNetworkText(cidr: ParsedCidr): string {
  if (cidr.family === 4) return cidr.bytes.join(".");
  const hextets: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    hextets.push(((cidr.bytes[i]! << 8) | cidr.bytes[i + 1]!).toString(16));
  }
  return hextets.join(":");
}

/**
 * Parse an IP and collapse an IPv4-mapped IPv6 address ("::ffff:a.b.c.d",
 * bytes 0-9 zero, 10-11 = 0xffff) down to plain IPv4. This lets a v4 rule
 * match a client whose socket reported a v6-mapped address.
 */
function normalizeForMatch(input: string): ParsedIp | null {
  const parsed = parseIp(input);
  if (!parsed) return null;
  if (parsed.family === 6) {
    const b = parsed.bytes;
    const isV4Mapped =
      b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
    if (isV4Mapped) {
      return { family: 4, bytes: b.slice(12) };
    }
  }
  return parsed;
}
