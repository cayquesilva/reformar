/**
 * Painel da PLATAFORMA (operador do SaaS). Acesso só para usuários com isPlatformAdmin.
 * Mostra planos, assinaturas e indicadores operacionais — NUNCA dados de negócio das empresas
 * (clientes, valores de orçamentos, obras, finanças).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { centsSchema } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { Prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { dateOut } from '../../lib/convert.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { requireUser } from '../../plugins/auth.js';
import { planToDTO, processEvent, reconcileTenant, subscriptionAccess } from '../billing/service.js';
import { paymentProviderRoutes } from './payment-providers.js';

const planSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, { message: 'Código: letras minúsculas, números e hífen.' }),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish().transform((v) => v || null),
  priceCents: centsSchema.refine((v) => v > 0, { message: 'Informe o preço.' }),
  cycle: z.enum(['MONTHLY', 'YEARLY']),
  maxUsers: z.number().int().min(1).nullish().transform((v) => v ?? null),
  maxActiveProjects: z.number().int().min(1).nullish().transform((v) => v ?? null),
  aiMonthlyRequests: z.number().int().min(0).max(100000),
  active: z.boolean().default(true),
});

export async function platformRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const requireAdmin = (request: FastifyRequest) => {
    const auth = requireUser(request);
    if (!auth.isPlatformAdmin) throw forbidden('Área restrita à administração da plataforma.');
    return auth;
  };

  await paymentProviderRoutes(app, ctx, requireAdmin);

  app.get('/api/platform/overview', async (request) => {
    requireAdmin(request);
    const [tenants, byStatus, events] = await Promise.all([
      db.tenant.count({ where: { isDemo: false } }),
      db.tenantSubscription.groupBy({ by: ['status'], _count: true }),
      db.paymentProviderEvent.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      tenants,
      subscriptions: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      events: Object.fromEntries(events.map((e) => [e.status, e._count])),
    };
  });

  app.get('/api/platform/plans', async (request) => {
    requireAdmin(request);
    return (await db.subscriptionPlan.findMany({ orderBy: { priceCents: 'asc' } })).map(planToDTO);
  });

  app.post('/api/platform/plans', async (request, reply) => {
    const admin = requireAdmin(request);
    const input = planSchema.parse(request.body);
    try {
      const p = await db.subscriptionPlan.create({ data: { ...input, priceCents: BigInt(input.priceCents) } });
      await audit(db, { tenantId: null, userId: admin.user.id, action: 'platform.plan_created', entityType: 'SubscriptionPlan', entityId: p.id, data: { code: p.code, priceCents: input.priceCents } });
      return reply.status(201).send(planToDTO(p));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe plano com esse código.');
      throw e;
    }
  });

  app.put('/api/platform/plans/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = planSchema.parse(request.body);
    const before = await db.subscriptionPlan.findUnique({ where: { id } });
    if (!before) throw notFound('Plano não encontrado.');
    // Mudança de preço vale para novas contratações; assinaturas existentes (Asaas e PayPal) mantêm o valor até troca de plano.
    // No PayPal, o próximo contrato cria um plano novo lá com o preço novo (ver ensurePaypalPlan).
    const p = await db.subscriptionPlan.update({ where: { id }, data: { ...input, priceCents: BigInt(input.priceCents) } });
    await audit(db, { tenantId: null, userId: admin.user.id, action: 'platform.plan_updated', entityType: 'SubscriptionPlan', entityId: id, data: { priceBefore: Number(before.priceCents), priceAfter: input.priceCents } });
    return planToDTO(p);
  });

  /** Lista de empresas com dados operacionais agregados (sem dados de negócio). */
  app.get('/api/platform/tenants', async (request) => {
    requireAdmin(request);
    const tenants = await db.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, name: true, isDemo: true, createdAt: true, _count: { select: { memberships: true, quotes: true, projects: true } } },
    });
    const subs = await db.tenantSubscription.findMany({ where: { tenantId: { in: tenants.map((t) => t.id) } }, include: { plan: true } });
    return tenants.map((t) => {
      const s = subs.find((x) => x.tenantId === t.id) ?? null;
      return {
        id: t.id,
        name: t.name,
        isDemo: t.isDemo,
        createdAt: t.createdAt.toISOString(),
        users: t._count.memberships,
        quotes: t._count.quotes,
        projects: t._count.projects,
        plan: s?.plan.name ?? null,
        provider: s?.provider ?? null,
        status: s?.status ?? null,
        access: subscriptionAccess(s).level,
        currentPeriodEnd: s?.currentPeriodEnd ? dateOut(s.currentPeriodEnd) : null,
      };
    });
  });

  app.post('/api/platform/tenants/:id/reconcile', async (request) => {
    const admin = requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await reconcileTenant(ctx, id);
    await audit(db, { tenantId: id, userId: admin.user.id, action: 'platform.reconcile', entityType: 'TenantSubscription', entityId: id });
    return { ok: true };
  });

  /** Monitor da fila de webhooks. */
  app.get('/api/platform/events', async (request) => {
    requireAdmin(request);
    const q = z.object({ status: z.enum(['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED']).optional() }).parse(request.query);
    const rows = await db.paymentProviderEvent.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: { id: true, provider: true, externalId: true, eventType: true, status: true, attempts: true, lastError: true, tenantId: true, receivedAt: true, processedAt: true },
    });
    return rows;
  });

  app.post('/api/platform/events/:id/retry', async (request) => {
    const admin = requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const ev = await db.paymentProviderEvent.findUnique({ where: { id } });
    if (!ev) throw notFound('Evento não encontrado.');
    if (ev.status === 'PROCESSED') throw conflict('Evento já processado.');
    await db.paymentProviderEvent.update({ where: { id }, data: { status: 'RECEIVED' } });
    await processEvent(ctx, id);
    await audit(db, { tenantId: ev.tenantId, userId: admin.user.id, action: 'platform.event_retry', entityType: 'PaymentProviderEvent', entityId: id });
    return db.paymentProviderEvent.findUnique({ where: { id }, select: { status: true, lastError: true } });
  });
}
