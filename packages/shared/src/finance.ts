/**
 * Regras financeiras e de andamento da obra (puras, testáveis).
 * Indicadores DISTINTOS e sempre rotulados:
 * - Recebido (caixa que entrou) × A receber (saldo em aberto) × Valor do contrato (nunca muda por recebimento)
 * - Custo lançado (comprometido + pago) × Custo pago (caixa que saiu)
 * - Resultado estimado (competência) × Saldo de caixa da obra
 */
import { dec, ROUND_HALF_UP } from './decimal.js';
import { multiplyCents, type Cents } from './money.js';
import { COST_CATEGORIES, type CostCategory } from './quote-calc.js';

export const EXPENSE_CATEGORIES = ['MATERIAL', ...COST_CATEGORIES] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  MATERIAL: 'Material',
  TEAM: 'Equipe (diárias, ajudantes)',
  FOOD: 'Alimentação',
  LODGING: 'Hospedagem',
  TRANSPORT: 'Transporte e combustível',
  EQUIPMENT: 'Equipamentos',
  THIRD_PARTY: 'Terceiros',
  INDIRECT: 'Custos indiretos',
  OTHER: 'Outros',
};

export const EXPENSE_STATUSES = ['PLANNED', 'COMMITTED', 'PAID', 'CANCELED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  PLANNED: 'Previsto',
  COMMITTED: 'A pagar',
  PAID: 'Pago',
  CANCELED: 'Cancelado',
};

export const PAYMENT_METHODS = ['PIX', 'CASH', 'TRANSFER', 'CARD', 'BOLETO', 'CHECK', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: 'PIX',
  CASH: 'Dinheiro',
  TRANSFER: 'Transferência',
  CARD: 'Cartão',
  BOLETO: 'Boleto',
  CHECK: 'Cheque',
  OTHER: 'Outro',
};

export const RECEIVABLE_KINDS = ['DOWN_PAYMENT', 'INSTALLMENT', 'MEASUREMENT', 'MILESTONE', 'OTHER'] as const;
export type ReceivableKind = (typeof RECEIVABLE_KINDS)[number];
export const RECEIVABLE_KIND_LABEL: Record<ReceivableKind, string> = {
  DOWN_PAYMENT: 'Entrada',
  INSTALLMENT: 'Parcela',
  MEASUREMENT: 'Medição',
  MILESTONE: 'Etapa concluída',
  OTHER: 'Outro',
};

export type ReceivableStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELED';
export const RECEIVABLE_STATUS_LABEL: Record<ReceivableStatus, string> = {
  OPEN: 'Em aberto',
  PARTIAL: 'Pago em parte',
  PAID: 'Pago',
  OVERDUE: 'Atrasado',
  CANCELED: 'Cancelado',
};

export const PROJECT_STATUSES = ['PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNED: 'A iniciar',
  IN_PROGRESS: 'Em andamento',
  PAUSED: 'Parada',
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
};

/**
 * Divide `total` em partes proporcionais aos pesos, somando EXATAMENTE o total
 * (método do maior resto; empates favorecem as primeiras partes).
 */
