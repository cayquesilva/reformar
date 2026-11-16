import { Dec, dec, ROUND_HALF_UP } from './decimal.js';

/**
 * Valores monetários SEMPRE em centavos inteiros (number seguro até 2^53).
 * Nunca usar float para somar ou multiplicar dinheiro.
 */
export type Cents = number;

/** Limite operacional por campo: R$ 1 bilhão. */
export const MAX_CENTS = 100_000_000_000;

export function assertCents(value: number, label = 'valor'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} deve ser um número inteiro de centavos`);
  }
  return value;
}

/** Arredonda um Decimal (em centavos) para centavo inteiro, meio para cima. */
export function roundCents(value: Dec): Cents {
  const rounded = value.toDecimalPlaces(0, ROUND_HALF_UP);
  const n = rounded.toNumber();
  if (!Number.isSafeInteger(n)) throw new RangeError('Valor monetário fora do limite suportado');
  return n;
}

/** quantidade × preço unitário (centavos), arredondado ao centavo. */
export function multiplyCents(quantity: string | Dec, unitCents: Cents): Cents {
  return roundCents(dec(quantity).times(unitCents));
}

/** percentual (ex.: "10" = 10%) de um valor em centavos, arredondado ao centavo. */
export function percentOfCents(cents: Cents, percent: string | Dec): Cents {
  return roundCents(dec(cents).times(dec(percent)).dividedBy(100));
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Formata centavos como moeda brasileira: 176000 -> "R$ 1.760,00". */
export function formatBRL(cents: Cents, opts: { withSymbol?: boolean } = {}): string {
  const withSymbol = opts.withSymbol ?? true;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = Math.floor(abs / 100).toString();
  const decPart = (abs % 100).toString().padStart(2, '0');
  const body = `${groupThousands(intPart)},${decPart}`;
  const value = withSymbol ? `R$ ${body}` : body;
  return negative ? `-${value}` : value;
}

/**
 * Normaliza texto numérico digitado no padrão brasileiro para string decimal com ponto.
 * Aceita: "55", "55,5", "1.760,50", "1760.50", "R$ 1.760,50", "32 m²".
 * Retorna null se não for possível interpretar com segurança.
 */
export function normalizeDecimalInput(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/\s|R\$|m²|m³|%/gi, '');
  if (s === '') return null;
  if (!/^[\d.,]+$/.test(s)) return null;

  const hasComma = s.includes(',');
  if (hasComma) {
    // vírgula = decimal; pontos = milhar
    if ((s.match(/,/g) ?? []).length > 1) return null;
    const [intRaw = '', decRaw = ''] = s.split(',');
    if (intRaw.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(intRaw)) return null;
    const intPart = intRaw.replace(/\./g, '') || '0';
    s = decRaw === '' ? intPart : `${intPart}.${decRaw}`;
  } else if (s.includes('.')) {
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) {
      // "1.234.567" -> milhar
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
      s = s.replace(/\./g, '');
    } else {
      const [intRaw = '', decRaw = ''] = s.split('.');
      // "1.760" (3 dígitos após ponto) é interpretado como milhar no padrão brasileiro
      if (decRaw.length === 3 && intRaw.length >= 1 && intRaw.length <= 3 && intRaw !== '0') {
        s = `${intRaw}${decRaw}`;
      } else {
        s = `${intRaw || '0'}.${decRaw}`;
      }
    }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return dec(s).toFixed();
}

/** Interpreta valor digitado em reais e devolve centavos (null se inválido ou com mais de 2 casas). */
export function parseBRLToCents(input: string): Cents | null {
  const normalized = normalizeDecimalInput(input);
  if (normalized === null) return null;
  const d = dec(normalized);
  if (d.decimalPlaces() > 2) return null;
  const cents = d.times(100);
  if (cents.greaterThan(MAX_CENTS)) return null;
  return cents.toNumber();
}

/** Centavos -> texto editável "1760,00" (sem símbolo, sem milhar) para inputs. */
export function centsToInput(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return formatBRL(cents, { withSymbol: false }).replace(/\./g, '');
}
