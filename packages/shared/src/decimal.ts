import Decimal from 'decimal.js';

/**
 * Instância de Decimal usada em todo o domínio.
 * Arredondamento padrão: ROUND_HALF_UP ("meio para cima"), o mais comum em
 * documentos comerciais brasileiros. Ver docs/DECISOES_TECNICAS.md (DT-07).
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

export const ROUND_HALF_UP = Decimal.ROUND_HALF_UP;
export const ROUND_UP = Decimal.ROUND_UP;

/** Casas decimais máximas armazenadas para quantidades. */
export const QUANTITY_DP = 4;

export function dec(value: string | number | Dec): Dec {
  return new Dec(value);
}

/** Normaliza para string decimal sem zeros à direita ("35.2000" -> "35.2"). */
export function decToString(value: Dec, dp = QUANTITY_DP): string {
  return value.toDecimalPlaces(dp, ROUND_HALF_UP).toFixed();
}
