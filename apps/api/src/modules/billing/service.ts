import {
  accessFor,
  addDaysISO,
  periodEndFrom,
  todayISO,
  type AccessDecision,
  type PlanDTO,
} from '@reformar/shared';
import type { AppContext } from '../../context.js';
import type { Db, Prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { centsOut, dateIn, dateOut } from '../../lib/convert.js';
import { reaisToCents, type AsaasPayment } from './asaas.js';

type SubRow = NonNullable<Awaited<ReturnType<Db['tenantSubscription']['findUnique']>>>;

export function planToDTO(p: { id: string; code: string; name: string; description: string | null; priceCents: bigint; cycle: string; maxUsers: number | null; maxActiveProjects: number | null; aiMonthlyRequests: number; active: boolean }): PlanDTO {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    priceCents: centsOut(p.priceCents),
    cycle: p.cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
    maxUsers: p.maxUsers,
    maxActiveProjects: p.maxActiveProjects,
    aiMonthlyRequests: p.aiMonthlyRequests,
    active: p.active,
  };
}

export function subscriptionAccess(sub: SubRow | null, now = new Date()): AccessDecision {
  return accessFor(
    sub
      ? {
          status: sub.status,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: sub.currentPeriodEnd ? dateOut(sub.currentPeriodEnd) : null,
          graceUntil: sub.graceUntil ? dateOut(sub.graceUntil) : null,
        }
      : null,
    now,
    todayISO(now),
  );
}

/** Nova empresa: começa em período de teste no plano ativo mais barato (se houver planos e cobrança configurada). */
export async function startTrialIfConfigured(ctx: AppContext, tx: Prisma.TransactionClient, tenantId: string) {
  if (!(await ctx.payments.enabled())) return;
  const plan = await tx.subscriptionPlan.findFirst({ where: { active: true }, orderBy: { priceCents: 'asc' } });
  if (!plan) return;
  await tx.tenantSubscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + ctx.config.billing.trialDays * 86400_000),
    },
  });
}

const PAID = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

/**
 * Aplica um evento de webhook (Asaas ou PayPal). Idempotente por natureza (o evento é único por id) e
 * defensivo quanto à ordem: o período pago só avança, nunca recua.
 */
