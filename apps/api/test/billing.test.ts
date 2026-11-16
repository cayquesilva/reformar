import { addDaysISO, todayISO } from '@reformar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeBillingProvider } from '../src/modules/billing/asaas.js';
import { Client, createCustomer, createTestEnv, signup, type TestEnv } from './helpers.js';

const TOKEN = 'tok_webhook_teste_0123456789abcdefghijklmnop';
let env: TestEnv;
let fake: FakeBillingProvider;
let admin: Client;
let owner: Client;
let tenantId: string;
let planId: string;
let subId: string;

async function webhook(body: unknown, token = TOKEN) {
  return env.app.inject({
    method: 'POST',
    url: '/api/webhooks/asaas',
    headers: { 'content-type': 'application/json', 'asaas-access-token': token },
    payload: JSON.stringify(body),
  });
}

const payment = (event: string, extra: Record<string, unknown> = {}) => ({
  id: `evt_${event}_${Math.random().toString(36).slice(2)}`,
  event,
  payment: { object: 'payment', id: 'pay_1', subscription: subId, value: 99.9, status: 'RECEIVED', dueDate: todayISO(), customer: 'cus', ...extra },
});

beforeAll(async () => {
  fake = new FakeBillingProvider();
  env = await createTestEnv({
    billing: fake,
    env: { ASAAS_API_KEY: 'chave_sandbox_teste', ASAAS_WEBHOOK_TOKEN: TOKEN, BILLING_TRIAL_DAYS: '14', BILLING_GRACE_DAYS: '7' },
  });
  const a = await signup(env.app, 'Operadora');
  await env.db.user.update({ where: { id: a.userId }, data: { isPlatformAdmin: true } });
  admin = a.client;
  const plan = await admin.post('/api/platform/plans', {
    code: 'profissional',
    name: 'Profissional',
    priceCents: 9990,
    cycle: 'MONTHLY',
    maxActiveProjects: 2,
    aiMonthlyRequests: 50,
  });
  expect(plan.statusCode).toBe(201);
  planId = plan.json().id;
  const o = await signup(env.app, 'Cliente da Plataforma');
  owner = o.client;
  tenantId = o.tenantId;
});
afterAll(async () => env.close());

