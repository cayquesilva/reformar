import { randomBytes } from 'node:crypto';
import { addDaysISO, periodEndFrom, todayISO } from '@reformar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeBillingProvider } from '../src/modules/billing/asaas.js';
import { FakePaypalProvider } from '../src/modules/billing/paypal.js';
import { Client, createTestEnv, signup, type TestEnv } from './helpers.js';

// Chave de cifra gerada só para este teste (não é credencial de nenhum serviço).
const SECRETS_KEY = randomBytes(32).toString('base64');
const PAYPAL_SECRET = 'segredo-paypal-de-teste-0123456789';
const ASAAS_TOKEN = 'tok_webhook_painel_0123456789abcdefghijkl';

let env: TestEnv;
let paypal: FakePaypalProvider;
let asaas: FakeBillingProvider;
let admin: Client;
let owner: Client;
let tenantId: string;
let planId: string;
let ppSubId: string;

async function paypalWebhook(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return env.app.inject({
    method: 'POST',
    url: '/api/webhooks/paypal',
    headers: {
      'content-type': 'application/json',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
      'paypal-transmission-id': 'tid',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': new Date().toISOString(),
      ...headers,
    },
    payload: JSON.stringify(body),
  });
}

beforeAll(async () => {
  paypal = new FakePaypalProvider();
  asaas = new FakeBillingProvider();
  env = await createTestEnv({ paypal, billing: asaas, env: { SECRETS_KEY, BILLING_TRIAL_DAYS: '14', BILLING_GRACE_DAYS: '7' } });
  const a = await signup(env.app, 'Operação da plataforma');
  await env.db.user.update({ where: { id: a.userId }, data: { isPlatformAdmin: true } });
  admin = a.client;
  const plan = await admin.post('/api/platform/plans', {
    code: 'pp-essencial',
    name: 'Essencial',
    priceCents: 4990,
    cycle: 'MONTHLY',
    aiMonthlyRequests: 10,
  });
  expect(plan.statusCode).toBe(201);
  planId = plan.json().id;
});
afterAll(async () => {
  // Os outros arquivos de teste assumem cobrança configurada só por variáveis de ambiente.
  await env.db.paymentProviderConfig.deleteMany();
  await env.db.subscriptionPlan.updateMany({ where: { code: 'pp-essencial' }, data: { active: false } });
  await env.close();
});

