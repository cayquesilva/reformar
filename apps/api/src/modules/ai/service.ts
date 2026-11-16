import {
  dec,
  normalizeDecimalInput,
  physicalProgress,
  receivableStatus,
  todayISO,
  type AiAnswer,
  type AiCandidate,
  type AiExpenseDraft,
  type AiInteractionDTO,
  type AiOutput,
  type AiQuoteDraft,
  formatBRL,
  formatPercent,
  EXPENSE_CATEGORY_LABEL,
} from '@reformar/shared';
import type { Db, Prisma } from '../../db.js';
import { centsOut, dateIn, dateOut, decOut } from '../../lib/convert.js';
import type { TenantContext } from '../../plugins/auth.js';

/** "55.00" / "55,50" -> centavos; null se ausente ou inválido (vira campo para o usuário preencher). */
export function moneyText(v: string | null): number | null {
  if (!v) return null;
  const n = normalizeDecimalInput(v);
  if (n === null) return null;
  const d = dec(n);
  if (d.decimalPlaces() > 2 || d.lessThanOrEqualTo(0) || d.greaterThan(1_000_000_000)) return null;
  return d.times(100).toNumber();
}

export function quantityText(v: string | null): string | null {
  if (!v) return null;
  const n = normalizeDecimalInput(v);
  if (n === null) return null;
  const d = dec(n);
  if (d.lessThanOrEqualTo(0) || d.decimalPlaces() > 4 || d.greaterThanOrEqualTo(1e10)) return null;
  return d.toFixed();
}

const STOP = new Set(['obra', 'obras', 'casa', 'da', 'do', 'de', 'dos', 'das', 'na', 'no', 'cliente', 'seu', 'dona', 'sr', 'sra', 'escola', 'reforma']);
export function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function words(hint: string) {
  const all = norm(hint).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const specific = all.filter((w) => !STOP.has(w));
  return specific.length ? specific : all;
}
/** Correspondência simples e explicável por palavras (sem adivinhação semântica). */
export function matches(hint: string, ...texts: (string | null | undefined)[]) {
  const target = norm(texts.filter(Boolean).join(' '));
  return words(hint).some((w) => target.includes(w));
}

async function customerCandidates(db: Db, tenantId: string, name: string | null): Promise<AiCandidate[]> {
  if (!name) return [];
  const all = await db.customer.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, name: true, city: true }, take: 2000 });
  return all
    .filter((c) => matches(name, c.name))
    .slice(0, 5)
    .map((c) => ({ id: c.id, label: c.city ? `${c.name} (${c.city})` : c.name }));
}

