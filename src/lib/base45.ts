// Base45 (RFC 9285) — packs bytes into QR "alphanumeric mode", which has a
// meaningfully larger per-symbol capacity than byte mode. Two bytes in, three
// chars out, using the 45-char QR alphanumeric alphabet. This is the same
// trick EU digital covid certs used to fit binary payloads into dense,
// scan-friendly QR codes — it buys real capacity per frame vs. base64.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function base45Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = bytes[i] * 256 + bytes[i + 1];
      const c = n % 45;
      n = (n - c) / 45;
      const d = n % 45;
      const e = (n - d) / 45;
      out += ALPHABET[c] + ALPHABET[d] + ALPHABET[e];
    } else {
      const n = bytes[i];
      const c = n % 45;
      const d = (n - c) / 45;
      out += ALPHABET[c] + ALPHABET[d];
    }
  }
  return out;
}

export function base45Decode(str: string): Uint8Array {
  const idx = (ch: string) => {
    const v = ALPHABET.indexOf(ch);
    if (v === -1) throw new Error(`Invalid base45 character: ${ch}`);
    return v;
  };
  const out: number[] = [];
  let i = 0;
  while (i < str.length) {
    const remaining = str.length - i;
    if (remaining >= 3) {
      const n = idx(str[i]) + idx(str[i + 1]) * 45 + idx(str[i + 2]) * 45 * 45;
      if (n > 0xffff) throw new Error('Invalid base45 triplet');
      out.push((n >> 8) & 0xff, n & 0xff);
      i += 3;
    } else if (remaining === 2) {
      const n = idx(str[i]) + idx(str[i + 1]) * 45;
      out.push(n & 0xff);
      i += 2;
    } else {
      throw new Error('Invalid base45 length');
    }
  }
  return new Uint8Array(out);
}
