import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  addDaysISO,
  buildPaymentPlan,
  cancelSchema,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_STATUS_LABEL,
  expensePaySchema,
  expenseSchema,
  formatBRL,
  PAYMENT_METHOD_LABEL,
  paymentPlanSchema,
  RECEIVABLE_KIND_LABEL,
  RECEIVABLE_STATUS_LABEL,
  receivablePaymentSchema,
  receivableSchema,
  receivableStatus,
  splitCents,
  todayISO,
  type ExpenseDTO,
  type FinanceOverviewDTO,
  type ReceivableDTO,
} from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { Prisma, type Db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { centsOut, dateIn, dateOut, decOut } from '../../lib/convert.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { userNames } from '../../lib/users.js';
import { requireTenant, type TenantContext } from '../../plugins/auth.js';
import { attachmentToDTO, MAX_UPLOAD_BYTES, storeUpload } from '../projects/attachments.js';
import { loadProject, loadProjectFinance } from '../projects/service.js';

const idParams = z.object({ id: z.uuid() });

const expenseInclude = {
  project: { select: { id: true, number: true, name: true } },
  attachments: { where: { deletedAt: null } },
} satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function expenseToDTO(e: ExpenseRow, today: string): ExpenseDTO {
  const dueDate = e.dueDate ? dateOut(e.dueDate) : null;
  return {
    id: e.id,
    project: e.project,
    groupId: e.groupId,
    category: e.category,
    description: e.description,
    quantity: e.quantity ? decOut(e.quantity) : null,
    unit: e.unit,
    amountCents: centsOut(e.amountCents),
    date: dateOut(e.date),
    dueDate,
    status: e.status,
    overdue: (e.status === 'COMMITTED' || e.status === 'PLANNED') && !!dueDate && dueDate < today,
    paidOn: e.paidOn ? dateOut(e.paidOn) : null,
    paymentMethod: e.paymentMethod,
    supplier: e.supplier,
    worker: e.worker,
    notes: e.notes,
    cancelReason: e.cancelReason,
    receipts: e.attachments.map((a) => attachmentToDTO(a, () => null)),
    createdAt: e.createdAt.toISOString(),
  };
}

const receivableInclude = {
  project: { select: { id: true, number: true, name: true } },
  customer: { select: { id: true, name: true } },
  payments: { orderBy: { paidOn: 'asc' } },
} satisfies Prisma.ReceivableInclude;
type ReceivableRow = Prisma.ReceivableGetPayload<{ include: typeof receivableInclude }>;

function receivableToDTO(r: ReceivableRow, today: string, nameOf: (id: string | null) => string | null): ReceivableDTO {
  const amountCents = centsOut(r.amountCents);
  const paidCents = r.payments.filter((p) => !p.reversedAt).reduce((a, p) => a + centsOut(p.amountCents), 0);
  const dueDate = dateOut(r.dueDate);
  return {
    id: r.id,
    project: r.project,
    customer: r.customer,
    measurementId: r.measurementId,
    kind: r.kind,
    description: r.description,
    amountCents,
    paidCents,
    balanceCents: Math.max(amountCents - paidCents, 0),
    dueDate,
    status: receivableStatus({ amountCents, paidCents, canceled: !!r.canceledAt, dueDate }, today),
    cancelReason: r.cancelReason,
    payments: r.payments.map((p) => ({
      id: p.id,
      amountCents: centsOut(p.amountCents),
      paidOn: dateOut(p.paidOn),
      method: p.method,
      note: p.note,
      recordedByName: nameOf(p.recordedById),
      reversedAt: p.reversedAt?.toISOString() ?? null,
      reverseReason: p.reverseReason,
    })),
  };
}

async function loadReceivableDTO(db: Db, t: TenantContext, id: string) {
  const r = await db.receivable.findFirst({ where: { id, tenantId: t.tenantId }, include: receivableInclude });
  if (!r) throw notFound('Conta a receber não encontrada.');
  const nameOf = await userNames(db, t.tenantId, r.payments.map((p) => p.recordedById));
  return receivableToDTO(r, todayISO(), nameOf);
}

/** Executa em transação SERIALIZABLE, com 1 nova tentativa em conflito de concorrência. */
async function serializable<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') continue;
      throw e;
    }
  }
}