export function splitCents(total: Cents, weights: (string | number)[]): Cents[] {
  if (weights.length === 0) return [];
  const w = weights.map((x) => dec(x));
  const sumW = w.reduce((a, b) => a.plus(b), dec(0));
  if (sumW.lessThanOrEqualTo(0)) throw new RangeError('Pesos devem somar mais que zero');
  const raw = w.map((x) => dec(total).times(x).dividedBy(sumW));
  const floors = raw.map((r) => r.floor().toNumber());
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(r.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors;
}

/** Soma meses mantendo o dia (limitado ao último dia do mês): 31/01 + 1 = 28 ou 29/02. */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export interface PaymentPlanInput {
  totalCents: Cents;
  /** Entrada em centavos (0 = sem entrada). */
  downPaymentCents: Cents;
  downPaymentDate: string;
  installments: number;
  firstInstallmentDate: string;
}

export interface PlannedReceivable {
  kind: ReceivableKind;
  description: string;
  amountCents: Cents;
  dueDate: string;
}

/** Gera entrada + parcelas mensais iguais que somam exatamente o total. */
export function buildPaymentPlan(p: PaymentPlanInput): PlannedReceivable[] {
  if (p.downPaymentCents < 0 || p.downPaymentCents > p.totalCents) throw new RangeError('Entrada inválida');
  if (!Number.isInteger(p.installments) || p.installments < 0 || p.installments > 120) throw new RangeError('Parcelas inválidas');
  const out: PlannedReceivable[] = [];
  if (p.downPaymentCents > 0) {
    out.push({ kind: 'DOWN_PAYMENT', description: 'Entrada', amountCents: p.downPaymentCents, dueDate: p.downPaymentDate });
  }
  const rest = p.totalCents - p.downPaymentCents;
  if (rest > 0) {
    if (p.installments === 0) throw new RangeError('Informe ao menos uma parcela para o saldo');
    const parts = splitCents(rest, Array(p.installments).fill(1));
    parts.forEach((amountCents, i) =>
      out.push({
        kind: 'INSTALLMENT',
        description: `Parcela ${i + 1} de ${p.installments}`,
        amountCents,
        dueDate: addMonthsISO(p.firstInstallmentDate, i),
      }),
    );
  }
  return out;
}

export function receivableStatus(
  r: { amountCents: Cents; paidCents: Cents; canceled: boolean; dueDate: string },
  today: string,
): ReceivableStatus {
  if (r.canceled) return 'CANCELED';
  if (r.paidCents >= r.amountCents) return 'PAID';
  if (r.dueDate < today) return 'OVERDUE';
  if (r.paidCents > 0) return 'PARTIAL';
  return 'OPEN';
}

/** Valor de uma medição para uma etapa: quantidade × preço unitário, ao centavo. */
export function measurementValue(quantity: string, unitPriceCents: Cents): Cents {
  return multiplyCents(quantity, unitPriceCents);
}

export interface StageProgressInput {
  plannedQuantity: string;
  measuredQuantity: string;
  unitPriceCents: Cents;
}

/**
 * Avanço físico da obra (%): ponderado pelo valor das etapas; se nenhuma etapa
 * tiver valor, média simples dos percentuais por quantidade. 2 casas.
 */
export function physicalProgress(stages: StageProgressInput[]): string {
  if (stages.length === 0) return '0';
  const pct = (s: StageProgressInput) => {
    const planned = dec(s.plannedQuantity);
    if (planned.lessThanOrEqualTo(0)) return dec(0);
    return dec(s.measuredQuantity).dividedBy(planned).times(100);
  };
  const totalValue = stages.reduce((a, s) => a.plus(dec(s.plannedQuantity).times(s.unitPriceCents)), dec(0));
  let result;
  if (totalValue.greaterThan(0)) {
    const measuredValue = stages.reduce((a, s) => a.plus(dec(s.measuredQuantity).times(s.unitPriceCents)), dec(0));
    result = measuredValue.dividedBy(totalValue).times(100);
  } else {
    result = stages.reduce((a, s) => a.plus(pct(s)), dec(0)).dividedBy(stages.length);
  }
  return result.toDecimalPlaces(2, ROUND_HALF_UP).toFixed();
}

export interface ProjectFinanceInput {
  contractTotalCents: Cents;
  plannedCostCents: Cents;
  plannedTaxCents: Cents;
  plannedContingencyCents: Cents;
  receivables: { amountCents: Cents; paidCents: Cents; canceled: boolean; dueDate: string }[];
  expenses: { amountCents: Cents; status: ExpenseStatus; category: ExpenseCategory; dueDate: string | null }[];
}

export interface ProjectFinanceSummary {
  contractTotalCents: Cents;
  /** Soma das contas a receber não canceladas. */
  scheduledCents: Cents;
  /** Valor do contrato ainda sem conta a receber lançada. */
  unscheduledCents: Cents;
  receivedCents: Cents;
  toReceiveCents: Cents;
  overdueReceivableCents: Cents;
  plannedCostCents: Cents;
  /** Comprometido + pago (competência). */
  actualCostCents: Cents;
  paidCostCents: Cents;
  payableCents: Cents;
  overduePayableCents: Cents;
  forecastCostCents: Cents;
  costsByCategory: Record<ExpenseCategory, Cents>;
  /** actualCost − plannedCost (positivo = gastou mais que o previsto). */
  costVarianceCents: Cents;
  budgetOverrun: boolean;
  /** Resultado estimado (competência) = contrato − custo lançado − imposto estimado. */
  estimatedResultCents: Cents;
  /** Lucro previsto no orçamento = contrato − custo previsto − imposto − reserva. */
  plannedResultCents: Cents;
  /** Saldo de caixa da obra = recebido − pago. */
  cashBalanceCents: Cents;
}

export function projectFinanceSummary(input: ProjectFinanceInput, today: string): ProjectFinanceSummary {
  const active = input.receivables.filter((r) => !r.canceled);
  const scheduledCents = active.reduce((a, r) => a + r.amountCents, 0);
  const receivedCents = active.reduce((a, r) => a + Math.min(r.paidCents, r.amountCents), 0);
  const toReceiveCents = active.reduce((a, r) => a + Math.max(r.amountCents - r.paidCents, 0), 0);
  const overdueReceivableCents = active
    .filter((r) => r.dueDate < today)
    .reduce((a, r) => a + Math.max(r.amountCents - r.paidCents, 0), 0);

  const costsByCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<ExpenseCategory, Cents>;
  let actualCostCents = 0;
  let paidCostCents = 0;
  let payableCents = 0;
  let overduePayableCents = 0;
  let forecastCostCents = 0;
  for (const e of input.expenses) {
    if (e.status === 'CANCELED') continue;
    if (e.status === 'PLANNED') {
      forecastCostCents += e.amountCents;
      continue;
    }
    actualCostCents += e.amountCents;
    costsByCategory[e.category] += e.amountCents;
    if (e.status === 'PAID') paidCostCents += e.amountCents;
    else {
      payableCents += e.amountCents;
      if (e.dueDate && e.dueDate < today) overduePayableCents += e.amountCents;
    }
  }
  const costVarianceCents = actualCostCents - input.plannedCostCents;
  return {
    contractTotalCents: input.contractTotalCents,
    scheduledCents,
    unscheduledCents: Math.max(input.contractTotalCents - scheduledCents, 0),
    receivedCents,
    toReceiveCents,
    overdueReceivableCents,
    plannedCostCents: input.plannedCostCents,
    actualCostCents,
    paidCostCents,
    payableCents,
    overduePayableCents,
    forecastCostCents,
    costsByCategory,
    costVarianceCents,
    budgetOverrun: input.plannedCostCents > 0 && actualCostCents > input.plannedCostCents,
    estimatedResultCents: input.contractTotalCents - actualCostCents - input.plannedTaxCents,
    plannedResultCents:
      input.contractTotalCents - input.plannedCostCents - input.plannedTaxCents - input.plannedContingencyCents,
    cashBalanceCents: receivedCents - paidCostCents,
  };
}

/** Categoria de despesa a partir da categoria de custo do orçamento. */
export function costToExpenseCategory(c: CostCategory): ExpenseCategory {
  return c;
}
