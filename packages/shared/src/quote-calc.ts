/**
 * Cálculo de orçamento — fonte única de verdade, usada pela API (autoritativa)
 * e pelo front-end (prévia em tempo real).
 *
 * Regras (ver docs/DECISOES_TECNICAS.md DT-07 e DT-08):
 * - Dinheiro em centavos inteiros; quantidades em Decimal.
 * - Cada linha é arredondada ao centavo (meio para cima) e os totais são somas das linhas.
 * - Quantidade calculada (com perda) é arredondada a 4 casas; embalagens são arredondadas PARA CIMA.
 * - Nenhum coeficiente de consumo é inventado: só é usado o que o usuário informou.
 */
import { Dec, dec, decToString, QUANTITY_DP, ROUND_HALF_UP } from './decimal.js';
import { Cents, formatBRL, multiplyCents, percentOfCents, roundCents } from './money.js';
import { formatPercent, formatQuantity, ServiceUnit, unitShort } from './units.js';

export const MATERIAL_SUPPLY = ['CLIENT', 'COMPANY_BILLED', 'COMPANY_INCLUDED'] as const;
export type MaterialSupply = (typeof MATERIAL_SUPPLY)[number];

export const MATERIAL_SUPPLY_INFO: Record<MaterialSupply, { label: string; short: string }> = {
  CLIENT: { label: 'O cliente compra', short: 'Cliente compra' },
  COMPANY_BILLED: { label: 'Eu compro e cobro à parte no orçamento', short: 'Cobrado à parte' },
  COMPANY_INCLUDED: { label: 'Eu compro e já está incluído no preço do serviço', short: 'Incluído no preço' },
};