/** CSV para Excel brasileiro: ";" como separador, BOM UTF-8, vírgula decimal e proteção contra fórmulas. */
function sendCsv(reply: FastifyReply, filename: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    if (v === null) return '';
    let s = typeof v === 'number' ? (v / 100).toFixed(2).replace('.', ',') : v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('Cache-Control', 'private, no-store')
    .send(body);
}

const dateRange = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function financeRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // ================= DESPESAS =================
  app.get('/api/expenses', async (request): Promise<ExpenseDTO[]> => {
    const t = requireTenant(request, 'finance:read');
    const q = dateRange
      .extend({
        projectId: z.uuid().optional(),
        status: z.enum(['PLANNED', 'COMMITTED', 'PAID', 'CANCELED', 'OPEN']).optional(),
        category: z.string().optional(),
        noProject: z.enum(['true']).optional(),
      })
      .parse(request.query);
    const rows = await db.expense.findMany({
      where: {
        tenantId: t.tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.noProject ? { projectId: null } : {}),
        ...(q.status === 'OPEN' ? { status: { in: ['PLANNED', 'COMMITTED'] } } : q.status ? { status: q.status } : {}),
        ...(q.category ? { category: q.category as ExpenseRow['category'] } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: dateIn(q.from) } : {}), ...(q.to ? { lte: dateIn(q.to) } : {}) } } : {}),
      },
      include: expenseInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const today = todayISO();
    return rows.map((r) => expenseToDTO(r, today));
  });

  app.post('/api/expenses', async (request, reply) => {
    const t = requireTenant(request, 'finance:write');
    const input = expenseSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, 'expense.create', async () => {
      const ids = await db.$transaction(async (tx) => {
        const targets = input.allocations ?? (input.projectId ? [{ projectId: input.projectId, percent: '100' }] : [null]);
        const projectIds = targets.filter((x): x is { projectId: string; percent: string } => !!x).map((x) => x.projectId);
        if (projectIds.length) {
          const found = await tx.project.count({ where: { tenantId: t.tenantId, id: { in: projectIds } } });
          if (found !== projectIds.length) throw notFound('Obra não encontrada.');
        }
        const amounts = input.allocations ? splitCents(input.amountCents, input.allocations.map((a) => a.percent)) : [input.amountCents];
        const groupId = input.allocations ? randomUUID() : null;
        const created: string[] = [];
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          const e = await tx.expense.create({
            data: {
              tenantId: t.tenantId,
              projectId: target?.projectId ?? null,
              groupId,
              category: input.category,
              description: input.allocations ? `${input.description} (rateio ${target!.percent}%)` : input.description,
              quantity: input.quantity,
              unit: input.unit,
              amountCents: BigInt(amounts[i]!),
              date: dateIn(input.date),
              dueDate: input.dueDate ? dateIn(input.dueDate) : null,
              status: input.status,
              paidOn: input.status === 'PAID' && input.paidOn ? dateIn(input.paidOn) : null,
              paymentMethod: input.status === 'PAID' ? input.paymentMethod : null,
              supplier: input.supplier,
              worker: input.worker,
              notes: input.notes,
              createdById: t.userId,
            },
          });
          created.push(e.id);
        }
        await audit(tx, {
          tenantId: t.tenantId,
          userId: t.userId,
          action: 'expense.created',
          entityType: 'Expense',
          entityId: created[0],
          data: { amountCents: input.amountCents, category: input.category, status: input.status, split: created.length },
          ip: t.ip,
        });
        return created;
      });
      return { status: 201, body: { ids } };
    });
    return reply.status(result.status).send(result.body);
  });

  app.put('/api/expenses/:id', async (request) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const input = expenseSchema.parse(request.body);
    if (input.allocations) throw badRequest('Rateio só pode ser feito ao criar o lançamento.');
    const before = await db.expense.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!before) throw notFound('Lançamento não encontrado.');
    if (before.status === 'CANCELED') throw conflict('Lançamento cancelado não pode ser alterado.');
    if (input.projectId) await loadProject(db, t.tenantId, input.projectId);
    await db.expense.update({
      where: { id, tenantId: t.tenantId },
      data: {
        projectId: input.projectId,
        category: input.category,
        description: input.description,
        quantity: input.quantity,
        unit: input.unit,
        amountCents: BigInt(input.amountCents),
        date: dateIn(input.date),
        dueDate: input.dueDate ? dateIn(input.dueDate) : null,
        status: input.status,
        paidOn: input.status === 'PAID' && input.paidOn ? dateIn(input.paidOn) : null,
        paymentMethod: input.status === 'PAID' ? input.paymentMethod : null,
        supplier: input.supplier,
        worker: input.worker,
        notes: input.notes,
      },
    });
    await audit(db, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'expense.updated',
      entityType: 'Expense',
      entityId: id,
      data: { amountBefore: centsOut(before.amountCents), amountAfter: input.amountCents, statusBefore: before.status, statusAfter: input.status },
      ip: t.ip,
    });
    const row = await db.expense.findUniqueOrThrow({ where: { id }, include: expenseInclude });
    return expenseToDTO(row, todayISO());
  });

  app.post('/api/expenses/:id/pay', async (request) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const input = expensePaySchema.parse(request.body);
    const r = await db.expense.updateMany({
      where: { id, tenantId: t.tenantId, status: { in: ['PLANNED', 'COMMITTED'] } },
      data: { status: 'PAID', paidOn: dateIn(input.paidOn), paymentMethod: input.paymentMethod },
    });
    if (r.count === 0) throw conflict('Lançamento não está em aberto (já pago, cancelado ou inexistente).');
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'expense.paid', entityType: 'Expense', entityId: id, data: input, ip: t.ip });
    const row = await db.expense.findUniqueOrThrow({ where: { id }, include: expenseInclude });
    return expenseToDTO(row, todayISO());
  });

  app.post('/api/expenses/:id/cancel', async (request) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const { reason } = cancelSchema.parse(request.body);
    const linked = await db.stockMovement.count({ where: { tenantId: t.tenantId, expenseId: id } });
    if (linked > 0) throw conflict('Esta compra tem entrada no estoque. Registre a devolução do material antes de cancelar.');
    const r = await db.expense.updateMany({
      where: { id, tenantId: t.tenantId, status: { not: 'CANCELED' } },
      data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: reason },
    });
    if (r.count === 0) throw notFound('Lançamento não encontrado ou já cancelado.');
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'expense.canceled', entityType: 'Expense', entityId: id, data: { reason }, ip: t.ip });
    return { ok: true };
  });

  app.post('/api/expenses/:id/receipts', { bodyLimit: MAX_UPLOAD_BYTES }, async (request, reply) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const e = await db.expense.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!e) throw notFound('Lançamento não encontrado.');
    const file = await storeUpload(ctx, t, request.body, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], 'receipts');
    const a = await db.attachment.create({
      data: { tenantId: t.tenantId, kind: 'RECEIPT', expenseId: id, projectId: e.projectId, uploadedById: t.userId, ...file },
    });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'expense.receipt_uploaded', entityType: 'Expense', entityId: id, ip: t.ip });
    return reply.status(201).send(attachmentToDTO(a, () => null));
  });

  // ================= CONTAS A RECEBER =================
  app.get('/api/receivables', async (request): Promise<ReceivableDTO[]> => {
    const t = requireTenant(request, 'finance:read');
    const q = dateRange
      .extend({ projectId: z.uuid().optional(), customerId: z.uuid().optional(), open: z.enum(['true']).optional() })
      .parse(request.query);
    const rows = await db.receivable.findMany({
      where: {
        tenantId: t.tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.open ? { canceledAt: null } : {}),
        ...(q.from || q.to ? { dueDate: { ...(q.from ? { gte: dateIn(q.from) } : {}), ...(q.to ? { lte: dateIn(q.to) } : {}) } } : {}),
      },
      include: receivableInclude,
      orderBy: { dueDate: 'asc' },
      take: 300,
    });
    const nameOf = await userNames(db, t.tenantId, rows.flatMap((r) => r.payments.map((p) => p.recordedById)));
    const today = todayISO();
    const list = rows.map((r) => receivableToDTO(r, today, nameOf));
    return q.open ? list.filter((r) => r.balanceCents > 0) : list;
  });

  app.post('/api/receivables', async (request, reply) => {
    const t = requireTenant(request, 'finance:write');
    const input = receivableSchema.parse(request.body);
    const customer = await db.customer.findFirst({ where: { id: input.customerId, tenantId: t.tenantId } });
    if (!customer) throw notFound('Cliente não encontrado.');
    if (input.projectId) {
      const p = await loadProject(db, t.tenantId, input.projectId);
      if (p.customerId !== input.customerId) throw badRequest('O cliente não é o desta obra.');
      const fin = await loadProjectFinance(db, t.tenantId, p);
      if (input.amountCents > fin.unscheduledCents) {
        throw badRequest(
          `O valor passa do saldo do contrato ainda sem cobrança (${formatBRL(fin.unscheduledCents)}). Para cobranças extras (aditivo), lance sem vincular à obra ou ajuste o contrato.`,
          { amountCents: 'Valor acima do saldo do contrato.' },
        );
      }
    }
    const r = await db.receivable.create({
      data: { ...input, amountCents: BigInt(input.amountCents), dueDate: dateIn(input.dueDate), tenantId: t.tenantId, createdById: t.userId },
    });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'receivable.created', entityType: 'Receivable', entityId: r.id, data: { amountCents: input.amountCents }, ip: t.ip });
    return reply.status(201).send(await loadReceivableDTO(db, t, r.id));
  });

  /** Gera entrada + parcelas para o saldo do contrato ainda sem cobrança. */
  app.post('/api/projects/:id/payment-plan', async (request, reply) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const input = paymentPlanSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, `payment-plan:${id}`, async () => {
      const created = await serializable(db, async (tx) => {
        const p = await loadProject(tx, t.tenantId, id);
        const fin = await loadProjectFinance(tx, t.tenantId, p);
        if (fin.unscheduledCents <= 0) throw conflict('Todo o valor do contrato já tem cobrança lançada.');
        let plan;
        try {
          plan = buildPaymentPlan({ totalCents: fin.unscheduledCents, ...input });
        } catch (e) {
          throw badRequest((e as Error).message === 'Entrada inválida' ? 'A entrada é maior que o saldo do contrato.' : 'Informe ao menos uma parcela.');
        }
        for (const item of plan) {
          await tx.receivable.create({
            data: {
              tenantId: t.tenantId,
              projectId: id,
              customerId: p.customerId,
              kind: item.kind,
              description: item.description,
              amountCents: BigInt(item.amountCents),
              dueDate: dateIn(item.dueDate),
              createdById: t.userId,
            },
          });
        }
        await audit(tx, {
          tenantId: t.tenantId,
          userId: t.userId,
          action: 'receivable.plan_created',
          entityType: 'Project',
          entityId: id,
          data: { totalCents: fin.unscheduledCents, items: plan.length },
          ip: t.ip,
        });
        return { count: plan.length, totalCents: fin.unscheduledCents };
      });
      return { status: 201, body: created };
    });
    return reply.status(result.status).send(result.body);
  });

  app.post('/api/receivables/:id/payments', async (request, reply) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const input = receivablePaymentSchema.parse(request.body);
    if (input.paidOn > todayISO()) throw badRequest('A data do pagamento não pode ser no futuro.', { paidOn: 'Use hoje ou antes.' });
    const result = await withIdempotency(db, request, t, `receivable.pay:${id}`, async () => {
      await serializable(db, async (tx) => {
        const r = await tx.receivable.findFirst({
          where: { id, tenantId: t.tenantId },
          include: { payments: { where: { reversedAt: null } } },
        });
        if (!r) throw notFound('Conta a receber não encontrada.');
        if (r.canceledAt) throw conflict('Conta cancelada.');
        const paid = r.payments.reduce((a, p) => a + centsOut(p.amountCents), 0);
        const balance = centsOut(r.amountCents) - paid;
        if (input.amountCents > balance) {
          throw badRequest(`O valor é maior que o saldo em aberto (${formatBRL(balance)}).`, { amountCents: `Máximo ${formatBRL(balance)}` });
        }
        await tx.receivablePayment.create({
          data: {
            tenantId: t.tenantId,
            receivableId: id,
            amountCents: BigInt(input.amountCents),
            paidOn: dateIn(input.paidOn),
            method: input.method,
            note: input.note,
            recordedById: t.userId,
          },
        });
        await audit(tx, {
          tenantId: t.tenantId,
          userId: t.userId,
          action: 'receivable.payment_recorded',
          entityType: 'Receivable',
          entityId: id,
          data: { amountCents: input.amountCents, method: input.method, paidOn: input.paidOn, balanceBefore: balance },
          ip: t.ip,
        });
      });
      return { status: 201, body: (await loadReceivableDTO(db, t, id)) as unknown as Prisma.InputJsonValue };
    });
    return reply.status(result.status).send(result.body);
  });

  /** Estorno: o pagamento continua registrado (com motivo), mas deixa de contar. */
  app.post('/api/receivable-payments/:id/reverse', async (request) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const { reason } = cancelSchema.parse(request.body);
    const p = await db.receivablePayment.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!p) throw notFound('Pagamento não encontrado.');
    const r = await db.receivablePayment.updateMany({
      where: { id, tenantId: t.tenantId, reversedAt: null },
      data: { reversedAt: new Date(), reversedById: t.userId, reverseReason: reason },
    });
    if (r.count === 0) throw conflict('Este pagamento já foi estornado.');
    await audit(db, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'receivable.payment_reversed',
      entityType: 'Receivable',
      entityId: p.receivableId,
      data: { paymentId: id, amountCents: centsOut(p.amountCents), reason },
      ip: t.ip,
    });
    return loadReceivableDTO(db, t, p.receivableId);
  });

  app.post('/api/receivables/:id/cancel', async (request) => {
    const t = requireTenant(request, 'finance:write');
    const { id } = idParams.parse(request.params);
    const { reason } = cancelSchema.parse(request.body);
    const active = await db.receivablePayment.count({ where: { tenantId: t.tenantId, receivableId: id, reversedAt: null } });
    if (active > 0) throw conflict('Há pagamentos registrados. Estorne-os antes de cancelar a cobrança.');
    const r = await db.receivable.updateMany({
      where: { id, tenantId: t.tenantId, canceledAt: null },
      data: { canceledAt: new Date(), cancelReason: reason },
    });
    if (r.count === 0) throw notFound('Conta não encontrada ou já cancelada.');
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'receivable.canceled', entityType: 'Receivable', entityId: id, data: { reason }, ip: t.ip });
    return loadReceivableDTO(db, t, id);
  });

  // ================= VISÃO GERAL E FLUXO DE CAIXA =================
  app.get('/api/finance/overview', async (request): Promise<FinanceOverviewDTO> => {
    const t = requireTenant(request, 'finance:read');
    const today = todayISO();
    const weekEnd = addDaysISO(today, 7);
    const monthPrefix = today.slice(0, 7);
    const monthEnd = `${monthPrefix}-31`;
    const [receivables, expenses] = await Promise.all([
      db.receivable.findMany({
        where: { tenantId: t.tenantId, canceledAt: null },
        select: { amountCents: true, dueDate: true, payments: { where: { reversedAt: null }, select: { amountCents: true, paidOn: true } } },
      }),
      db.expense.findMany({
        where: { tenantId: t.tenantId, status: { not: 'CANCELED' } },
        select: { amountCents: true, status: true, dueDate: true, date: true, paidOn: true },
      }),
    ]);
    const rec = { openCents: 0, overdueCents: 0, dueThisWeekCents: 0, dueThisMonthCents: 0 };
    const pay = { openCents: 0, overdueCents: 0, dueThisWeekCents: 0, dueThisMonthCents: 0 };
    const months: string[] = [];
    for (let i = -3; i <= 2; i++) {
      const d = new Date(`${monthPrefix}-15T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i);
      months.push(d.toISOString().slice(0, 7));
    }
    const flow = new Map(months.map((m) => [m, { month: m, receivedCents: 0, paidCents: 0, expectedInCents: 0, expectedOutCents: 0 }]));
    let monthReceivedCents = 0;
    let monthPaidCents = 0;

    for (const r of receivables) {
      const due = dateOut(r.dueDate);
      const paid = r.payments.reduce((a, p) => a + centsOut(p.amountCents), 0);
      const balance = Math.max(centsOut(r.amountCents) - paid, 0);
      for (const p of r.payments) {
        const m = dateOut(p.paidOn).slice(0, 7);
        const f = flow.get(m);
        if (f) f.receivedCents += centsOut(p.amountCents);
        if (m === monthPrefix) monthReceivedCents += centsOut(p.amountCents);
      }
      if (balance === 0) continue;
      rec.openCents += balance;
      if (due < today) rec.overdueCents += balance;
      else {
        if (due <= weekEnd) rec.dueThisWeekCents += balance;
        if (due <= monthEnd) rec.dueThisMonthCents += balance;
        const f = flow.get(due.slice(0, 7));
        if (f) f.expectedInCents += balance;
      }
    }
    for (const e of expenses) {
      const amount = centsOut(e.amountCents);
      if (e.status === 'PAID' && e.paidOn) {
        const m = dateOut(e.paidOn).slice(0, 7);
        const f = flow.get(m);
        if (f) f.paidCents += amount;
        if (m === monthPrefix) monthPaidCents += amount;
        continue;
      }
      const due = dateOut(e.dueDate ?? e.date);
      pay.openCents += amount;
      if (due < today) pay.overdueCents += amount;
      else {
        if (due <= weekEnd) pay.dueThisWeekCents += amount;
        if (due <= monthEnd) pay.dueThisMonthCents += amount;
        const f = flow.get(due.slice(0, 7));
        if (f) f.expectedOutCents += amount;
      }
    }
    return { receivable: rec, payable: pay, monthReceivedCents, monthPaidCents, cashFlow: [...flow.values()] };
  });

  app.get('/api/projects/:id/finance', async (request) => {
    const t = requireTenant(request, 'finance:read');
    const { id } = idParams.parse(request.params);
    const p = await loadProject(db, t.tenantId, id);
    return loadProjectFinance(db, t.tenantId, p);
  });

  // ================= EXPORTAÇÃO CSV =================
  app.get('/api/finance/export/expenses.csv', async (request, reply) => {
    const t = requireTenant(request, 'finance:read');
    const q = dateRange.parse(request.query);
    const rows = await db.expense.findMany({
      where: {
        tenantId: t.tenantId,
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: dateIn(q.from) } : {}), ...(q.to ? { lte: dateIn(q.to) } : {}) } } : {}),
      },
      include: { project: { select: { number: true, name: true } } },
      orderBy: { date: 'asc' },
    });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'finance.exported', entityType: 'Expense', data: { rows: rows.length }, ip: t.ip });
    return sendCsv(
      reply,
      'despesas.csv',
      ['Data', 'Obra', 'Categoria', 'Descrição', 'Fornecedor', 'Valor (R$)', 'Situação', 'Vencimento', 'Pago em', 'Forma'],
      rows.map((e) => [
        dateOut(e.date),
        e.project ? `${e.project.number} - ${e.project.name}` : 'Empresa (sem obra)',
        EXPENSE_CATEGORY_LABEL[e.category],
        e.description,
        e.supplier,
        centsOut(e.amountCents),
        EXPENSE_STATUS_LABEL[e.status],
        e.dueDate ? dateOut(e.dueDate) : null,
        e.paidOn ? dateOut(e.paidOn) : null,
        e.paymentMethod ? PAYMENT_METHOD_LABEL[e.paymentMethod] : null,
      ]),
    );
  });

  app.get('/api/finance/export/receivables.csv', async (request, reply) => {
    const t = requireTenant(request, 'finance:read');
    const rows = await db.receivable.findMany({ where: { tenantId: t.tenantId }, include: receivableInclude, orderBy: { dueDate: 'asc' } });
    const today = todayISO();
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'finance.exported', entityType: 'Receivable', data: { rows: rows.length }, ip: t.ip });
    return sendCsv(
      reply,
      'contas-a-receber.csv',
      ['Vencimento', 'Cliente', 'Obra', 'Tipo', 'Descrição', 'Valor (R$)', 'Recebido (R$)', 'Saldo (R$)', 'Situação'],
      rows.map((r) => {
        const d = receivableToDTO(r, today, () => null);
        return [
          d.dueDate,
          d.customer.name,
          d.project ? `${d.project.number} - ${d.project.name}` : null,
          RECEIVABLE_KIND_LABEL[d.kind],
          d.description,
          d.amountCents,
          d.paidCents,
          d.balanceCents,
          RECEIVABLE_STATUS_LABEL[d.status],
        ];
      }),
    );
  });
}

