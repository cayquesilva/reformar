/** Validação das operações da Fase 2 (obras, medição, financeiro, estoque). */
import { z } from 'zod';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PROJECT_STATUSES, RECEIVABLE_KINDS } from './finance.js';
import { centsSchema, decimalString, isoDate } from './schemas.js';
import { UF_LIST } from './schemas.js';
import { SERVICE_UNITS } from './units.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Use no máximo ${max} caracteres.` })
    .nullish()
    .transform((v) => (v ? v : null));
const required = (max: number, message: string) => z.string().trim().min(2, { message }).max(max);
const positiveCents = centsSchema.refine((v) => v > 0, { message: 'Informe um valor maior que zero.' });
const optionalDate = isoDate.nullish().transform((v) => v ?? null);
const uf = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (UF_LIST as readonly string[]).includes(v), { message: 'UF inválida.' });

// ---------- Obras ----------
export const projectFromQuoteSchema = z.object({
  quoteId: z.uuid(),
  /** Confirmação explícita: converter não acontece por engano. */
  confirm: z.literal(true, { message: 'Confirme a criação da obra.' }),
  startDate: optionalDate,
  expectedEndDate: optionalDate,
});

export const projectCreateSchema = z.object({
  customerId: z.uuid({ message: 'Escolha o cliente.' }),
  name: required(160, 'Dê um nome à obra.'),
  contractTotalCents: centsSchema,
  siteAddress: text(200),
  siteCity: text(100),
  siteState: uf,
  startDate: optionalDate,
  expectedEndDate: optionalDate,
  notes: text(2000),
});

export const projectUpdateSchema = z.object({
  name: required(160, 'Dê um nome à obra.'),
  status: z.enum(PROJECT_STATUSES),
  siteAddress: text(200),
  siteCity: text(100),
  siteState: uf,
  startDate: optionalDate,
  expectedEndDate: optionalDate,
  notes: text(2000),
});

export const stageSchema = z.object({
  name: required(200, 'Informe o nome da etapa.'),
  unit: z.enum(SERVICE_UNITS),
  plannedQuantity: decimalString(4),
  unitPriceCents: centsSchema.default(0),
});

export const measurementSchema = z.object({
  measuredOn: isoDate,
  notes: text(2000),
  items: z
    .array(
      z.object({
        stageId: z.uuid(),
        quantity: decimalString(4),
        notes: text(500),
      }),
    )
    .max(300)
    .refine((items) => new Set(items.map((i) => i.stageId)).size === items.length, {
      message: 'A mesma etapa aparece duas vezes.',
    }),
});

export const measurementConfirmSchema = z.object({
  /** Opcional: gerar cobrança (conta a receber) desta medição, com valor e vencimento conferidos. */
  receivable: z.object({ amountCents: positiveCents, dueDate: isoDate }).nullish().transform((v) => v ?? null),
});

export const diarySchema = z.object({
  date: isoDate,
  text: z.string().trim().min(2, { message: 'Escreva o que aconteceu.' }).max(5000),
  weather: text(60),
  workersCount: z.number().int().min(0).max(1000).nullish().transform((v) => v ?? null),
});

