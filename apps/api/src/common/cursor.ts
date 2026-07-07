/**
 * Opaque keyset-pagination cursor over (createdAt, id). Encodes the last-seen
 * row's timestamp + id so the next page can resume with a stable tie-breaker
 * (avoids the offset drift you'd get from LIMIT/OFFSET on a growing table).
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw?: string): Cursor | null {
  if (!raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export function clampLimit(raw?: string | number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  if (!n || Number.isNaN(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}
