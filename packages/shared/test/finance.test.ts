import { describe, expect, it } from 'vitest';
import {
  addMonthsISO,
  buildPaymentPlan,
  measurementValue,
  physicalProgress,
  projectFinanceSummary,
  receivableStatus,
  splitCents,
} from '../src/finance.js';
import { expenseSchema, stockMovementSchema } from '../src/schemas-ops.js';

describe('splitCents (soma exata ao centavo)', () => {
  it('divide R$ 100,00 em 3 parcelas iguais', () => {
    const parts = splitCents(10000, [1, 1, 1]);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b)).toBe(10000);
  });
  it('rateio por percentual 33,33/33,33/33,34', () => {
    const parts = splitCents(100, ['33.33', '33.33', '33.34']);
    expect(parts.reduce((a, b) => a + b)).toBe(100);
  });
  it('sempre fecha o total em muitos casos', () => {
    for (let total = 1; total < 2000; total += 37) {
      for (let n = 1; n <= 12; n++) {
        expect(splitCents(total, Array(n).fill(1)).reduce((a, b) => a + b)).toBe(total);
      }
    }
  });
});

describe('plano de pagamento', () => {
  it('entrada + 3 parcelas mensais que somam o contrato', () => {
    const plan = buildPaymentPlan({
      totalCents: 212720,
      downPaymentCents: 63816, // 30%
      downPaymentDate: '2026-11-10',
      installments: 3,
      firstInstallmentDate: '2026-12-10',
    });
    expect(plan.map((p) => p.amountCents)).toEqual([63816, 49635, 49635, 49634]);
    expect(plan.reduce((a, p) => a + p.amountCents, 0)).toBe(212720);
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10']);
    expect(plan[0]!.kind).toBe('DOWN_PAYMENT');
    expect(plan[3]!.description).toBe('Parcela 3 de 3');
  });
  it('vencimento no dia 31 vira último dia do mês', () => {
    expect(addMonthsISO('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsISO('2026-12-15', 2)).toBe('2027-02-15');
  });
  it('recusa entrada maior que o total', () => {
    expect(() =>
      buildPaymentPlan({ totalCents: 100, downPaymentCents: 200, downPaymentDate: '2026-01-01', installments: 1, firstInstallmentDate: '2026-02-01' }),
    ).toThrow();
  });
});

describe('situação da conta a receber', () => {
  const base = { amountCents: 1000, paidCents: 0, canceled: false, dueDate: '2026-11-10' };
  it.each([
    [{ ...base }, '2026-11-05', 'OPEN'],
    [{ ...base, paidCents: 400 }, '2026-11-05', 'PARTIAL'],
    [{ ...base, paidCents: 1000 }, '2026-12-01', 'PAID'],
    [{ ...base, paidCents: 400 }, '2026-11-11', 'OVERDUE'],
    [{ ...base, canceled: true }, '2026-11-11', 'CANCELED'],
  ] as const)('%o em %s => %s', (r, today, expected) => {
    expect(receivableStatus(r, today)).toBe(expected);
  });
});

describe('medição e avanço físico', () => {
  it('valor da medição = quantidade × preço da etapa', () => {
    expect(measurementValue('12.5', 5500)).toBe(68750);
  });
  it('avanço ponderado pelo valor das etapas', () => {
    // piso: 32 m² × 55 = 1760 (metade feita); rodapé: 20 m × 15 = 300 (nada feito)
    const pct = physicalProgress([
      { plannedQuantity: '32', measuredQuantity: '16', unitPriceCents: 5500 },
      { plannedQuantity: '20', measuredQuantity: '0', unitPriceCents: 1500 },
    ]);
    expect(pct).toBe('42.72'); // 880 / 2060
  });
  it('sem valores, usa média dos percentuais', () => {
    expect(
      physicalProgress([
        { plannedQuantity: '10', measuredQuantity: '10', unitPriceCents: 0 },
        { plannedQuantity: '10', measuredQuantity: '0', unitPriceCents: 0 },
      ]),
    ).toBe('50');
  });
});

describe('resumo financeiro da obra', () => {
  const summary = projectFinanceSummary(
    {
      contractTotalCents: 200000,
      plannedCostCents: 80000,
      plannedTaxCents: 12000,
      plannedContingencyCents: 8000,
      receivables: [
        { amountCents: 60000, paidCents: 60000, canceled: false, dueDate: '2026-11-01' },
        { amountCents: 70000, paidCents: 30000, canceled: false, dueDate: '2026-11-03' }, // atrasada, parcial
        { amountCents: 70000, paidCents: 0, canceled: false, dueDate: '2026-12-01' },
        { amountCents: 99999, paidCents: 0, canceled: true, dueDate: '2026-12-01' },
      ],
      expenses: [
        { amountCents: 50000, status: 'PAID', category: 'MATERIAL', dueDate: null },
        { amountCents: 40000, status: 'COMMITTED', category: 'TEAM', dueDate: '2026-11-01' },
        { amountCents: 5000, status: 'PLANNED', category: 'FOOD', dueDate: null },
        { amountCents: 7000, status: 'CANCELED', category: 'FOOD', dueDate: null },
      ],
    },
    '2026-11-05',
  );

  it('separa recebido, a receber e atraso; contrato não muda', () => {
    expect(summary.contractTotalCents).toBe(200000);
    expect(summary.receivedCents).toBe(90000);
    expect(summary.toReceiveCents).toBe(110000);
    expect(summary.overdueReceivableCents).toBe(40000);
    expect(summary.unscheduledCents).toBe(0);
  });
  it('custo lançado × pago × previsto, sem contar cancelado', () => {
    expect(summary.actualCostCents).toBe(90000);
    expect(summary.paidCostCents).toBe(50000);
    expect(summary.payableCents).toBe(40000);
    expect(summary.overduePayableCents).toBe(40000);
    expect(summary.forecastCostCents).toBe(5000);
    expect(summary.costsByCategory.MATERIAL).toBe(50000);
    expect(summary.costsByCategory.FOOD).toBe(0);
    expect(summary.budgetOverrun).toBe(true);
    expect(summary.costVarianceCents).toBe(10000);
  });
  it('resultado estimado (competência) ≠ saldo de caixa', () => {
    expect(summary.estimatedResultCents).toBe(200000 - 90000 - 12000);
    expect(summary.plannedResultCents).toBe(200000 - 80000 - 12000 - 8000);
    expect(summary.cashBalanceCents).toBe(90000 - 50000);
  });
});

describe('validação de despesas e estoque', () => {
  const base = { category: 'FOOD', description: 'Almoço', amountCents: 2500, date: '2026-11-05' };
  it('despesa paga exige data e forma de pagamento', () => {
    expect(expenseSchema.safeParse({ ...base, status: 'PAID' }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, status: 'PAID', paidOn: '2026-11-05', paymentMethod: 'PIX' }).success).toBe(true);
  });
  it('rateio precisa somar 100%', () => {
    const a = '6f1d3c1e-8c1a-4f7e-9a51-2c6f1b7c0d11';
    const b = '6f1d3c1e-8c1a-4f7e-9a51-2c6f1b7c0d12';
    expect(expenseSchema.safeParse({ ...base, allocations: [{ projectId: a, percent: '50' }, { projectId: b, percent: '40' }] }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, allocations: [{ projectId: a, percent: '50' }, { projectId: b, percent: '50' }] }).success).toBe(true);
  });
  it('uso na obra exige local de origem; entrada só via compra', () => {
    const m = '6f1d3c1e-8c1a-4f7e-9a51-2c6f1b7c0d11';
    expect(stockMovementSchema.safeParse({ materialId: m, type: 'OUT', quantity: '2', date: '2026-11-05' }).success).toBe(false);
    expect(stockMovementSchema.safeParse({ materialId: m, type: 'IN', quantity: '2', toLocationId: m, date: '2026-11-05' }).success).toBe(false);
  });
});
