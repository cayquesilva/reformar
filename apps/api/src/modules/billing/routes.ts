import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { documentSchema, resolveLocale, todayISO, type BillingDTO, type PaymentProvider } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { Prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { dateOut } from '../../lib/convert.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { requireTenant } from '../../plugins/auth.js';
import type { ResolvedPaypal } from './payments.js';
import { pendingInvoiceUrl, planToDTO, processEvent, reconcileTenant, subscriptionAccess } from './service.js';

const subscribeSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('ASAAS'),
    planId: z.uuid(),
    billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED']).default('UNDEFINED'),
    cpfCnpj: documentSchema.refine((v) => v !== null, { message: 'Informe o CPF ou CNPJ de quem paga a assinatura.' }),
  }),
  z.object({ provider: z.literal('PAYPAL'), planId: z.uuid() }),
]);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const notConfigured = () =>
  new AppError(503, 'BILLING_NOT_CONFIGURED', 'A cobrança de assinaturas ainda não está configurada neste servidor.');

/** Data/hora RFC 3339 sem milissegundos (formato dos exemplos do PayPal). */
const rfc3339 = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function billingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/billing', async (request): Promise<BillingDTO> => {
    const t = requireTenant(request, 'billing:manage');
    const sub = await db.tenantSubscription.findUnique({ where: { tenantId: t.tenantId }, include: { plan: true } });
    const plans = await db.subscriptionPlan.findMany({ where: { active: true }, orderBy: { priceCents: 'asc' } });
    const providers = await ctx.payments.available();
    return {
      enabled: providers.length > 0,
      providers,
      provider: (sub?.provider as PaymentProvider | null) ?? null,
      status: sub?.status ?? null,
      plan: sub ? planToDTO(sub.plan) : null,
      access: subscriptionAccess(sub),
      trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ? dateOut(sub.currentPeriodEnd) : null,
      graceUntil: sub?.graceUntil ? dateOut(sub.graceUntil) : null,
      billingType: sub?.billingType ?? null,
      pendingInvoiceUrl: sub?.provider === 'PAYPAL' ? null : await pendingInvoiceUrl(ctx, sub?.asaasSubscriptionId ?? null),
      plans: plans.map(planToDTO),
    };
  });

  /**
   * Contrata/troca de plano pelo meio de pagamento escolhido e devolve o link para pagar/aprovar.
   * O acesso pago NÃO é liberado aqui: só por pagamento confirmado (webhook) ou reconciliação.
   */
  app.post('/api/billing/subscribe', async (request) => {
    const t = requireTenant(request, 'billing:manage');
    const body = (request.body ?? {}) as Record<string, unknown>;
    // Compatibilidade: chamadas antigas não mandavam o meio de pagamento (era sempre Asaas).
    const input = subscribeSchema.parse({ provider: 'ASAAS', ...body });
    if (!(await ctx.payments.available()).includes(input.provider)) throw notConfigured();
    const plan = await db.subscriptionPlan.findFirst({ where: { id: input.planId, active: true } });
    if (!plan) throw notFound('Plano não encontrado.');
    const sub = await db.tenantSubscription.findUnique({ where: { tenantId: t.tenantId } });
    if (sub?.status === 'ACTIVE' && sub.planId === plan.id && sub.provider === input.provider) throw conflict('Você já está neste plano.');

    // A nova cobrança só começa depois do período já pago/teste (sem cobrança dupla).
    const today = todayISO();
    const candidates = [today];
    // Data no fuso de São Paulo (não UTC), para não cobrar um dia depois do fim do teste.
    if (sub?.trialEndsAt) candidates.push(todayISO(sub.trialEndsAt));
    if (sub?.currentPeriodEnd && sub.status !== 'PAST_DUE') candidates.push(dateOut(sub.currentPeriodEnd));
    const nextDueDate = candidates.sort().at(-1)!;
    const keepAccess = sub && ['ACTIVE', 'TRIALING'].includes(sub.status) ? sub.status : 'PENDING';

    if (input.provider === 'ASAAS') {
      const asaas = (await ctx.payments.asaas())!;
      const profile = await db.companyProfile.findUniqueOrThrow({ where: { tenantId: t.tenantId } });
      const customerId =
        sub?.asaasCustomerId ??
        (
          await asaas.client.createCustomer({
            name: profile.legalName || profile.tradeName,
            cpfCnpj: input.cpfCnpj!,
            email: profile.email,
            externalReference: t.tenantId,
          })
        ).id;
      if (sub?.asaasSubscriptionId) await asaas.client.deleteSubscription(sub.asaasSubscriptionId);
      await cancelPaypalIfAny(sub?.paypalSubscriptionId ?? null, 'Troca para outro meio de pagamento');
      const created = await asaas.client.createSubscription({
        customer: customerId,
        billingType: input.billingType,
        valueCents: Number(plan.priceCents),
        nextDueDate,
        cycle: plan.cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
        description: `Assinatura Reformar - plano ${plan.name}`,
        externalReference: t.tenantId,
      });
      const data = {
        planId: plan.id,
        provider: 'ASAAS',
        asaasCustomerId: customerId,
        asaasSubscriptionId: created.id,
        paypalSubscriptionId: null,
        billingType: input.billingType,
      };
      await db.tenantSubscription.upsert({
        where: { tenantId: t.tenantId },
        create: { tenantId: t.tenantId, status: 'PENDING', ...data },
        update: { status: keepAccess, canceledAt: null, ...data },
      });
      await audit(db, {
        tenantId: t.tenantId,
        userId: t.userId,
        action: 'billing.subscribed',
        entityType: 'TenantSubscription',
        entityId: t.tenantId,
        data: { provider: 'ASAAS', plan: plan.code, billingType: input.billingType, nextDueDate },
        ip: t.ip,
      });
      return { provider: 'ASAAS', invoiceUrl: await pendingInvoiceUrl(ctx, created.id), approveUrl: null, nextDueDate };
    }

    // PayPal: o comprador aprova no site do PayPal; a assinatura do Asaas (se houver) só é encerrada quando
    // a do PayPal ficar ativa (reconciliação), para ninguém ficar sem assinatura se desistir no meio.
    const pp = (await ctx.payments.paypal())!;
    const externalPlanId = await ensurePaypalPlan(pp, plan);
    await cancelPaypalIfAny(sub?.paypalSubscriptionId ?? null, 'Troca de plano');
    const start = nextDueDate > today ? new Date(`${nextDueDate}T03:00:00Z`) : null; // 00:00 em São Paulo
    const locale = resolveLocale(request.headers['accept-language']) === 'en' ? 'en-US' : 'pt-BR';
    const created = await pp.client.createSubscription({
      planId: externalPlanId,
      customId: t.tenantId,
      startTime: start ? rfc3339(start) : null,
      returnUrl: `${ctx.config.publicAppUrl}/assinatura?paypal=ok`,
      cancelUrl: `${ctx.config.publicAppUrl}/assinatura?paypal=cancelado`,
      brandName: 'Reformar',
      locale,
    });
    if (!created.approveUrl) {
      await pp.client.cancelSubscription(created.id, 'Link de aprovação ausente');
      throw new AppError(502, 'BILLING_ERROR', 'O PayPal não devolveu o link de aprovação. Tente de novo em instantes.');
    }
    const data = { planId: plan.id, provider: 'PAYPAL', paypalSubscriptionId: created.id, billingType: 'PAYPAL' };
    await db.tenantSubscription.upsert({
      where: { tenantId: t.tenantId },
      create: { tenantId: t.tenantId, status: 'PENDING', ...data },
      update: { status: keepAccess, canceledAt: null, ...data },
    });
    await audit(db, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'billing.subscribed',
      entityType: 'TenantSubscription',
      entityId: t.tenantId,
      data: { provider: 'PAYPAL', plan: plan.code, startTime: start ? rfc3339(start) : null },
      ip: t.ip,
    });
    return { provider: 'PAYPAL', invoiceUrl: null, approveUrl: created.approveUrl, nextDueDate };
  });

  /** Plano equivalente no PayPal (criado uma vez por plano/preço/ciclo/ambiente; produto criado uma vez). */
  async function ensurePaypalPlan(pp: ResolvedPaypal, plan: { id: string; name: string; priceCents: bigint; cycle: string }) {
    const key = { provider: 'PAYPAL', environment: pp.environment, planId: plan.id, priceCents: plan.priceCents, cycle: plan.cycle };
    const found = await db.paymentProviderPlan.findUnique({ where: { provider_environment_planId_priceCents_cycle: key } });
    if (found) return found.externalPlanId;
    let productId = pp.productId;
    if (!productId) {
      productId = (await pp.client.createProduct({ name: 'Reformar', description: 'Assinatura do sistema Reformar' })).id;
      const row = await db.paymentProviderConfig.findUniqueOrThrow({ where: { provider: 'PAYPAL' } });
      const settings = (row.settings ?? {}) as { products?: Record<string, string> };
      await db.paymentProviderConfig.update({
        where: { provider: 'PAYPAL' },
        data: { settings: { ...settings, products: { ...settings.products, [pp.environment]: productId } } },
      });
      ctx.payments.invalidate();
    }
    const created = await pp.client.createPlan({
      productId,
      name: `Reformar ${plan.name}`,
      valueCents: Number(plan.priceCents),
      currency: pp.currency,
      cycle: plan.cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
    });
    await db.paymentProviderPlan.create({ data: { ...key, externalPlanId: created.id } });
    return created.id;
  }

  async function cancelPaypalIfAny(id: string | null, reason: string) {
    if (!id) return;
    const pp = await ctx.payments.paypal();
    if (!pp) throw notConfigured();
    await pp.client.cancelSubscription(id, reason);
  }

  app.post('/api/billing/sync', async (request) => {
    const t = requireTenant(request, 'billing:manage');
    const [asaas, paypal] = await Promise.all([ctx.payments.asaas(), ctx.payments.paypal()]);
    if (!asaas && !paypal) throw notConfigured();
    await reconcileTenant(ctx, t.tenantId);
    return { ok: true };
  });

  app.post('/api/billing/cancel', async (request) => {
    const t = requireTenant(request, 'billing:manage');
    z.object({ confirm: z.literal(true, { message: 'Confirme o cancelamento.' }) }).parse(request.body);
    const sub = await db.tenantSubscription.findUnique({ where: { tenantId: t.tenantId } });
    if (!sub || sub.status === 'CANCELED') throw conflict('Não há assinatura ativa.');
    if (sub.asaasSubscriptionId) {
      const asaas = await ctx.payments.asaas();
      if (!asaas) throw notConfigured();
      await asaas.client.deleteSubscription(sub.asaasSubscriptionId);
    }
    await cancelPaypalIfAny(sub.paypalSubscriptionId, 'Cancelada pelo cliente');
    await db.tenantSubscription.update({ where: { tenantId: t.tenantId }, data: { status: 'CANCELED', canceledAt: new Date() } });
    await audit(db, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'billing.canceled',
      entityType: 'TenantSubscription',
      entityId: t.tenantId,
      ip: t.ip,
    });
    return { ok: true, accessUntil: sub.currentPeriodEnd ? dateOut(sub.currentPeriodEnd) : null };
  });

  /** Guarda o evento ANTES de processar (id único => entregas repetidas não geram efeito duplicado). */
  async function storeEvent(provider: PaymentProvider, externalId: string, eventType: string, payload: unknown) {
    try {
      const ev = await db.paymentProviderEvent.create({
        data: { provider, externalId, eventType, payload: payload as Prisma.InputJsonValue },
      });
      return ev.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  /** Webhook do Asaas: autentica pelo cabeçalho `asaas-access-token`, persiste, processa e responde 200. */
  app.post('/api/webhooks/asaas', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const expected = (await ctx.payments.asaas())?.webhookToken;
    const token = request.headers['asaas-access-token'];
    if (!expected || typeof token !== 'string' || !safeEqual(token, expected)) throw unauthorized('Token de webhook inválido.');
    const body = z
      .object({ id: z.string().min(1).max(200), event: z.string().min(1).max(100) })
      .passthrough()
      .safeParse(request.body);
    if (!body.success) throw badRequest('Evento inválido.');
    const eventId = await storeEvent('ASAAS', body.data.id, body.data.event, body.data);
    if (!eventId) return reply.status(200).send({ received: true, duplicate: true });
    await processEvent(ctx, eventId); // falhas ficam como FAILED e são reprocessadas pelo worker
    return reply.status(200).send({ received: true });
  });

  /**
   * Webhook do PayPal: a autenticidade é conferida na API do PayPal (verify-webhook-signature, com os
   * cabeçalhos PAYPAL-* e o id do webhook cadastrado no painel). Evento só avisa; o estado vem do GET.
   */
  app.post('/api/webhooks/paypal', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const pp = await ctx.payments.paypal();
    if (!pp?.webhookId) throw unauthorized('Webhook do PayPal não configurado.');
    const body = z
      .object({ id: z.string().min(1).max(200), event_type: z.string().min(1).max(100) })
      .passthrough()
      .safeParse(request.body);
    if (!body.success) throw badRequest('Evento inválido.');
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(request.headers)) if (k.startsWith('paypal-') && typeof v === 'string') headers[k] = v;
    const valid = await pp.client.verifyWebhook({ headers, event: request.body, webhookId: pp.webhookId });
    if (!valid) throw unauthorized('Assinatura do webhook inválida.');
    const eventId = await storeEvent('PAYPAL', body.data.id, body.data.event_type, body.data);
    if (!eventId) return reply.status(200).send({ received: true, duplicate: true });
    await processEvent(ctx, eventId);
    return reply.status(200).send({ received: true });
  });
}