async function projectsMatching(db: Db, tenantId: string, hint: string | null) {
  const all = await db.project.findMany({
    where: { tenantId, status: { not: 'CANCELED' } },
    select: { id: true, number: true, name: true, customer: { select: { name: true } }, siteAddress: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  return hint ? all.filter((p) => matches(hint, p.name, p.customer.name, p.siteAddress)) : all;
}

export async function buildQuoteDraft(db: Db, t: TenantContext, q: NonNullable<AiOutput['quote']>): Promise<AiQuoteDraft> {
  return {
    customerName: q.customerName,
    customerCandidates: await customerCandidates(db, t.tenantId, q.customerName),
    title: q.title,
    description: q.siteDescription,
    items: q.items.map((i) => ({
      description: i.description,
      unit: i.unit,
      quantity: quantityText(i.quantity),
      unitPriceCents: moneyText(i.unitPrice),
      notes: i.notes,
    })),
    materials: q.materials.map((m) => ({
      description: m.description,
      unit: m.unit || 'un',
      supply: m.supply === 'UNKNOWN' ? null : m.supply,
      itemIndex:
        m.sameQuantityAsItemIndex !== null && m.sameQuantityAsItemIndex >= 0 && m.sameQuantityAsItemIndex < q.items.length
          ? m.sameQuantityAsItemIndex
          : null,
      baseQuantity: quantityText(m.quantity),
      unitPriceCents: m.supply === 'CLIENT' ? null : moneyText(m.unitPrice),
    })),
    costs: q.costs.map((c) => ({
      category: c.category,
      description: c.description,
      quantity: quantityText(c.quantity),
      unit: c.unit,
      unitCostCents: moneyText(c.unitCost),
    })),
    paymentTerms: q.paymentTerms,
  };
}

export async function buildExpenseDraft(db: Db, t: TenantContext, e: NonNullable<AiOutput['expense']>): Promise<AiExpenseDraft> {
  const projects = e.projectHint ? await projectsMatching(db, t.tenantId, e.projectHint) : [];
  const date = e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date <= todayISO() ? e.date : todayISO();
  return {
    projectHint: e.projectHint,
    projectCandidates: projects.slice(0, 5).map((p) => ({
      id: p.id,
      label: `Obra ${String(p.number).padStart(4, '0')} · ${p.name} (${p.customer.name})`,
    })),
    category: e.category,
    description: e.description,
    quantity: quantityText(e.quantity),
    unit: e.unit,
    amountCents: moneyText(e.amount),
    date,
    paid: e.paid,
  };
}

function periodRange(period: 'this_month' | 'last_month' | 'all', today: string): { from: string | null; to: string | null; label: string } {
  if (period === 'all') return { from: null, to: null, label: 'desde o início' };
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (period === 'this_month') return { from: `${today.slice(0, 7)}-01`, to: today, label: 'neste mês' };
  const d = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: d.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: 'no mês passado' };
}

/** Consultas somente-leitura, calculadas pelo servidor com dados rastreáveis. */
export async function answerQuery(db: Db, t: TenantContext, q: NonNullable<AiOutput['query']>): Promise<AiAnswer> {
  const today = todayISO();
  const needsMoney = q.type !== 'project_progress';
  if (needsMoney && !t.permissions.includes('finance:read')) {
    return { text: 'Você não tem permissão para ver valores financeiros.', rows: [] };
  }
  if (!t.permissions.includes('project:read') && q.type === 'project_progress') {
    return { text: 'Você não tem permissão para ver obras.', rows: [] };
  }
  const hint = q.projectHint ?? q.customerHint;
  const projects = hint ? await projectsMatching(db, t.tenantId, hint) : null;
  if (hint && projects && projects.length === 0 && q.type !== 'receivable_balance') {
    return { text: `Não encontrei obra que combine com “${hint}”. Confira o nome da obra ou do cliente.`, rows: [] };
  }
  const where = projects ? { projectId: { in: projects.map((p) => p.id) } } : {};
  const scope = projects ? ` (${projects.map((p) => `obra ${String(p.number).padStart(4, '0')} ${p.name}`).join(', ')})` : '';

  if (q.type === 'expenses_total') {
    const range = periodRange(q.period, today);
    const rows = await db.expense.findMany({
      where: {
        tenantId: t.tenantId,
        status: { in: ['COMMITTED', 'PAID'] },
        ...where,
        ...(q.category ? { category: q.category } : {}),
        ...(range.from ? { date: { gte: dateIn(range.from), lte: dateIn(range.to!) } } : {}),
      },
      orderBy: { date: 'asc' },
      take: 500,
    });
    const total = rows.reduce((a, r) => a + centsOut(r.amountCents), 0);
    const what = q.category ? EXPENSE_CATEGORY_LABEL[q.category].toLowerCase() : 'gastos';
    return {
      text: `Total de ${what} ${range.label}${scope}: ${formatBRL(total)} em ${rows.length} lançamento(s).`,
      rows: rows.slice(0, 30).map((r) => ({ label: r.description, detail: dateOut(r.date).split('-').reverse().join('/'), amountCents: centsOut(r.amountCents) })),
    };
  }

  if (q.type === 'receivable_balance') {
    const customerFilter = q.customerHint && !projects?.length ? q.customerHint : null;
    const rows = await db.receivable.findMany({
      where: { tenantId: t.tenantId, canceledAt: null, ...where },
      include: { customer: { select: { name: true } }, payments: { where: { reversedAt: null }, select: { amountCents: true } } },
      orderBy: { dueDate: 'asc' },
      take: 500,
    });
    const open = rows
      .filter((r) => !customerFilter || matches(customerFilter, r.customer.name))
      .map((r) => {
        const paid = r.payments.reduce((a, p) => a + centsOut(p.amountCents), 0);
        const amount = centsOut(r.amountCents);
        return { r, balance: Math.max(amount - paid, 0), status: receivableStatus({ amountCents: amount, paidCents: paid, canceled: false, dueDate: dateOut(r.dueDate) }, today) };
      })
      .filter((x) => x.balance > 0);
    const total = open.reduce((a, x) => a + x.balance, 0);
    const overdue = open.filter((x) => x.status === 'OVERDUE').reduce((a, x) => a + x.balance, 0);
    const who = customerFilter ? ` de “${customerFilter}”` : scope;
    return {
      text: open.length
        ? `Falta receber${who}: ${formatBRL(total)}${overdue ? `, sendo ${formatBRL(overdue)} em atraso` : ''}.`
        : `Não há valores em aberto${who}.`,
      rows: open.slice(0, 30).map((x) => ({
        label: `${x.r.description} · ${x.r.customer.name}`,
        detail: `vence ${dateOut(x.r.dueDate).split('-').reverse().join('/')}`,
        amountCents: x.balance,
      })),
    };
  }

  // project_progress
  const list = (projects ?? (await projectsMatching(db, t.tenantId, null))).slice(0, 10);
  const stages = await db.projectStage.findMany({ where: { tenantId: t.tenantId, projectId: { in: list.map((p) => p.id) } } });
  const rows = list.map((p) => {
    const pct = physicalProgress(
      stages.filter((s) => s.projectId === p.id).map((s) => ({ plannedQuantity: decOut(s.plannedQuantity), measuredQuantity: decOut(s.measuredQuantity), unitPriceCents: centsOut(s.unitPriceCents) })),
    );
    return { label: `Obra ${String(p.number).padStart(4, '0')} · ${p.name}`, detail: `${formatPercent(pct)} executado`, amountCents: null };
  });
  return { text: rows.length ? `Andamento de ${rows.length} obra(s):` : 'Nenhuma obra encontrada.', rows };
}

type InteractionRow = { id: string; intent: string; status: AiInteractionDTO['status']; output: Prisma.JsonValue; resultType: string | null; resultId: string | null; createdAt: Date };

export function interactionToDTO(i: InteractionRow): AiInteractionDTO {
  const o = i.output as unknown as {
    model: AiOutput;
    quoteDraft: AiQuoteDraft | null;
    expenseDraft: AiExpenseDraft | null;
    answer: AiAnswer | null;
  };
  return {
    id: i.id,
    intent: i.intent as AiInteractionDTO['intent'],
    status: i.status,
    reply: o.model.reply,
    questions: o.model.questions,
    quoteDraft: o.quoteDraft,
    expenseDraft: o.expenseDraft,
    answer: o.answer,
    resultType: i.resultType,
    resultId: i.resultId,
    createdAt: i.createdAt.toISOString(),
  };
}
