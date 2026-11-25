/**
 * US NPI (National Provider Identifier) validation using the CMS/ISO 7812 Luhn
 * algorithm with the 80840 health industry prefix.
 */
export function computeNpiCheckDigit(nineDigits: string): string {
  if (!/^\d{9}$/.test(nineDigits)) {
    throw new Error('NPI base must be exactly 9 digits.');
  }
  const prefixed = `80840${nineDigits}`;
  let sum = 0;
  // Double every second digit starting from the rightmost digit of the 14-digit base
  for (let i = prefixed.length - 1, pos = 0; i >= 0; i -= 1, pos += 1) {
    let digit = Number(prefixed[i]);
    if (pos % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

export function buildValidNpi(nineDigits: string): string {
  return `${nineDigits}${computeNpiCheckDigit(nineDigits)}`;
}

export function validateNpi(npi: string): boolean {
  const cleaned = npi.trim();
  if (!/^\d{10}$/.test(cleaned)) {
    return false;
  }
  if (!cleaned.startsWith('1') && !cleaned.startsWith('2')) {
    return false;
  }
  const expected = computeNpiCheckDigit(cleaned.slice(0, 9));
  return cleaned[9] === expected;
}

export function maskSensitiveValue(
  value: string | undefined | null,
  kind: 'ssn' | 'tin' | 'dob' | 'bank',
): string {
  if (!value) return '—';
  const cleaned = value.trim();
  if (!cleaned) return '—';

  switch (kind) {
    case 'ssn': {
      const digits = cleaned.replace(/\D/g, '');
      const last4 = digits.slice(-4) || '****';
      return `***-**-${last4}`;
    }
    case 'tin': {
      const digits = cleaned.replace(/\D/g, '');
      const last4 = digits.slice(-4) || '****';
      return `**-***${last4}`;
    }
    case 'dob': {
      const year = cleaned.slice(0, 4);
      return /^\d{4}$/.test(year) ? `${year}-**-**` : '****-**-**';
    }
    case 'bank': {
      const digits = cleaned.replace(/\D/g, '');
      const last4 = digits.slice(-4) || '****';
      return `•••• •••• ${last4}`;
    }
  }
}

export function normalizeNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['dr', 'md', 'do', 'np', 'pa', 'llc', 'inc', 'pc'].includes(t));
}

export function calculateNameSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeNameTokens(a));
  const tokensB = new Set(normalizeNameTokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) intersection += 1;
  });
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}
