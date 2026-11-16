import type { Prisma } from '../db.js';

type DecimalLike = Prisma.Decimal | { toFixed(): string };

/** BigInt de centavos -> number seguro. */
export function centsOut(value: bigint): number;
export function centsOut(value: bigint | null): number | null;
export function centsOut(value: bigint | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError('Valor monetário fora do limite');
  return n;
}

export function centsIn(value: number): bigint;
export function centsIn(value: number | null): bigint | null;
export function centsIn(value: number | null): bigint | null {
  return value === null ? null : BigInt(value);
}

/** Decimal do banco -> string normalizada sem zeros à direita ("32.0000" -> "32"). */
export function decOut(value: DecimalLike): string;
export function decOut(value: DecimalLike | null): string | null;
export function decOut(value: DecimalLike | null): string | null {
  if (value === null) return null;
  const s = value.toFixed();
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Date (coluna @db.Date) -> "AAAA-MM-DD". */
export function dateOut(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** "AAAA-MM-DD" -> Date UTC meia-noite (para coluna @db.Date). */
export function dateIn(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