describe('Meios de pagamento no painel da plataforma', () => {
  it('só a administração da plataforma vê e altera', async () => {
    const o = await signup(env.app, 'Curiosa');
    expect((await o.client.get('/api/platform/payment-providers')).statusCode).toBe(403);
    expect((await o.client.put('/api/platform/payment-providers/PAYPAL', { enabled: false, environment: 'SANDBOX' })).statusCode).toBe(403);
  });

  it('começa sem meios de pagamento: ninguém é cobrado', async () => {
    const r = (await admin.get('/api/platform/payment-providers')).json();
    expect(r.canStoreSecrets).toBe(true);
    expect(r.providers.map((p: { provider: string; ready: boolean }) => [p.provider, p.ready])).toEqual([
      ['ASAAS', false],
      ['PAYPAL', false],
    ]);
    expect(r.providers[1].webhookUrl).toBe('http://localhost:5173/api/webhooks/paypal');
    const o = await signup(env.app, 'Sem cobrança');
    expect((await o.client.get('/api/billing')).json()).toMatchObject({ enabled: false, providers: [], status: null });
  });

  it('ligar o PayPal exige client ID, secret e o ID do webhook', async () => {
    const r = await admin.put('/api/platform/payment-providers/PAYPAL', { enabled: true, environment: 'SANDBOX' });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().fields).sort()).toEqual(['credentials.clientId', 'credentials.clientSecret', 'settings.webhookId']);
  });

  it('salva as credenciais cifradas e nunca as devolve', async () => {
    const r = await admin.put('/api/platform/payment-providers/PAYPAL', {
      enabled: true,
      environment: 'SANDBOX',
      credentials: { clientId: 'client-id-de-teste-abcd', clientSecret: PAYPAL_SECRET },
      settings: { webhookId: 'WH-TESTE-123' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({
      provider: 'PAYPAL',
      enabled: true,
      ready: true,
      source: 'database',
      settings: { webhookId: 'WH-TESTE-123', currency: 'BRL' },
    });
    expect(body.credentials.clientSecret).toEqual({ set: true, hint: '…6789' });
    expect(r.body).not.toContain(PAYPAL_SECRET);
    const row = await env.db.paymentProviderConfig.findUniqueOrThrow({ where: { provider: 'PAYPAL' } });
    expect(row.secrets).toMatch(/^v1\./);
    expect(row.secrets).not.toContain(PAYPAL_SECRET);
    // Campo vazio = manter o que está salvo.
    const again = await admin.put('/api/platform/payment-providers/PAYPAL', {
      enabled: true,
      environment: 'SANDBOX',
      credentials: { clientSecret: '' },
    });
    expect(again.json().credentials.clientSecret.set).toBe(true);
    const audit = await env.db.auditLog.findFirst({
      where: { action: 'platform.payment_provider_updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit?.data)).not.toContain(PAYPAL_SECRET);
  });

  it('testa a conexão e guarda o resultado', async () => {
    expect((await admin.post('/api/platform/payment-providers/PAYPAL/test', {})).json()).toEqual({ ok: true, message: null });
    paypal.connectionOk = false;
    const bad = (await admin.post('/api/platform/payment-providers/PAYPAL/test', {})).json();
    paypal.connectionOk = true;
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/recusou as credenciais/);
    const view = (await admin.get('/api/platform/payment-providers')).json().providers[1];
    expect(view.lastTest.ok).toBe(false);
  });
});

describe('Jornada F — assinatura via PayPal (simulado)', () => {
  it('a empresa vê o PayPal como meio de pagamento', async () => {
    const o = await signup(env.app, 'Cliente PayPal');
    owner = o.client;
    tenantId = o.tenantId;
    const b = (await owner.get('/api/billing')).json();
    expect(b).toMatchObject({ enabled: true, providers: ['PAYPAL'], status: 'TRIALING' });
  });

  it('contratar cria produto, plano e assinatura no PayPal e devolve o link de aprovação', async () => {
    const r = await owner.post('/api/billing/subscribe', { provider: 'PAYPAL', planId });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ provider: 'PAYPAL', invoiceUrl: null });
    expect(r.json().approveUrl).toMatch(/^https:/);
    expect(paypal.products).toHaveLength(1);
    const [planEntry] = [...paypal.plans.values()];
    expect(planEntry).toMatchObject({ valueCents: 4990, currency: 'BRL', cycle: 'MONTHLY' });
    const sub = await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    ppSubId = sub.paypalSubscriptionId!;
    expect(sub).toMatchObject({ provider: 'PAYPAL', status: 'TRIALING' }); // acesso pago só com pagamento confirmado
    // primeira cobrança só depois do teste (00:00 de São Paulo do dia em que o teste acaba)
    expect(paypal.subscriptions.get(ppSubId)!.startTime).toBe(`${addDaysISO(todayISO(), 14)}T03:00:00Z`);
  });

  it('recontratar o mesmo plano reaproveita o plano já criado no PayPal e cancela o pedido anterior', async () => {
    const r = await owner.post('/api/billing/subscribe', { provider: 'PAYPAL', planId });
    expect(r.statusCode).toBe(200);
    expect(paypal.plans.size).toBe(1);
    expect(paypal.canceled).toContain(ppSubId);
    ppSubId = (await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })).paypalSubscriptionId!;
  });

  it('webhook com assinatura digital inválida é recusado e não é guardado', async () => {
    paypal.validSignature = false;
    const r = await paypalWebhook({ id: 'WH-EVT-0', event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: ppSubId } });
    paypal.validSignature = true;
    expect(r.statusCode).toBe(401);
    expect(await env.db.paymentProviderEvent.count({ where: { provider: 'PAYPAL' } })).toBe(0);
  });

  it('pagamento em outra moeda não libera acesso', async () => {
    const s = paypal.subscriptions.get(ppSubId)!;
    s.status = 'ACTIVE';
    s.lastPayment = { valueCents: 4990, currency: 'USD', time: new Date().toISOString() };
    const r = await paypalWebhook({ id: 'WH-EVT-1', event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: ppSubId } });
    expect(r.statusCode).toBe(200);
    const sub = await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe('TRIALING');
  });

  it('pagamento confirmado (consultado no PayPal) libera o período pago; evento repetido não duplica', async () => {
    const s = paypal.subscriptions.get(ppSubId)!;
    const paidAt = new Date();
    s.lastPayment = { valueCents: 4990, currency: 'BRL', time: paidAt.toISOString() };
    const ev = { id: 'WH-EVT-2', event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: ppSubId } };
    expect((await paypalWebhook(ev)).statusCode).toBe(200);
    const sub = await env.db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.currentPeriodEnd?.toISOString().slice(0, 10)).toBe(periodEndFrom(todayISO(paidAt), 'MONTHLY'));
    expect((await paypalWebhook(ev)).json()).toEqual({ received: true, duplicate: true });
    const stored = await env.db.paymentProviderEvent.findFirstOrThrow({ where: { externalId: 'WH-EVT-2' } });
    expect(stored).toMatchObject({ provider: 'PAYPAL', status: 'PROCESSED', tenantId });
  });

  it('evento de outra assinatura é ignorado com o motivo', async () => {
    await paypalWebhook({ id: 'WH-EVT-3', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-DESCONHECIDA' } });
    const ev = await env.db.paymentProviderEvent.findFirstOrThrow({ where: { externalId: 'WH-EVT-3' } });
    expect(ev).toMatchObject({ status: 'IGNORED', lastError: 'Assinatura desconhecida.' });
  });

  it('cancelar encerra no PayPal e mantém o acesso até o fim do período pago', async () => {
    const r = await owner.post('/api/billing/cancel', { confirm: true });
    expect(r.statusCode).toBe(200);
    expect(paypal.canceled).toContain(ppSubId);
    const b = (await owner.get('/api/billing')).json();
    expect(b.status).toBe('CANCELED');
    expect(b.access.level).toBe('FULL');
  });

  it('mensagens de erro chegam no idioma pedido pelo site', async () => {
    const pt = await owner.req('POST', '/api/billing/cancel', { confirm: true }, { 'accept-language': 'pt-BR' });
    expect(pt.json().message).toBe('Não há assinatura ativa.');
    const en = await owner.req('POST', '/api/billing/cancel', { confirm: true }, { 'accept-language': 'en' });
    expect(en.statusCode).toBe(409);
    expect(en.json()).toMatchObject({ error: 'CONFLICT', message: 'There is no active subscription.' });
  });
});

