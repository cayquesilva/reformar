import { dec, Dec, QUANTITY_DP, ROUND_HALF_UP } from './decimal.js';

export const SERVICE_UNITS = ['M2', 'M', 'M3', 'UNIT', 'DAY', 'HOUR', 'LUMP_SUM'] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];

export const SERVICE_UNIT_INFO: Record<ServiceUnit, { short: string; label: string; example: string }> = {
  M2: { short: 'm²', label: 'Metro quadrado (m²)', example: 'piso, parede, reboco, pintura' },
  M: { short: 'm', label: 'Metro linear (m)', example: 'rodapé, rufo, tubulação' },
  M3: { short: 'm³', label: 'Metro cúbico (m³)', example: 'concreto, aterro' },
  UNIT: { short: 'un', label: 'Unidade / ponto', example: 'ponto elétrico, louça, porta' },
  DAY: { short: 'diária', label: 'Diária', example: 'dia de trabalho' },
  HOUR: { short: 'h', label: 'Hora', example: 'hora de serviço' },
  LUMP_SUM: { short: 'vb', label: 'Empreitada (preço fechado)', example: 'serviço completo por valor fixo' },
};

export function unitShort(unit: ServiceUnit): string {
  return SERVICE_UNIT_INFO[unit].short;
}

/**
 * Formata quantidade no padrão brasileiro: "35.2" -> "35,2"; "1500" -> "1.500".
 */
export function formatQuantity(value: string | Dec, maxDecimals = QUANTITY_DP): string {
  const d = dec(value).toDecimalPlaces(maxDecimals, ROUND_HALF_UP);
  const [intPart = '0', decPart] = d.abs().toFixed().split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = d.isNegative() && !d.isZero() ? '-' : '';
  return decPart ? `${sign}${grouped},${decPart}` : `${sign}${grouped}`;
}

/** Formata percentual: "10" -> "10%", "2.5" -> "2,5%". */
export function formatPercent(value: string | Dec): string {
  return `${formatQuantity(value, 2)}%`;
}
