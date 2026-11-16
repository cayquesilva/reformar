import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiMessageSchema, expenseSchema, resolveLocale, todayISO, type AiOutput, type AiUsageDTO } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import type { Prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { dateIn } from '../../lib/convert.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { requireTenant, type TenantContext } from '../../plugins/auth.js';
import { answerQuery, buildExpenseDraft, buildQuoteDraft, interactionToDTO } from './service.js';

const idParams = z.object({ id: z.uuid() });
const month = () => todayISO().slice(0, 7);

export async function aiRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const limitFor = async (tenantId: string) => {
    // Limite do plano (Fase 4) ou, sem assinatura, o padrão do servidor.
    const sub = await db.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } });
    return sub?.plan.aiMonthlyRequests ?? ctx.config.aiMonthlyRequestLimit;
  };

  async function usageOf(t: TenantContext): Promise<AiUsageDTO> {
    const u = await db.aiUsage.findUnique({ where: { tenantId_month: { tenantId: t.tenantId, month: month() } } });
    return {
      enabled: !!ctx.assistant,
      month: month(),
      requests: u?.requests ?? 0,
      limit: await limitFor(t.tenantId),
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
    };
  }

  app.get('/api/ai/usage', async (request) => usageOf(requireTenant(request, 'ai:use')));

  app.get('/api/ai/interactions', async (request) => {
    const t = requireTenant(request, 'ai:use');
    const rows = await db.aiInteraction.findMany({
      where: { tenantId: t.tenantId, userId: t.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(interactionToDTO);
  });

  /** Interpreta o pedido. Só PROPÕE (orçamento/gasto) ou responde consultas; não grava dados de negócio. */
  app.post('/api/ai/messages', { config: { rateLimit: { max: ctx.config.isTest ? 1000 : 20, timeWindow: '1 minute' } } }, async (request) => {
    const t = requireTenant(request, 'ai:use');
    const assistant = ctx.assistant;
    if (!assistant) throw new AppError(503, 'AI_NOT_CONFIGURED', 'O assistente não está configurado neste servidor. Use os formulários.');
    const input = aiMessageSchema.parse(request.body);

    const usage = await usageOf(t);
    if (usage.requests >= usage.limit) {
      throw new AppError(429, 'AI_LIMIT', `Limite mensal do assistente atingido (${usage.limit} pedidos). Use os formulários ou mude de plano.`);
    }

    let currentQuote: AiOutput['quote'] = null;
    if (input.previousId) {
      const prev = await db.aiInteraction.findFirst({ where: { id: input.previousId, tenantId: t.tenantId, userId: t.userId } });
      if (!prev) throw notFound('Conversa anterior não encontrada.');
      currentQuote = (prev.output as unknown as { model: AiOutput }).model.quote;
    }

    // Conta o pedido antes de chamar o provedor (protege o orçamento de consumo mesmo se falhar).
    await db.aiUsage.upsert({
      where: { tenantId_month: { tenantId: t.tenantId, month: month() } },
      create: { tenantId: t.tenantId, month: month(), requests: 1 },
      update: { requests: { increment: 1 } },
    });
    const result = await assistant.interpret({
      text: input.text,
      today: todayISO(),
      currentQuote,
      language: resolveLocale(request.headers['accept-language']),
    });
    await db.aiUsage.update({
      where: { tenantId_month: { tenantId: t.tenantId, month: month() } },
      data: { inputTokens: { increment: result.inputTokens }, outputTokens: { increment: result.outputTokens } },
    });

    const o = result.output;
    const isQuote = (o.intent === 'create_quote' || o.intent === 'update_quote') && !!o.quote;
    const isExpense = o.intent === 'add_expense' && !!o.expense;
    const isQuery = o.intent === 'query' && !!o.query;
    const quoteDraft = isQuote ? await buildQuoteDraft(db, t, o.quote!) : null;
    const expenseDraft = isExpense ? await buildExpenseDraft(db, t, o.expense!) : null;
    const answer = isQuery ? await answerQuery(db, t, o.query!) : null;

    const row = await db.aiInteraction.create({
      data: {
        tenantId: t.tenantId,
        userId: t.userId,
        previousId: input.previousId,
        inputText: input.text,
        intent: o.intent,
        output: { model: o, quoteDraft, expenseDraft, answer } as unknown as Prisma.InputJsonValue,
        status: isQuote || isExpense ? 'PROPOSED' : 'ANSWERED',
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
    await audit(db, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'ai.interpreted',
      entityType: 'AiInteraction',
      entityId: row.id,
      data: { intent: o.intent, model: result.model },
      ip: t.ip,
    });
    return interactionToDTO(row);
  });

  /** Confirma o gasto proposto, com os valores CONFERIDOS/EDITADOS pelo usuário. Uma única vez. */
  app.post('/api/ai/interactions/:id/confirm-expense', async (request, reply) => {
    const t = requireTenant(request, 'ai:use');
    if (!t.permissions.includes('finance:write')) throw forbidden('Você não tem permissão para registrar gastos.');
    const { id } = idParams.parse(request.params);
    const input = expenseSchema.parse(request.body);
    if (input.allocations) throw new AppError(400, 'BAD_REQUEST', 'Rateio não é feito pelo assistente.');
    const created = await db.$transaction(async (tx) => {
      const i = await tx.aiInteraction.findFirst({ where: { id, tenantId: t.tenantId } });
      if (!i) throw notFound('Proposta não encontrada.');
      if (i.intent !== 'add_expense') throw conflict('Esta proposta não é de gasto.');
      if (input.projectId) {
        const p = await tx.project.findFirst({ where: { id: input.projectId, tenantId: t.tenantId } });
        if (!p) throw notFound('Obra não encontrada.');
      }
      // Transição atômica: impede gravação duplicada em retransmissão/duplo toque.
      const lock = await tx.aiInteraction.updateMany({
        where: { id, tenantId: t.tenantId, status: 'PROPOSED' },
        data: { status: 'EXECUTED', executedById: t.userId, executedAt: new Date() },
      });
      if (lock.count === 0) throw conflict('Esta proposta já foi confirmada ou descartada.', 'ALREADY_DONE');
      const e = await tx.expense.create({
        data: {
          tenantId: t.tenantId,
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
          notes: input.notes,
          createdById: t.userId,
        },
      });
      await tx.aiInteraction.update({ where: { id }, data: { resultType: 'expense', resultId: e.id } });
      await audit(tx, {
        tenantId: t.tenantId,
        userId: t.userId,
        action: 'ai.action_executed',
        entityType: 'Expense',
        entityId: e.id,
        data: { interactionId: id, amountCents: input.amountCents, category: input.category },
        ip: t.ip,
      });
      return e.id;
    });
    return reply.status(201).send({ expenseId: created });
  });

  /** Marca que o rascunho de orçamento proposto foi salvo pelo usuário no editor. */
  app.post('/api/ai/interactions/:id/applied', async (request) => {
    const t = requireTenant(request, 'ai:use');
    const { id } = idParams.parse(request.params);
    const { quoteId } = z.object({ quoteId: z.uuid() }).parse(request.body);
    const quote = await db.quote.findFirst({ where: { id: quoteId, tenantId: t.tenantId } });
    if (!quote) throw notFound('Orçamento não encontrado.');
    const r = await db.aiInteraction.updateMany({
      where: { id, tenantId: t.tenantId, status: 'PROPOSED', intent: { in: ['create_quote', 'update_quote'] } },
      data: { status: 'EXECUTED', resultType: 'quote', resultId: quoteId, executedById: t.userId, executedAt: new Date() },
    });
    if (r.count === 0) throw conflict('Proposta já usada ou inexistente.', 'ALREADY_DONE');
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'ai.action_executed', entityType: 'Quote', entityId: quoteId, data: { interactionId: id }, ip: t.ip });
    return { ok: true };
  });

  app.post('/api/ai/interactions/:id/reject', async (request) => {
    const t = requireTenant(request, 'ai:use');
    const { id } = idParams.parse(request.params);
    const r = await db.aiInteraction.updateMany({
      where: { id, tenantId: t.tenantId, status: 'PROPOSED' },
      data: { status: 'REJECTED', executedById: t.userId, executedAt: new Date() },
    });
    if (r.count === 0) throw conflict('Proposta já usada ou inexistente.', 'ALREADY_DONE');
    return { ok: true };
  });
}