describe('Asaas configurado pelo painel', () => {
  it('salvar o Asaas pelo painel passa a valer para o webhook e para novas contratações', async () => {
    const short = await admin.put('/api/platform/payment-providers/ASAAS', {
      enabled: true,
      environment: 'SANDBOX',
      credentials: { apiKey: 'chave-sandbox-de-teste', webhookToken: 'curto' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().fields['credentials.webhookToken']).toMatch(/32 caracteres/);
    const ok = await admin.put('/api/platform/payment-providers/ASAAS', {
      enabled: true,
      environment: 'SANDBOX',
      credentials: { apiKey: 'chave-sandbox-de-teste', webhookToken: ASAAS_TOKEN },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ready: true, source: 'database', webhookUrl: 'http://localhost:5173/api/webhooks/asaas' });
    const hook = await env.app.inject({
      method: 'POST',
      url: '/api/webhooks/asaas',
      headers: { 'content-type': 'application/json', 'asaas-access-token': ASAAS_TOKEN },
      payload: JSON.stringify({ id: 'evt_painel_1', event: 'PAYMENT_RECEIVED', payment: {} }),
    });
    expect(hook.statusCode).toBe(200);
    const o = await signup(env.app, 'Escolhe o meio');
    expect((await o.client.get('/api/billing')).json().providers).toEqual(['ASAAS', 'PAYPAL']);
  });

  it('desligar um meio de pagamento tira das novas contratações', async () => {
    await admin.put('/api/platform/payment-providers/PAYPAL', { enabled: false, environment: 'SANDBOX' });
    const o = await signup(env.app, 'Só Asaas');
    expect((await o.client.get('/api/billing')).json().providers).toEqual(['ASAAS']);
    const r = await o.client.post('/api/billing/subscribe', { provider: 'PAYPAL', planId });
    expect(r.statusCode).toBe(503);
  });
});

describe('Sem SECRETS_KEY no servidor', () => {
  it('o painel mostra o aviso e não salva credenciais', async () => {
    const plain = await createTestEnv({ env: {} });
    try {
      const a = await signup(plain.app, 'Operação sem chave');
      await plain.db.user.update({ where: { id: a.userId }, data: { isPlatformAdmin: true } });
      expect((await a.client.get('/api/platform/payment-providers')).json().canStoreSecrets).toBe(false);
      const r = await a.client.put('/api/platform/payment-providers/PAYPAL', { enabled: false, environment: 'SANDBOX' });
      expect(r.statusCode).toBe(503);
      expect(r.json().error).toBe('SECRETS_KEY_MISSING');
    } finally {
      await plain.close();
    }
  });
});