export async function processEvent(ctx: AppContext, eventId: string): Promise<void> {
  const { db } = ctx;
  const ev = await db.paymentProviderEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.status === 'PROCESSED' || ev.status === 'IGNORED') return;
  if (ev.provider === 'PAYPAL') return processPaypalEvent(ctx, ev);
  const body = ev.payload as { event?: string; payment?: AsaasPayment; subscription?: { id?: string } };
  const type = body.event ?? ev.eventType;
  const subscriptionId = body.payment?.subscription ?? body.subscription?.id ?? null;

  const finish = (status: 'PROCESSED' | 'IGNORED' | 'FAILED', extra: { lastError?: string | null; tenantId?: string | null } = {}) =>
    db.paymentProviderEvent.update({
      where: { id: ev.id },
      data: { status, attempts: { increment: 1 }, processedAt: status === 'FAILED' ? null : new Date(), ...extra },
    });

  try {
    if (!subscriptionId) return void (await finish('IGNORED', { lastError: 'Evento sem assinatura vinculada.' }));
    const sub = await db.tenantSubscription.findUnique({ where: { asaasSubscriptionId: subscriptionId }, include: { plan: true } });
    if (!sub) return void (await finish('IGNORED', { lastError: 'Assinatura desconhecida.' }));
    const today = todayISO();

    if (PAID.has(type) && body.payment) {
      const paidCents = reaisToCents(body.payment.value);
      const expected = centsOut(sub.plan.priceCents);
      if (paidCents < expected) {
        // Proteção: valor divergente não libera acesso.
        return void (await finish('FAILED', { tenantId: sub.tenantId, lastError: `Valor pago (${paidCents}) menor que o do plano (${expected}).` }));
      }
      const newEnd = periodEndFrom(body.payment.dueDate, sub.plan.cycle);
      const currentEnd = sub.currentPeriodEnd ? dateOut(sub.currentPeriodEnd) : null;
      await db.tenantSubscription.update({
        where: { tenantId: sub.tenantId },
        data: {
          status: sub.status === 'CANCELED' ? 'CANCELED' : 'ACTIVE',
          currentPeriodEnd: !currentEnd || newEnd > currentEnd ? dateIn(newEnd) : undefined,
          graceUntil: null,
          lastPaymentAt: new Date(),
        },
      });
    } else if (type === 'PAYMENT_OVERDUE' || type === 'PAYMENT_REFUNDED' || type === 'PAYMENT_CHARGEBACK_REQUESTED') {
      if (sub.status !== 'CANCELED' && sub.status !== 'SUSPENDED') {
        const base = type === 'PAYMENT_OVERDUE' && body.payment?.dueDate ? body.payment.dueDate : today;
        await db.tenantSubscription.update({
          where: { tenantId: sub.tenantId },
          data: { status: 'PAST_DUE', graceUntil: dateIn(addDaysISO(base, ctx.config.billing.graceDays)) },
        });
      }
    } else if (type === 'SUBSCRIPTION_DELETED' || type === 'SUBSCRIPTION_INACTIVATED') {
      await db.tenantSubscription.update({
        where: { tenantId: sub.tenantId },
        data: { status: 'CANCELED', canceledAt: sub.canceledAt ?? new Date() },
      });
    } else {
      return void (await finish('IGNORED', { tenantId: sub.tenantId }));
    }
    await audit(db, { tenantId: sub.tenantId, userId: null, action: 'billing.event_applied', entityType: 'TenantSubscription', entityId: sub.tenantId, data: { event: type, externalId: ev.externalId } });
    await finish('PROCESSED', { tenantId: sub.tenantId, lastError: null });
  } catch (e) {
    await finish('FAILED', { lastError: (e as Error).message.slice(0, 500) });
  }
}

/** Reprocessa eventos com falha (fila simples sobre o banco). */
export async function processPendingEvents(ctx: AppContext) {
  const pending = await ctx.db.paymentProviderEvent.findMany({
    where: { status: { in: ['RECEIVED', 'FAILED'] }, attempts: { lt: 10 } },
    orderBy: { receivedAt: 'asc' },
    take: 50,
  });
  for (const ev of pending) await processEvent(ctx, ev.id);
  return pending.length;
}

/**
 * Reconciliação: consulta o estado no provedor e corrige divergências (ex.: webhook perdido).
 * Fonte da verdade = o que o provedor diz da assinatura e das cobranças.
 */
export async function reconcileTenant(ctx: AppContext, tenantId: string) {
  const sub = await ctx.db.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } });
  if (!sub) return sub;
  if (sub.provider === 'PAYPAL' && sub.paypalSubscriptionId) return reconcilePaypal(ctx, sub);
  const asaas = await ctx.payments.asaas();
  if (!sub.asaasSubscriptionId || !asaas) return sub;
  const remote = await asaas.client.getSubscription(sub.asaasSubscriptionId);
  const payments = (await asaas.client.listSubscriptionPayments(sub.asaasSubscriptionId)).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const today = todayISO();
  const expected = centsOut(sub.plan.priceCents);
  const paid = payments.filter((p) => PAID_STATUSES.has(p.status) && reaisToCents(p.value) >= expected);
  const lastPaidEnd = paid.length ? periodEndFrom(paid[0]!.dueDate, sub.plan.cycle) : null;
  const overdue = payments.find((p) => p.status === 'OVERDUE');

  let data: Prisma.TenantSubscriptionUpdateInput;
  if (remote.deleted || remote.status === 'INACTIVE' || remote.status === 'EXPIRED') {
    data = { status: 'CANCELED', canceledAt: sub.canceledAt ?? new Date(), ...(lastPaidEnd ? { currentPeriodEnd: dateIn(lastPaidEnd) } : {}) };
  } else if (lastPaidEnd && lastPaidEnd >= today) {
    data = { status: 'ACTIVE', currentPeriodEnd: dateIn(lastPaidEnd), graceUntil: null };
  } else if (overdue) {
    data = { status: 'PAST_DUE', graceUntil: sub.graceUntil ?? dateIn(addDaysISO(overdue.dueDate, ctx.config.billing.graceDays)) };
  } else {
    data = {};
  }
  return saveReconciled(ctx, sub, data);
}

