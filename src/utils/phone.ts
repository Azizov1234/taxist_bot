const PHONE_REGEX = /(?<!\d)(?:\+?998[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})(?!\d)/g;
const CANDIDATE_CHUNK_REGEX = /[\d()+\s.-]{9,24}/g;

function normalizePhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 9) {
    return `998${digits}`;
  }

  if (digits.length === 10 && digits.startsWith("0")) {
    return `998${digits.slice(1)}`;
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

  for (const match of matches ?? []) {
    const normalized = normalizePhoneDigits(match);

    if (normalized) {
      return formatUzbekPhone(normalized);
    }
  }

  // Fallback: grab digit-heavy chunks and normalize them.
  const chunks = text.match(CANDIDATE_CHUNK_REGEX) ?? [];
  for (const chunk of chunks) {
    const normalized = normalizePhoneDigits(chunk);
    if (normalized) {
      return formatUzbekPhone(normalized);
    }
  }

  return null;
}
