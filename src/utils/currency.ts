import { TransactionType } from '../types/cashbook';

// Upper bound safely below Number.MAX_SAFE_INTEGER so large sums never overflow
export const MAX_SAFE_PAISE = 999_999_999_999; // ₹99,99,99,999.99

/**
 * Parses a user-entered rupee string (e.g., "5000", "250.5", "1,200.75")
 * into exact integer paise. Returns null if invalid, <= 0, > 2 decimals, or over limit.
 */
export function parseRupeesToPaise(rawInput: string): number | null {
  const cleaned = rawInput.replace(/[₹,\s]/g, '').trim();
  if (!cleaned) return null;

  // Reject non-numeric, negative, and >2 decimal places
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }

  const [wholePart, fracPart = ''] = cleaned.split('.');
  if (wholePart.length > 10) return null;

  const wholePaise = Number.parseInt(wholePart, 10) * 100;
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const fracPaise = Number.parseInt(paddedFrac, 10);
  const total = wholePaise + fracPaise;

  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_SAFE_PAISE) {
    return null;
  }
  return total;
}

export function isValidDateStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return (
    probe.getFullYear() === y &&
    probe.getMonth() === m - 1 &&
    probe.getDate() === d
  );
}

export function isValidTimeStr(timeStr: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
  const [hh, mm] = timeStr.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Formats integer paise into Indian Rupee display (e.g., ₹1,25,000 or ₹250.50).
 */
export function formatPaise(
  paise: number,
  options?: {
    showSign?: boolean;
    type?: TransactionType;
  }
): string {
  const safePaise = Math.round(paise);
  const isNegative = safePaise < 0;
  const absPaise = Math.abs(safePaise);
  const rupees = absPaise / 100;
  const hasDecimals = absPaise % 100 !== 0;

  const formattedNumber = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);

  let prefix = '';
  if (options?.type === 'received') {
    prefix = '+';
  } else if (options?.type === 'spent') {
    prefix = '−';
  } else if (options?.showSign) {
    if (safePaise > 0) prefix = '+';
    else if (isNegative) prefix = '−';
  } else if (isNegative) {
    prefix = '−';
  }

  return `${prefix}₹${formattedNumber}`;
}

export function paiseToRupeeInputString(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentTimeStr(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatDateHuman(dateStr: string): string {
  const today = getTodayDateStr();
  if (dateStr === today) return 'Today';

  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;

  const target = new Date(y, m - 1, d);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (
    target.getFullYear() === yesterday.getFullYear() &&
    target.getMonth() === yesterday.getMonth() &&
    target.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }

  return target.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: target.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatTime12h(timeStr: string): string {
  const [hhStr, mmStr] = timeStr.split(':');
  const hh = Number.parseInt(hhStr, 10);
  const mm = Number.parseInt(mmStr, 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return timeStr;
  const period = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${String(mm).padStart(2, '0')} ${period}`;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const PBKDF2_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function hasSecureWebCrypto(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    Boolean(crypto.subtle) &&
    typeof crypto.subtle.importKey === 'function' &&
    typeof crypto.subtle.deriveBits === 'function' &&
    typeof crypto.getRandomValues === 'function'
  );
}

async function legacySha256HashPin(pin: string): Promise<string | null> {
  if (
    typeof crypto === 'undefined' ||
    !crypto.subtle ||
    typeof crypto.subtle.digest !== 'function'
  ) {
    return null;
  }
  const salted = `cashbook_v1:${pin}`;
  const encoded = new TextEncoder().encode(salted);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(buffer));
}

function legacyWeakFallbackPin(pin: string): string {
  const salted = `cashbook_v1:${pin}`;
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    hash = (hash << 5) - hash + salted.charCodeAt(i);
    hash |= 0;
  }
  return `fb_${Math.abs(hash).toString(16)}`;
}

async function derivePbkdf2Hex(
  pin: string,
  saltBytes: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<string> {
  const encoded = new TextEncoder().encode(pin);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoded,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPin(pin: string): Promise<string> {
  if (!hasSecureWebCrypto()) {
    throw new Error(
      'Secure PIN encryption is unavailable in this browser context. Open Folio over HTTPS or on localhost to set or change a PIN.'
    );
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePbkdf2Hex(pin, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_v1$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${derived}`;
}

export async function verifyPin(
  pin: string,
  storedHash: string
): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (storedHash.startsWith('pbkdf2_v1$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 4) return { valid: false, needsMigration: false };
    const iterations = Number.parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHex = parts[3];
    if (
      !Number.isFinite(iterations) ||
      iterations <= 0 ||
      !/^[0-9a-f]+$/i.test(saltHex) ||
      saltHex.length % 2 !== 0
    ) {
      return { valid: false, needsMigration: false };
    }
    if (
      typeof crypto === 'undefined' ||
      !crypto.subtle ||
      typeof crypto.subtle.importKey !== 'function' ||
      typeof crypto.subtle.deriveBits !== 'function'
    ) {
      return { valid: false, needsMigration: false };
    }
    const derived = await derivePbkdf2Hex(pin, hexToBytes(saltHex), iterations);
    return {
      valid: constantTimeEquals(derived, expectedHex),
      needsMigration: false,
    };
  }

  // Legacy weak fallback verification (verification only; never created for new PINs)
  if (storedHash.startsWith('fb_')) {
    const valid = constantTimeEquals(legacyWeakFallbackPin(pin), storedHash);
    return {
      valid,
      needsMigration: valid && hasSecureWebCrypto(),
    };
  }

  // Legacy SHA-256 verification and lazy PBKDF2 migration when supported
  const legacySha = await legacySha256HashPin(pin);
  if (!legacySha) {
    return { valid: false, needsMigration: false };
  }
  const valid = constantTimeEquals(legacySha, storedHash);
  return {
    valid,
    needsMigration: valid && hasSecureWebCrypto(),
  };
}
