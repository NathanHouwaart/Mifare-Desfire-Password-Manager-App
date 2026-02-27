import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_WINDOW_STEPS = 1;

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('Invalid Base32 secret');
    }

    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number, digits = DEFAULT_DIGITS): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const digest = crypto.createHmac('sha1', secret).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) >>> 0;

  const otp = binary % (10 ** digits);
  return otp.toString().padStart(digits, '0');
}

function totpAt(secret: Buffer, timeMs: number, periodSeconds = DEFAULT_PERIOD_SECONDS): string {
  const counter = Math.floor(timeMs / 1000 / periodSeconds);
  return hotp(secret, counter);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

export function buildTotpUri(issuer: string, accountName: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const issuerParam = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuerParam}&algorithm=SHA1&digits=${DEFAULT_DIGITS}&period=${DEFAULT_PERIOD_SECONDS}`;
}

export function isTotpCodeFormat(value: string): boolean {
  return /^[0-9]{6}$/.test(value.trim());
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  nowMs = Date.now(),
  windowSteps = DEFAULT_WINDOW_STEPS
): boolean {
  if (!isTotpCodeFormat(code)) return false;
  const secret = base32Decode(secretBase32);
  const candidate = code.trim();

  for (let step = -windowSteps; step <= windowSteps; step += 1) {
    const time = nowMs + (step * DEFAULT_PERIOD_SECONDS * 1000);
    if (totpAt(secret, time) === candidate) {
      return true;
    }
  }

  return false;
}
