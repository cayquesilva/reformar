/**
 * Contrato do assistente. O modelo devolve SOMENTE este formato (structured outputs),
 * validado de novo no servidor. Valores monetários e quantidades vêm como TEXTO decimal
 * ("55.00") e são convertidos pelo servidor para centavos/Decimal — nunca float.
 * Campos ausentes vêm null e viram perguntas: o modelo não pode inventar preço ou quantidade.
 */
import { z } from 'zod';
import { EXPENSE_CATEGORIES } from './finance.js';
import { COST_CATEGORIES } from './quote-calc.js';
import { SERVICE_UNITS } from './units.js';

const nullableText = z.string().nullable();

export const aiOutputSchema = z.object({
  intent: z.enum(['create_quote', 'update_quote', 'add_expense', 'query', 'other']),
  reply: z.string().describe('Resposta curta e simples em português do Brasil para o usuário.'),
  questions: z.array(z.string()).describe('Perguntas apenas sobre o que falta ou é ambíguo. Vazio se nada faltar.'),
  quote: z
    .object({
      customerName: nullableText,
      title: nullableText,
      siteDescription: nullableText,
      items: z.array(
        z.object({
          description: z.string(),
          unit: z.enum(SERVICE_UNITS),
          quantity: nullableText.describe('Número decimal com ponto, ex.: "32" ou "12.5". null se não informado.'),
          unitPrice: nullableText.describe('Preço da mão de obra por unidade em reais, ex.: "55.00". null se não informado.'),
          notes: nullableText,
        }),
      ),
      materials: z.array(
        z.object({
          description: z.string(),
          unit: z.string().describe('Unidade do material: m², kg, saco, L, un...'),
          supply: z.enum(['CLIENT', 'COMPANY_BILLED', 'COMPANY_INCLUDED', 'UNKNOWN']),
          sameQuantityAsItemIndex: z.number().int().nullable().describe('Índice do serviço quando a quantidade é a mesma do serviço (ex.: piso = área).'),
          quantity: nullableText,
          unitPrice: nullableText,
        }),
      ),
      costs: z.array(
        z.object({
          category: z.enum(COST_CATEGORIES),
          description: z.string(),
          quantity: nullableText,
          unit: nullableText,
          unitCost: nullableText,
        }),
      ),
      paymentTerms: nullableText,
    })
    .nullable(),
  expense: z
    .object({
      projectHint: nullableText.describe('Como o usuário se referiu à obra ("obra da escola"). null se não disse.'),
      category: z.enum(EXPENSE_CATEGORIES),
      description: z.string(),
      quantity: nullableText,
      unit: nullableText,
      amount: nullableText.describe('Valor TOTAL em reais, ex.: "300.00". Se o usuário disse quantidade × valor unitário, calcule o total.'),
      date: nullableText.describe('AAAA-MM-DD se o usuário informou a data; senão null.'),
      paid: z.boolean().nullable(),
    })
    .nullable(),
  query: z
    .object({
      type: z.enum(['receivable_balance', 'expenses_total', 'project_progress']),
      customerHint: nullableText,
      projectHint: nullableText,
      category: z.enum(EXPENSE_CATEGORIES).nullable(),
      period: z.enum(['this_month', 'last_month', 'all']),
    })
    .nullable(),
});
export type AiOutput = z.infer<typeof aiOutputSchema>;

export const aiMessageSchema = z.object({
  text: z.string().trim().min(2, { message: 'Escreva ou fale o que precisa.' }).max(2000),
  /** Interação anterior (para correções como "troque a metragem para 40"). */
  previousId: z.uuid().nullish().transform((v) => v ?? null),
});

export interface AiCandidate {
  id: string;
  label: string;
}

/** Rascunho de orçamento já convertido pelo servidor (centavos e decimais canônicos). */
export interface AiQuoteDraft {
  customerName: string | null;
  customerCandidates: AiCandidate[];
  title: string | null;
  description: string | null;
  items: { description: string; unit: (typeof SERVICE_UNITS)[number]; quantity: string | null; unitPriceCents: number | null; notes: string | null }[];
  materials: {
    description: string;
    unit: string;
    supply: 'CLIENT' | 'COMPANY_BILLED' | 'COMPANY_INCLUDED' | null;
    itemIndex: number | null;
    baseQuantity: string | null;
    unitPriceCents: number | null;
  }[];
  costs: { category: (typeof COST_CATEGORIES)[number]; description: string; quantity: string | null; unit: string | null; unitCostCents: number | null }[];
  paymentTerms: string | null;
}

export interface AiExpenseDraft {
  projectHint: string | null;
  projectCandidates: AiCandidate[];
  category: (typeof EXPENSE_CATEGORIES)[number];
  description: string;
  quantity: string | null;
  unit: string | null;
  amountCents: number | null;
  date: string;
  paid: boolean | null;
}

export interface AiAnswer {
  text: string;
  /** Dados usados na resposta (rastreabilidade). */
  rows: { label: string; detail: string; amountCents: number | null }[];
}

export interface AiInteractionDTO {
  id: string;
  intent: AiOutput['intent'];
  status: 'PROPOSED' | 'ANSWERED' | 'EXECUTED' | 'REJECTED' | 'FAILED';
  reply: string;
  questions: string[];
  quoteDraft: AiQuoteDraft | null;
  expenseDraft: AiExpenseDraft | null;
  answer: AiAnswer | null;
  resultType: string | null;
  resultId: string | null;
  createdAt: string;
}

export interface AiUsageDTO {
  enabled: boolean;
  month: string;
  requests: number;
  limit: number;
  inputTokens: number;
  outputTokens: number;
}