type SubWithPlan = SubRow & { plan: { priceCents: bigint; cycle: string } };

async function saveReconciled(ctx: AppContext, sub: SubWithPlan, data: Prisma.TenantSubscriptionUpdateInput) {
  const updated = await ctx.db.tenantSubscription.update({
    where: { tenantId: sub.tenantId },
    data: { ...data, lastSyncAt: new Date() },
    include: { plan: true },
  });
  if (updated.status !== sub.status) {
    await audit(ctx.db, {
      tenantId: sub.tenantId,
      userId: null,
      action: 'billing.reconciled',
      entityType: 'TenantSubscription',
      entityId: sub.tenantId,
      data: { from: sub.status, to: updated.status, provider: sub.provider },
    });
  }
  return updated;
}

/**
 * PayPal: o estado vem sempre do GET da assinatura (o corpo dos webhooks não foi conferido na documentação).
 * Acesso pago só com último pagamento na moeda configurada e valor >= ao do plano contratado no PayPal.
 * CANCELLED, EXPIRED e SUSPENDED seguem os nomes dos eventos BILLING.SUBSCRIPTION.*; a lista completa de
 * status NÃO foi confirmada na documentação — status desconhecido não muda nada.
 */
async function reconcilePaypal(ctx: AppContext, sub: SubWithPlan) {
  const pp = await ctx.payments.paypal();
  if (!pp || !sub.paypalSubscriptionId) return sub;
  const remote = await pp.client.getSubscription(sub.paypalSubscriptionId);
  const today = todayISO();
  const mapped = remote.planId
    ? await ctx.db.paymentProviderPlan.findFirst({ where: { provider: 'PAYPAL', externalPlanId: remote.planId } })
    : null;
  const expected = centsOut(mapped?.priceCents ?? sub.plan.priceCents);
  const cycle = mapped?.cycle ?? sub.plan.cycle;
  const lp = remote.lastPayment;
  const paidEnd = lp && lp.currency === pp.currency && lp.valueCents >= expected ? periodEndFrom(todayISO(new Date(lp.time)), cycle) : null;
  const currentEnd = sub.currentPeriodEnd ? dateOut(sub.currentPeriodEnd) : null;
  const advance = paidEnd && (!currentEnd || paidEnd > currentEnd) ? { currentPeriodEnd: dateIn(paidEnd) } : {};
  const grace = () => sub.graceUntil ?? dateIn(addDaysISO(today, ctx.config.billing.graceDays));

  let data: Prisma.TenantSubscriptionUpdateInput = {};
  if (remote.status === 'CANCELLED' || remote.status === 'EXPIRED') {
    data = { status: 'CANCELED', canceledAt: sub.canceledAt ?? new Date(), ...advance };
  } else if (remote.status === 'SUSPENDED') {
    if (sub.status !== 'CANCELED') data = { status: 'PAST_DUE', graceUntil: grace(), ...advance };
  } else if (remote.status === 'ACTIVE') {
    if (paidEnd && paidEnd >= today) {
      data = { status: sub.status === 'CANCELED' ? 'CANCELED' : 'ACTIVE', graceUntil: null, lastPaymentAt: new Date(lp!.time), ...advance };
    } else if (remote.failedPaymentsCount > 0 && sub.status !== 'CANCELED') {
      data = { status: 'PAST_DUE', graceUntil: grace() };
    }
    // Aprovada no PayPal: a assinatura do Asaas (de antes da troca de meio de pagamento) deixa de cobrar.
    const asaas = await ctx.payments.asaas();
    if (sub.asaasSubscriptionId && asaas) {
      await asaas.client.deleteSubscription(sub.asaasSubscriptionId);
      data = { ...data, asaasSubscriptionId: null };
    }
  }
  return saveReconciled(ctx, sub, data);
}