// ---------- Despesas ----------
export const expenseSchema = z
  .object({
    projectId: z.uuid().nullish().transform((v) => v ?? null),
    category: z.enum(EXPENSE_CATEGORIES),
    description: required(200, 'Descreva o gasto.'),
    quantity: decimalString(4).nullish().transform((v) => v ?? null),
    unit: text(20),
    amountCents: positiveCents,
    date: isoDate,
    dueDate: optionalDate,
    status: z.enum(['PLANNED', 'COMMITTED', 'PAID']).default('COMMITTED'),
    paidOn: optionalDate,
    paymentMethod: z.enum(PAYMENT_METHODS).nullish().transform((v) => v ?? null),
    supplier: text(160),
    worker: text(160),
    notes: text(1000),
    /** Rateio entre obras: percentuais que somam 100. Se presente, ignora projectId. */
    allocations: z
      .array(z.object({ projectId: z.uuid(), percent: decimalString(2) }))
      .min(2, { message: 'Rateio precisa de pelo menos 2 obras.' })
      .max(50)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((e, ctx) => {
    if (e.status === 'PAID' && (!e.paidOn || !e.paymentMethod)) {
      ctx.addIssue({ code: 'custom', path: ['paidOn'], message: 'Informe a data e a forma de pagamento.' });
    }
    if (e.allocations) {
      const total = e.allocations.reduce((a, x) => a + Number(x.percent), 0);
      if (Math.abs(total - 100) > 0.001) {
        ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Os percentuais do rateio devem somar 100%.' });
      }
      if (new Set(e.allocations.map((a) => a.projectId)).size !== e.allocations.length) {
        ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Obra repetida no rateio.' });
      }
    }
  });
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const expensePaySchema = z.object({
  paidOn: isoDate,
  paymentMethod: z.enum(PAYMENT_METHODS),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, { message: 'Informe o motivo.' }).max(500),
});

// ---------- Recebimentos ----------
export const receivableSchema = z.object({
  projectId: z.uuid().nullish().transform((v) => v ?? null),
  customerId: z.uuid(),
  kind: z.enum(RECEIVABLE_KINDS),
  description: required(200, 'Descreva a cobrança.'),
  amountCents: positiveCents,
  dueDate: isoDate,
});

export const paymentPlanSchema = z.object({
  downPaymentCents: centsSchema.default(0),
  downPaymentDate: isoDate,
  installments: z.number().int().min(0).max(120),
  firstInstallmentDate: isoDate,
  confirm: z.literal(true, { message: 'Confirme a criação das parcelas.' }),
});

export const receivablePaymentSchema = z.object({
  amountCents: positiveCents,
  paidOn: isoDate,
  method: z.enum(PAYMENT_METHODS),
  note: text(500),
});

// ---------- Estoque ----------
export const materialSchema = z.object({
  name: required(160, 'Informe o nome do material.'),
  unit: z.string().trim().min(1, { message: 'Informe a unidade.' }).max(20),
  packageLabel: text(30),
  packageSize: decimalString(4).nullish().transform((v) => v ?? null),
  minStock: decimalString(4, { allowZero: true }).nullish().transform((v) => v ?? null),
  active: z.boolean().default(true),
});

export const locationSchema = z.object({ name: required(120, 'Informe o nome do local.') });

export const STOCK_MOVEMENT_TYPES = ['IN', 'OUT', 'TRANSFER', 'LOSS', 'RETURN', 'ADJUST_IN', 'ADJUST_OUT'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const STOCK_MOVEMENT_LABEL: Record<StockMovementType, string> = {
  IN: 'Entrada',
  OUT: 'Uso na obra',
  TRANSFER: 'Transferência',
  LOSS: 'Perda / quebra',
  RETURN: 'Devolução ao fornecedor',
  ADJUST_IN: 'Ajuste de inventário (+)',
  ADJUST_OUT: 'Ajuste de inventário (−)',
};

/** Tipos que tiram do local de origem e tipos que colocam no destino. */
export const MOVEMENT_NEEDS_FROM: readonly StockMovementType[] = ['OUT', 'TRANSFER', 'LOSS', 'RETURN', 'ADJUST_OUT'];
export const MOVEMENT_NEEDS_TO: readonly StockMovementType[] = ['IN', 'TRANSFER', 'ADJUST_IN'];

export const stockMovementSchema = z
  .object({
    materialId: z.uuid(),
    type: z.enum(STOCK_MOVEMENT_TYPES),
    quantity: decimalString(4),
    fromLocationId: z.uuid().nullish().transform((v) => v ?? null),
    toLocationId: z.uuid().nullish().transform((v) => v ?? null),
    projectId: z.uuid().nullish().transform((v) => v ?? null),
    date: isoDate,
    notes: text(500),
  })
  .superRefine((m, ctx) => {
    if (MOVEMENT_NEEDS_FROM.includes(m.type) && !m.fromLocationId) {
      ctx.addIssue({ code: 'custom', path: ['fromLocationId'], message: 'Escolha de onde sai o material.' });
    }
    if (MOVEMENT_NEEDS_TO.includes(m.type) && !m.toLocationId) {
      ctx.addIssue({ code: 'custom', path: ['toLocationId'], message: 'Escolha para onde vai o material.' });
    }
    if (m.type === 'TRANSFER' && m.fromLocationId && m.fromLocationId === m.toLocationId) {
      ctx.addIssue({ code: 'custom', path: ['toLocationId'], message: 'Origem e destino iguais.' });
    }
    if (m.type === 'IN') {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'Use "Registrar compra" para entradas com custo.' });
    }
  });

/** Compra de material: UM lançamento financeiro (despesa) + UMA entrada física no estoque. */
export const purchaseSchema = z
  .object({
    materialId: z.uuid(),
    quantity: decimalString(4),
    toLocationId: z.uuid(),
    projectId: z.uuid().nullish().transform((v) => v ?? null),
    amountCents: positiveCents,
    date: isoDate,
    supplier: text(160),
    status: z.enum(['COMMITTED', 'PAID']).default('PAID'),
    dueDate: optionalDate,
    paidOn: optionalDate,
    paymentMethod: z.enum(PAYMENT_METHODS).nullish().transform((v) => v ?? null),
    notes: text(500),
  })
  .superRefine((p, ctx) => {
    if (p.status === 'PAID' && (!p.paidOn || !p.paymentMethod)) {
      ctx.addIssue({ code: 'custom', path: ['paidOn'], message: 'Informe a data e a forma de pagamento.' });
    }
  });
