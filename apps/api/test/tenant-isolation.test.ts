import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, createTestEnv, quoteBody, signup, type Client, type TestEnv } from './helpers.js';

/**
 * Critério de aceite: usuário da empresa A não lê, altera nem exporta recursos da empresa B,
 * mesmo manipulando IDs.
 */
let env: TestEnv;
let a: { client: Client; tenantId: string };
let b: { client: Client; tenantId: string };
let customerA: string;
let quoteA: string;
let serviceA: string;

beforeAll(async () => {
  env = await createTestEnv();
  a = await signup(env.app, 'Empresa A');
  b = await signup(env.app, 'Empresa B');
  customerA = await createCustomer(a.client, 'Cliente Secreto da A');
  const q = await a.client.post('/api/quotes', quoteBody(customerA));
  quoteA = q.json().id;
  await a.client.post(`/api/quotes/${quoteA}/send`);
  serviceA = (await a.client.get('/api/services')).json()[0].id;
});
afterAll(async () => env.close());

describe('isolamento entre empresas', () => {
  it('B não vê clientes nem orçamentos de A nas listagens', async () => {
    const customers = (await b.client.get('/api/customers?q=Secreto')).json();
    expect(customers.total).toBe(0);
    const quotes = (await b.client.get('/api/quotes')).json();
    expect(quotes.data.find((q: { id: string }) => q.id === quoteA)).toBeUndefined();
    const dashboard = (await b.client.get('/api/dashboard')).json();
    expect(dashboard.awaiting.count).toBe(0);
  });

  it('B não lê, altera nem exclui cliente de A pelo ID', async () => {
    expect((await b.client.get(`/api/customers/${customerA}`)).statusCode).toBe(404);
    expect((await b.client.put(`/api/customers/${customerA}`, { name: 'Hackeado' })).statusCode).toBe(404);
    expect((await b.client.del(`/api/customers/${customerA}`)).statusCode).toBe(404);
    const still = (await a.client.get(`/api/customers/${customerA}`)).json();
    expect(still.name).toBe('Cliente Secreto da A');
  });

  it('B não lê, altera, envia, aprova, duplica, compartilha nem exporta orçamento de A', async () => {
    expect((await b.client.get(`/api/quotes/${quoteA}`)).statusCode).toBe(404);
    expect((await b.client.put(`/api/quotes/${quoteA}`, { lockVersion: 0, content: quoteBody(customerA) })).statusCode).toBe(404);
    expect((await b.client.post(`/api/quotes/${quoteA}/send`)).statusCode).toBe(404);
    expect(
      (
        await b.client.post(`/api/quotes/${quoteA}/approve`, {
          approvedByName: 'Xavier Lima',
          channel: 'OTHER',
          approvedOn: new Date().toISOString().slice(0, 10),
        })
      ).statusCode,
    ).toBe(404);
    expect((await b.client.post(`/api/quotes/${quoteA}/refuse`)).statusCode).toBe(404);
    expect((await b.client.post(`/api/quotes/${quoteA}/duplicate`)).statusCode).toBe(404);
    expect((await b.client.post(`/api/quotes/${quoteA}/share`)).statusCode).toBe(404);
    expect((await b.client.get(`/api/quotes/${quoteA}/pdf`)).statusCode).toBe(404);
    expect((await b.client.get(`/api/quotes/${quoteA}/pdf?mode=internal`)).statusCode).toBe(404);
    expect((await b.client.del(`/api/quotes/${quoteA}`)).statusCode).toBe(404);
  });

  it('B não cria orçamento usando cliente de A', async () => {
    const res = await b.client.post('/api/quotes', quoteBody(customerA));
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.customerId).toBeTruthy();
  });

  it('B não move o próprio orçamento para cliente de A', async () => {
    const customerB = await createCustomer(b.client, 'Cliente da B');
    const q = (await b.client.post('/api/quotes', quoteBody(customerB))).json();
    const res = await b.client.put(`/api/quotes/${q.id}`, { lockVersion: 0, content: quoteBody(customerA) });
    expect(res.statusCode).toBe(400);
  });

  it('B não altera serviço do catálogo de A', async () => {
    const res = await b.client.put(`/api/services/${serviceA}`, { name: 'Serviço invasor', unit: 'M2', defaultPriceCents: 1 });
    expect(res.statusCode).toBe(404);
  });

  it('B não troca a sessão para a empresa A (sem vínculo explícito)', async () => {
    const res = await b.client.post('/api/auth/switch-tenant', { tenantId: a.tenantId });
    expect(res.statusCode).toBe(404);
    const me = (await b.client.get('/api/auth/me')).json();
    expect(me.activeTenant.id).toBe(b.tenantId);
  });

  it('enviar tenantId no corpo não muda a empresa usada', async () => {
    const res = await b.client.post('/api/customers', { name: 'Tentativa', tenantId: a.tenantId });
    expect(res.statusCode).toBe(201);
    const created = await env.db.customer.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(created.tenantId).toBe(b.tenantId);
  });

  it('dados da empresa e logomarca ficam isolados', async () => {
    const companyB = (await b.client.get('/api/company')).json();
    expect(companyB.tradeName).toBe('Empresa B');
  });

  it('banco recusa orçamento ligado a cliente de outra empresa (FK composta)', async () => {
    await expect(
      env.db.quote.create({
        data: { tenantId: b.tenantId, number: 9999, customerId: customerA, title: 'x', validUntil: new Date() },
      }),
    ).rejects.toThrow();
  });
});