export const COST_CATEGORIES = [
  'TEAM',
  'FOOD',
  'LODGING',
  'TRANSPORT',
  'EQUIPMENT',
  'THIRD_PARTY',
  'INDIRECT',
  'OTHER',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_CATEGORY_INFO: Record<CostCategory, { label: string; example: string }> = {
  TEAM: { label: 'Equipe (ajudantes, diárias)', example: '2 ajudantes × 3 diárias' },
  FOOD: { label: 'Alimentação', example: 'almoço, café, água' },
  LODGING: { label: 'Hospedagem', example: 'pousada, aluguel temporário' },
  TRANSPORT: { label: 'Transporte', example: 'combustível, frete, pedágio' },
  EQUIPMENT: { label: 'Equipamentos', example: 'aluguel de betoneira, andaime' },
  THIRD_PARTY: { label: 'Terceiros', example: 'eletricista, encanador contratado' },
  INDIRECT: { label: 'Custos indiretos', example: 'ferramentas, desgaste, administração' },
  OTHER: { label: 'Outros', example: 'outras despesas' },
};

export const DISCOUNT_TYPES = ['NONE', 'AMOUNT', 'PERCENT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface QuoteItemInput {
  serviceId?: string | null;
  description: string;
  unit: ServiceUnit;
  /** Quantidade em string decimal com ponto ("32.5"). */
  quantity: string;
  /** Preço da mão de obra por unidade, em centavos. */
  unitPriceCents: Cents;
  notes?: string | null;
}

export interface QuoteMaterialInput {
  description: string;
  /** Unidade da quantidade do material (m², kg, saco, L, un...). */
  unit: string;
  supply: MaterialSupply;
  /** Se informado, a quantidade base vem do serviço de índice itemIndex × coefficient. */
  itemIndex?: number | null;
  coefficient?: string | null;
  /** Quantidade base informada manualmente (usada se não houver itemIndex). */
  baseQuantity?: string | null;
  /** Percentual de perda ("10" = 10%). */
  lossPercent: string;
  /** Quanto cada embalagem rende/contém, na unidade do material (ex.: 2.5 m² por caixa). */
  packageSize?: string | null;
  packageLabel?: string | null;
  /** Preço por embalagem (se packageSize) ou por unidade do material, em centavos. */
  unitPriceCents?: Cents | null;
  notes?: string | null;
}

export interface QuoteCostInput {
  category: CostCategory;
  description: string;
  quantity: string;
  unit?: string | null;
  unitCostCents: Cents;
  /** Se true, o valor também é cobrado do cliente como linha à parte. */
  chargeToClient: boolean;
}

export interface QuotePricingInput {
  items: QuoteItemInput[];
  materials: QuoteMaterialInput[];
  costs: QuoteCostInput[];
  discountType: DiscountType;
  discountPercent?: string | null;
  discountCents?: Cents | null;
  /** Imposto estimado sobre o total (custo interno, não somado ao preço). */
  taxPercent: string;
  /** Reserva para imprevistos, % sobre os custos internos. */
  contingencyPercent: string;
}

export interface ItemCalc {
  index: number;
  description: string;
  unit: ServiceUnit;
  quantity: string;
  unitPriceCents: Cents;
  totalCents: Cents;
  explanation: string;
}

export interface MaterialCalc {
  index: number;
  description: string;
  unit: string;
  supply: MaterialSupply;
  baseSource: 'MANUAL' | 'FROM_ITEM';
  baseQuantity: string;
  lossPercent: string;
  /** Quantidade calculada (base + perda), antes do arredondamento comercial. */
  calculatedQuantity: string;
  /** Número de embalagens a comprar (arredondado para cima), se houver embalagem. */
  packages: number | null;
  packageSize: string | null;
  packageLabel: string | null;
  /** Quantidade a comprar (em unidade do material). */
  purchaseQuantity: string;
  unitPriceCents: Cents | null;
  /** Custo para a empresa (0 se o cliente compra). */
  totalCents: Cents;
  /** Valor que aparece para o cliente (só COMPANY_BILLED). */
  billedCents: Cents;
  steps: string[];
}

export interface CostCalc {
  index: number;
  category: CostCategory;
  description: string;
  quantity: string;
  unit: string | null;
  unitCostCents: Cents;
  totalCents: Cents;
  chargeToClient: boolean;
  explanation: string;
}

export type QuoteWarningCode =
  | 'NO_ITEMS'
  | 'ZERO_TOTAL'
  | 'DISCOUNT_EXCEEDS_SUBTOTAL'
  | 'NEGATIVE_PROFIT'
  | 'MATERIAL_WITHOUT_QUANTITY'
  | 'MATERIAL_WITHOUT_PRICE'
  | 'MATERIAL_INVALID_ITEM';

export interface QuoteWarning {
  code: QuoteWarningCode;
  message: string;
  index?: number;
}

export interface QuoteTotals {
  /** Mão de obra (serviços). */
  laborCents: Cents;
  /** Materiais cobrados à parte do cliente. */
  materialsBilledCents: Cents;
  /** Despesas repassadas ao cliente. */
  costsBilledCents: Cents;
  /** Soma do que é cobrado do cliente antes do desconto. */
  subtotalCents: Cents;
  discountCents: Cents;
  /** Valor final para o cliente. */
  totalCents: Cents;

  /** Custo de materiais comprados pela empresa (cobrados à parte + incluídos). */
  materialsCostCents: Cents;
  /** Outros custos da obra (equipe, alimentação, transporte...). */
  otherCostsCents: Cents;
  costsByCategory: Record<CostCategory, Cents>;
  /** materialsCost + otherCosts. */
  internalCostsCents: Cents;
  contingencyCents: Cents;
  taxCents: Cents;
  /** total − imposto − custos internos − reserva. Estimativa, não é saldo de caixa. */
  estimatedProfitCents: Cents;
  /** Margem sobre o total, em % com 2 casas ("23.5"), ou null se total = 0. */
  marginPercent: string | null;
}

export interface QuoteCalculation {
  items: ItemCalc[];
  materials: MaterialCalc[];
  costs: CostCalc[];
  totals: QuoteTotals;
  warnings: QuoteWarning[];
  /** Memória de cálculo dos totais, em linguagem simples. */
  summarySteps: string[];
}

function q(value: string | Dec): string {
  return formatQuantity(value);
}

function emptyByCategory(): Record<CostCategory, Cents> {
  return Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, Cents>;
}

export function calculateItem(item: QuoteItemInput, index: number): ItemCalc {
  const totalCents = multiplyCents(item.quantity, item.unitPriceCents);
  const u = unitShort(item.unit);
  return {
    index,
    description: item.description,
    unit: item.unit,
    quantity: decToString(dec(item.quantity)),
    unitPriceCents: item.unitPriceCents,
    totalCents,
    explanation: `${q(item.quantity)} ${u} × ${formatBRL(item.unitPriceCents)} = ${formatBRL(totalCents)}`,
  };
}

export function calculateMaterial(
  material: QuoteMaterialInput,
  index: number,
  items: QuoteItemInput[],
  warnings: QuoteWarning[] = [],
): MaterialCalc {
  const steps: string[] = [];
  let base: Dec = dec(0);
  let baseSource: MaterialCalc['baseSource'] = 'MANUAL';
  const u = material.unit;

  if (material.itemIndex !== null && material.itemIndex !== undefined) {
    const item = items[material.itemIndex];
    if (!item) {
      warnings.push({
        code: 'MATERIAL_INVALID_ITEM',
        message: `O material "${material.description}" está ligado a um serviço que não existe mais.`,
        index,
      });
    } else {
      baseSource = 'FROM_ITEM';
      const coefficient = dec(material.coefficient ?? '1');
      base = dec(item.quantity).times(coefficient).toDecimalPlaces(QUANTITY_DP, ROUND_HALF_UP);
      steps.push(
        `Quantidade base: ${q(item.quantity)} ${unitShort(item.unit)} (${item.description}) × ${q(coefficient)} ${u} por ${unitShort(item.unit)} = ${q(base)} ${u}`,
      );
    }
  } else if (material.baseQuantity) {
    base = dec(material.baseQuantity);
    steps.push(`Quantidade base informada: ${q(base)} ${u}`);
  }

  if (base.isZero()) {
    warnings.push({
      code: 'MATERIAL_WITHOUT_QUANTITY',
      message: `Informe a quantidade do material "${material.description}".`,
      index,
    });
  }

  const loss = dec(material.lossPercent || '0');
  const calculated = base.times(dec(1).plus(loss.dividedBy(100))).toDecimalPlaces(QUANTITY_DP, ROUND_HALF_UP);
  if (!loss.isZero()) {
    steps.push(`Perda de ${formatPercent(loss)}: ${q(base)} × ${q(dec(1).plus(loss.dividedBy(100)))} = ${q(calculated)} ${u}`);
  }

  let packages: number | null = null;
  let purchase = calculated;
  const packageSize = material.packageSize ? dec(material.packageSize) : null;
  const packageLabel = material.packageLabel?.trim() || null;
  if (packageSize && packageSize.greaterThan(0)) {
    const exact = calculated.dividedBy(packageSize);
    packages = exact.toDecimalPlaces(0, Dec.ROUND_CEIL).toNumber();
    purchase = packageSize.times(packages);
    const label = packageLabel ?? 'embalagem';
    steps.push(
      `Embalagem com ${q(packageSize)} ${u}: ${q(calculated)} ÷ ${q(packageSize)} = ${q(exact.toDecimalPlaces(2, ROUND_HALF_UP))}, arredondado para cima: ${packages} ${label}(s)`,
    );
  }

  let totalCents = 0;
  const unitPrice = material.unitPriceCents ?? null;
  if (material.supply === 'CLIENT') {
    steps.push('Comprado pelo cliente: não entra no valor do orçamento.');
  } else if (unitPrice === null) {
    warnings.push({
      code: 'MATERIAL_WITHOUT_PRICE',
      message: `Informe o preço do material "${material.description}".`,
      index,
    });
  } else if (packages !== null) {
    totalCents = roundCents(dec(packages).times(unitPrice));
    steps.push(`${packages} × ${formatBRL(unitPrice)} = ${formatBRL(totalCents)}`);
  } else {
    totalCents = multiplyCents(calculated, unitPrice);
    steps.push(`${q(calculated)} ${u} × ${formatBRL(unitPrice)} = ${formatBRL(totalCents)}`);
  }

  if (material.supply === 'COMPANY_INCLUDED' && unitPrice !== null) {
    steps.push('Já incluído no preço do serviço: conta como custo, não aparece cobrado à parte.');
  }

  return {
    index,
    description: material.description,
    unit: u,
    supply: material.supply,
    baseSource,
    baseQuantity: decToString(base),
    lossPercent: decToString(loss, 2),
    calculatedQuantity: decToString(calculated),
    packages,
    packageSize: packageSize ? decToString(packageSize) : null,
    packageLabel,
    purchaseQuantity: decToString(purchase),
    unitPriceCents: unitPrice,
    totalCents,
    billedCents: material.supply === 'COMPANY_BILLED' ? totalCents : 0,
    steps,
  };
}

export function calculateCost(cost: QuoteCostInput, index: number): CostCalc {
  const totalCents = multiplyCents(cost.quantity, cost.unitCostCents);
  const unit = cost.unit?.trim() || null;
  return {
    index,
    category: cost.category,
    description: cost.description,
    quantity: decToString(dec(cost.quantity)),
    unit,
    unitCostCents: cost.unitCostCents,
    totalCents,
    chargeToClient: cost.chargeToClient,
    explanation: `${q(cost.quantity)}${unit ? ` ${unit}` : ''} × ${formatBRL(cost.unitCostCents)} = ${formatBRL(totalCents)}`,
  };
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

export function calculateQuote(input: QuotePricingInput): QuoteCalculation {
  const warnings: QuoteWarning[] = [];
  const items = input.items.map((item, i) => calculateItem(item, i));
  const materials = input.materials.map((m, i) => calculateMaterial(m, i, input.items, warnings));
  const costs = input.costs.map((c, i) => calculateCost(c, i));

  const laborCents = sum(items.map((i) => i.totalCents));
  const materialsBilledCents = sum(materials.map((m) => m.billedCents));
  const costsBilledCents = sum(costs.filter((c) => c.chargeToClient).map((c) => c.totalCents));
  const subtotalCents = laborCents + materialsBilledCents + costsBilledCents;

  let discountCents = 0;
  if (input.discountType === 'PERCENT' && input.discountPercent) {
    discountCents = percentOfCents(subtotalCents, input.discountPercent);
  } else if (input.discountType === 'AMOUNT' && input.discountCents) {
    discountCents = input.discountCents;
  }
  if (discountCents > subtotalCents) {
    warnings.push({
      code: 'DISCOUNT_EXCEEDS_SUBTOTAL',
      message: 'O desconto é maior que o valor do orçamento. Ele foi limitado ao subtotal.',
    });
    discountCents = subtotalCents;
  }
  const totalCents = subtotalCents - discountCents;

  const materialsCostCents = sum(materials.map((m) => m.totalCents));
  const costsByCategory = emptyByCategory();
  for (const c of costs) costsByCategory[c.category] += c.totalCents;
  const otherCostsCents = sum(costs.map((c) => c.totalCents));
  const internalCostsCents = materialsCostCents + otherCostsCents;
  const contingencyCents = percentOfCents(internalCostsCents, input.contingencyPercent || '0');
  const taxCents = percentOfCents(totalCents, input.taxPercent || '0');
  const estimatedProfitCents = totalCents - taxCents - internalCostsCents - contingencyCents;
  const marginPercent =
    totalCents > 0
      ? dec(estimatedProfitCents).times(100).dividedBy(totalCents).toDecimalPlaces(2, ROUND_HALF_UP).toFixed()
      : null;

  if (items.length === 0) {
    warnings.push({ code: 'NO_ITEMS', message: 'Adicione pelo menos um serviço ao orçamento.' });
  }
  if (items.length > 0 && totalCents === 0) {
    warnings.push({ code: 'ZERO_TOTAL', message: 'O valor total do orçamento está zerado.' });
  }
  if (totalCents > 0 && estimatedProfitCents < 0) {
    warnings.push({
      code: 'NEGATIVE_PROFIT',
      message: `Atenção: com esses valores a obra dá prejuízo estimado de ${formatBRL(-estimatedProfitCents)}.`,
    });
  }

  const summarySteps: string[] = [];
  summarySteps.push(`Mão de obra (serviços): ${formatBRL(laborCents)}`);
  if (materialsBilledCents) summarySteps.push(`+ Materiais cobrados à parte: ${formatBRL(materialsBilledCents)}`);
  if (costsBilledCents) summarySteps.push(`+ Despesas repassadas ao cliente: ${formatBRL(costsBilledCents)}`);
  summarySteps.push(`= Subtotal: ${formatBRL(subtotalCents)}`);
  if (discountCents) {
    const pct = input.discountType === 'PERCENT' && input.discountPercent ? ` (${formatPercent(input.discountPercent)})` : '';
    summarySteps.push(`− Desconto${pct}: ${formatBRL(discountCents)}`);
  }
  summarySteps.push(`= Total para o cliente: ${formatBRL(totalCents)}`);
  summarySteps.push(`Custos da obra (materiais comprados por você + despesas): ${formatBRL(internalCostsCents)}`);
  if (contingencyCents) {
    summarySteps.push(`Reserva para imprevistos (${formatPercent(input.contingencyPercent)} dos custos): ${formatBRL(contingencyCents)}`);
  }
  if (taxCents) summarySteps.push(`Imposto estimado (${formatPercent(input.taxPercent)} do total): ${formatBRL(taxCents)}`);
  summarySteps.push(
    `Lucro estimado = ${formatBRL(totalCents)} − ${formatBRL(internalCostsCents)}${contingencyCents ? ` − ${formatBRL(contingencyCents)}` : ''}${taxCents ? ` − ${formatBRL(taxCents)}` : ''} = ${formatBRL(estimatedProfitCents)}`,
  );

  return {
    items,
    materials,
    costs,
    totals: {
      laborCents,
      materialsBilledCents,
      costsBilledCents,
      subtotalCents,
      discountCents,
      totalCents,
      materialsCostCents,
      otherCostsCents,
      costsByCategory,
      internalCostsCents,
      contingencyCents,
      taxCents,
      estimatedProfitCents,
      marginPercent,
    },
    warnings,
    summarySteps,
  };
}