describe('Jornada E — assinatura via Asaas (simulado)', () => {
  it('nova empresa começa em teste com acesso completo', async () => {
    const b = (await owner.get('/api/billing')).json();
    expect(b.status).toBe('TRIALING');
    expect(b.access.level).toBe('FULL');
    expect(b.plans).toHaveLength(1);
  });

  it('contratar cria cliente e assinatura no Asaas, mas NÃO libera acesso pago pelo navegador', async () => {
    const r = await owner.post('/api/billing/subscribe', { planId, billingType: 'PIX', cpfCnpj: '12.345.678/0001-90' });
    expect(r.statusCode).toBe(200);
    expect(r.json().invoiceUrl).toMatch(/^https:/);
    expect(fake.customers[0]!.cpfCnpj).toBe('12345678000190');
    const sub = await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    subId = sub.asaasSubscriptionId!;
    expect(sub.status).toBe('TRIALING'); // continua em teste até o pagamento ser confirmado
    // primeira cobrança só após o fim do teste
    expect(fake.subscriptions.get(subId)!.nextDueDate).toBe(addDaysISO(todayISO(), 14));
    expect(fake.subscriptions.get(subId)!.valueCents).toBe(9990);
  });

  it('webhook sem token válido é recusado', async () => {
    const before = await env.db.paymentProviderEvent.count();
    expect((await webhook(payment('PAYMENT_RECEIVED'), 'errado')).statusCode).toBe(401);
    expect(await env.db.paymentProviderEvent.count()).toBe(before);
  });

  it('pagamento com valor menor que o plano não ativa', async () => {
    const r = await webhook(payment('PAYMENT_RECEIVED', { value: 1 }));
    expect(r.statusCode).toBe(200);
    expect((await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })).status).toBe('TRIALING');
    expect((await env.db.paymentProviderEvent.findFirstOrThrow({ orderBy: { receivedAt: 'desc' } })).status).toBe('FAILED');
  });

  it('evento confirmado ativa; o MESMO evento repetido não processa de novo', async () => {
    const ev = payment('PAYMENT_RECEIVED');
    expect((await webhook(ev)).statusCode).toBe(200);
    const s1 = await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(s1.status).toBe('ACTIVE');
    const dup = await webhook(ev);
    expect(dup.statusCode).toBe(200);
    expect(dup.json().duplicate).toBe(true);
    expect(await env.db.paymentProviderEvent.count({ where: { externalId: ev.id } })).toBe(1);
    const s2 = await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(s2.lastPaymentAt!.getTime()).toBe(s1.lastPaymentAt!.getTime());
  });

  it('limite do plano: obras em andamento e franquia de IA', async () => {
    const c = await createCustomer(owner);
    expect((await owner.post('/api/projects', { customerId: c, name: 'Obra 1', contractTotalCents: 100 })).statusCode).toBe(201);
    expect((await owner.post('/api/projects', { customerId: c, name: 'Obra 2', contractTotalCents: 100 })).statusCode).toBe(201);
    const third = await owner.post('/api/projects', { customerId: c, name: 'Obra 3', contractTotalCents: 100 });
    expect(third.statusCode).toBe(402);
    expect(third.json().error).toBe('PLAN_LIMIT');
    expect((await owner.get('/api/ai/usage')).json().limit).toBe(50);
  });

  it('atraso: tolerância com aviso; depois somente leitura (dados preservados e exportáveis)', async () => {
    await webhook(payment('PAYMENT_OVERDUE', { status: 'OVERDUE', dueDate: todayISO() }));
    await env.db.tenantSubscription.update({ where: { tenantId }, data: { currentPeriodEnd: null } });
    let me = (await owner.get('/api/auth/me')).json();
    expect(me.activeTenant.access.level).toBe('FULL');
    expect(me.activeTenant.access.warning).toContain('atraso');

    // passa a tolerância
    await env.db.tenantSubscription.update({ where: { tenantId }, data: { graceUntil: new Date(`${addDaysISO(todayISO(), -1)}T00:00:00Z`) } });
    me = (await owner.get('/api/auth/me')).json();
    expect(me.activeTenant.access.level).toBe('READ_ONLY');
    const write = await owner.post('/api/customers', { name: 'Novo' });
    expect(write.statusCode).toBe(402);
    expect(write.json().error).toBe('SUBSCRIPTION_INACTIVE');
    expect((await owner.get('/api/customers')).statusCode).toBe(200);
    const exp = await owner.get('/api/company/export');
    expect(exp.statusCode).toBe(200);
    expect(exp.json().customers.length).toBeGreaterThan(0);
    expect(exp.body).not.toContain('passwordHash');
    // gestão da assinatura continua disponível
    expect((await owner.post('/api/billing/sync')).statusCode).toBe(200);
  });

  it('recuperação: novo pagamento confirmado volta ao acesso completo', async () => {
    await webhook(payment('PAYMENT_CONFIRMED', { dueDate: todayISO() }));
    const me = (await owner.get('/api/auth/me')).json();
    expect(me.activeTenant.access.level).toBe('FULL');
    expect((await owner.post('/api/customers', { name: 'Voltei' })).statusCode).toBe(201);
  });

  it('reconciliação corrige estado a partir do Asaas (webhook perdido)', async () => {
    await env.db.tenantSubscription.update({ where: { tenantId }, data: { status: 'PAST_DUE', graceUntil: null, currentPeriodEnd: null } });
    fake.payments.set(subId, [{ id: 'p9', status: 'RECEIVED', value: 99.9, dueDate: todayISO(), subscription: subId }]);
    expect((await admin.post(`/api/platform/tenants/${tenantId}/reconcile`)).statusCode).toBe(200);
    expect((await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })).status).toBe('ACTIVE');
  });

  it('cancelamento mantém acesso até o fim do período pago', async () => {
    const r = await owner.post('/api/billing/cancel', { confirm: true });
    expect(r.statusCode).toBe(200);
    expect(fake.subscriptions.get(subId)!.deleted).toBe(true);
    const me = (await owner.get('/api/auth/me')).json();
    expect(me.activeTenant.access.level).toBe('FULL');
    expect(me.activeTenant.access.warning).toContain('cancelada');
  });
});

describe('painel da plataforma', () => {
  it('só administradores da plataforma acessam; não expõe dados de negócio', async () => {
    expect((await owner.get('/api/platform/tenants')).statusCode).toBe(403);
    const list = (await admin.get('/api/platform/tenants')).json();
    const t = list.find((x: { id: string }) => x.id === tenantId);
    expect(t).toMatchObject({ plan: 'Profissional', projects: 2 });
    expect(JSON.stringify(list)).not.toMatch(/contractTotal|amountCents|cpf/i);
    const events = (await admin.get('/api/platform/events?status=FAILED')).json();
    expect(events.length).toBe(1);
    expect(events[0]).not.toHaveProperty('payload');
  });
});
