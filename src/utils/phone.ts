const PHONE_REGEX = /(?:\+?998[\s-]?)?(?:\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})/g;

function normalizePhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 9) {
    return `998${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("998")) {
    return digits;
  }

  return null;
}

export function formatUzbekPhone(e164Digits: string): string {
  const d = e164Digits.replace(/\D/g, "");

  if (d.length !== 12 || !d.startsWith("998")) {
    return e164Digits;
  }

  const cc = d.slice(0, 3);
  const operator = d.slice(3, 5);
  const first = d.slice(5, 8);
  const second = d.slice(8, 10);
  const third = d.slice(10, 12);

  return `+${cc} ${operator} ${first} ${second} ${third}`;
}

export function extractPhone(text: string): string | null {
  const matches = text.match(PHONE_REGEX);

  if (!matches || matches.length === 0) {
    return null;
  }

  for (const match of matches) {
    const normalized = normalizePhoneDigits(match);

    if (normalized) {
      return formatUzbekPhone(normalized);
    }
  }

  return null;
}