type EventRow = NonNullable<Awaited<ReturnType<Db['paymentProviderEvent']['findUnique']>>>;

/**
 * Evento do PayPal (assinatura digital já validada na API de verificação). O evento só AVISA; o estado
 * vem da reconciliação. Assinatura: BILLING.SUBSCRIPTION.* → resource.id · PAYMENT.SALE.* →
 * resource.billing_agreement_id (corpo NÃO confirmado na documentação; sem id, o evento fica IGNORED).
 */
async function processPaypalEvent(ctx: AppContext, ev: EventRow) {
  const { db } = ctx;
  const body = ev.payload as { event_type?: string; resource?: { id?: string; billing_agreement_id?: string } };
  const type = body.event_type ?? ev.eventType;
  const subscriptionId = type.startsWith('BILLING.SUBSCRIPTION.')
    ? body.resource?.id
    : type.startsWith('PAYMENT.SALE.')
      ? body.resource?.billing_agreement_id
      : undefined;
  const finish = (status: 'PROCESSED' | 'IGNORED' | 'FAILED', extra: { lastError?: string | null; tenantId?: string | null } = {}) =>
    db.paymentProviderEvent.update({
      where: { id: ev.id },
      data: { status, attempts: { increment: 1 }, processedAt: status === 'FAILED' ? null : new Date(), ...extra },
    });
  try {
    if (!subscriptionId) return void (await finish('IGNORED', { lastError: 'Evento sem assinatura vinculada.' }));
    const sub = await db.tenantSubscription.findUnique({ where: { paypalSubscriptionId: subscriptionId } });
    if (!sub) return void (await finish('IGNORED', { lastError: 'Assinatura desconhecida.' }));
    if (!(await ctx.payments.paypal())) {
      return void (await finish('FAILED', { tenantId: sub.tenantId, lastError: 'PayPal sem credenciais no servidor.' }));
    }
    await reconcileTenant(ctx, sub.tenantId);
    await audit(db, {
      tenantId: sub.tenantId,
      userId: null,
      action: 'billing.event_applied',
      entityType: 'TenantSubscription',
      entityId: sub.tenantId,
      data: { event: type, externalId: ev.externalId, provider: 'PAYPAL' },
    });
    await finish('PROCESSED', { tenantId: sub.tenantId, lastError: null });
  } catch (e) {
    await finish('FAILED', { lastError: (e as Error).message.slice(0, 500) });
  }
}

/** Link de pagamento da cobrança pendente mais próxima (para o cliente pagar no Asaas). */
export async function pendingInvoiceUrl(ctx: AppContext, asaasSubscriptionId: string | null) {
  const asaas = asaasSubscriptionId ? await ctx.payments.asaas() : null;
  if (!asaasSubscriptionId || !asaas) return null;
  try {
    const payments = await asaas.client.listSubscriptionPayments(asaasSubscriptionId);
    const open = payments.filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return open[0]?.invoiceUrl ?? null;
  } catch {
    return null;
  }
}

/** Limite de obras em andamento do plano contratado (sem plano = sem limite). */
export async function assertProjectLimit(tx: Prisma.TransactionClient, tenantId: string) {
  const sub = await tx.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } });
  const max = sub?.plan.maxActiveProjects;
  if (!max) return;
  const active = await tx.project.count({ where: { tenantId, status: { in: ['PLANNED', 'IN_PROGRESS', 'PAUSED'] } } });
  if (active >= max) {
    throw new AppError(402, 'PLAN_LIMIT', `Seu plano permite ${max} obra(s) em andamento. Conclua uma obra ou mude de plano.`);
  }
}
