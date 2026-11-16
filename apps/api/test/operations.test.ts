import { addDaysISO, todayISO } from '@reformar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, Client, createCustomer, createTestEnv, quoteBody, signup, type TestEnv } from './helpers.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(7)]);
const today = todayISO();

let env: TestEnv;
let owner: Client;
let tenantId: string;
let customerId: string;
let quoteId: string;
let projectId: string;
let stageId: string;
let field: Client;

async function approvedQuote(c: Client, customer: string) {
  const q = (await c.post('/api/quotes', quoteBody(customer))).json();
  const r = await c.post(`/api/quotes/${q.id}/approve`, { approvedByName: 'João', channel: 'WHATSAPP', approvedOn: today });
  if (r.statusCode !== 200) throw new Error(r.body);
  return q.id as string;
}

beforeAll(async () => {
  env = await createTestEnv();
  const s = await signup(env.app, 'Obras Teste');
  owner = s.client;
  tenantId = s.tenantId;
  customerId = await createCustomer(owner);
  quoteId = await approvedQuote(owner, customerId);
  field = await addMember(env, tenantId, 'FIELD');
});
afterAll(async () => env.close());

describe('Jornada C — orçamento aprovado vira obra', () => {
  it('exige confirmação explícita e orçamento aprovado', async () => {
    expect((await owner.post('/api/projects/from-quote', { quoteId })).statusCode).toBe(400);
    const draft = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    const notApproved = await owner.post('/api/projects/from-quote', { quoteId: draft.id, confirm: true });
    expect(notApproved.statusCode).toBe(409);
    expect(notApproved.json().error).toBe('NOT_APPROVED');
  });

  it('cria a obra com vínculo à revisão aprovada, etapas e materiais previstos', async () => {
    const res = await owner.post('/api/projects/from-quote', { quoteId, confirm: true, expectedEndDate: addDaysISO(today, 30) });
    expect(res.statusCode).toBe(201);
    projectId = res.json().id;
    const p = (await owner.get(`/api/projects/${projectId}`)).json();
    expect(p.number).toBe(1);
    expect(p.quote.revision).toBe(1);
    expect(p.contractTotalCents).toBe(212720);
    expect(p.status).toBe('PLANNED');
    expect(p.stages).toHaveLength(1);
    expect(p.stages[0]).toMatchObject({ name: 'Assentamento de porcelanato', plannedQuantity: '32', unitPriceCents: 5500 });
    expect(p.materials.map((m: { description: string }) => m.description)).toEqual(['Porcelanato 60x60', 'Argamassa AC-III']);
    expect(p.finance.plannedCostCents).toBe(36720 + 72000 + 22500);
    expect(p.alerts.map((a: { code: string }) => a.code)).toContain('UNSCHEDULED_CONTRACT');
    stageId = p.stages[0].id;
  });

  it('não converte o mesmo orçamento duas vezes', async () => {
    const again = await owner.post('/api/projects/from-quote', { quoteId, confirm: true });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('PROJECT_EXISTS');
  });
});

describe('Medição da obra com fotos', () => {
  let measurementId: string;

  it('colaborador de campo registra medição (rascunho) e fotos, sem ver valores', async () => {
    const res = await field.post(`/api/projects/${projectId}/measurements`, {
      measuredOn: today,
      notes: 'Sala concluída',
      items: [{ stageId, quantity: '16' }],
    });
    expect(res.statusCode).toBe(201);
    measurementId = res.json().id;
    const photo = await field.req('POST', `/api/projects/${projectId}/photos?measurementId=${measurementId}&stageId=${stageId}&caption=Sala`, JPEG, {
      'content-type': 'image/jpeg',
    });
    expect(photo.statusCode).toBe(201);
    const list = (await field.get(`/api/projects/${projectId}/measurements`)).json();
    expect(list[0].photos).toHaveLength(1);
    expect(list[0].photos[0].caption).toBe('Sala');
    expect(list[0].totalCents).toBeNull();
    const p = (await field.get(`/api/projects/${projectId}`)).json();
    expect(p.contractTotalCents).toBeNull();
    expect(p.finance).toBeNull();
    expect(p.stages[0].unitPriceCents).toBeNull();
  });

  it('foto falsa é recusada; foto é servida só para a empresa', async () => {
    const fake = await field.req('POST', `/api/projects/${projectId}/photos`, Buffer.from('<svg onload=alert(1)>aaaaaaaaaa'), {
      'content-type': 'image/jpeg',
    });
    expect(fake.statusCode).toBe(400);
    const photos = (await owner.get(`/api/projects/${projectId}/photos`)).json();
    const img = await owner.get(photos[0].url);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    const other = await signup(env.app, 'Intrusa');
    expect((await other.client.get(photos[0].url)).statusCode).toBe(404);
  });

  it('colaborador de campo não confirma medição', async () => {
    expect((await field.post(`/api/projects/${projectId}/measurements/${measurementId}/confirm`)).statusCode).toBe(403);
  });

  it('gestor confirma: soma na etapa, calcula valor, gera cobrança conferida e inicia a obra', async () => {
    const res = await owner.post(`/api/projects/${projectId}/measurements/${measurementId}/confirm`, {
      receivable: { amountCents: 88000, dueDate: addDaysISO(today, 5) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CONFIRMED');
    expect(res.json().totalCents).toBe(88000); // 16 m² × R$ 55
    expect(res.json().receivableId).toBeTruthy();
    const p = (await owner.get(`/api/projects/${projectId}`)).json();
    expect(p.status).toBe('IN_PROGRESS');
    expect(p.stages[0].measuredQuantity).toBe('16');
    expect(p.stages[0].status).toBe('IN_PROGRESS');
    expect(p.progressPercent).toBe('50');
    expect(p.finance.scheduledCents).toBe(88000);
  });

  it('medição confirmada é imutável e não aceita confirmação dupla nem novas fotos', async () => {
    expect((await owner.post(`/api/projects/${projectId}/measurements/${measurementId}/confirm`)).statusCode).toBe(409);
    expect((await owner.put(`/api/projects/${projectId}/measurements/${measurementId}`, { measuredOn: today, items: [] })).statusCode).toBe(409);
    const photo = await owner.req('POST', `/api/projects/${projectId}/photos?measurementId=${measurementId}`, JPEG, { 'content-type': 'image/jpeg' });
    expect(photo.statusCode).toBe(409);
  });

  it('não deixa medir além do previsto (e nada é gravado)', async () => {
    const m = (await owner.post(`/api/projects/${projectId}/measurements`, { measuredOn: today, items: [{ stageId, quantity: '17' }] })).json();
    const res = await owner.post(`/api/projects/${projectId}/measurements/${m.id}/confirm`);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Falta medir 16');
    const list = (await owner.get(`/api/projects/${projectId}/measurements`)).json();
    expect(list.find((x: { id: string }) => x.id === m.id).status).toBe('DRAFT');
    const p = (await owner.get(`/api/projects/${projectId}`)).json();
    expect(p.stages[0].measuredQuantity).toBe('16');
    await owner.del(`/api/projects/${projectId}/measurements/${m.id}`);
  });

  it('diário de obra com foto', async () => {
    const d = await field.post(`/api/projects/${projectId}/diary`, { date: today, text: 'Chegou o piso. 2 ajudantes.', workersCount: 3 });
    expect(d.statusCode).toBe(201);
    await field.req('POST', `/api/projects/${projectId}/photos?diaryEntryId=${d.json().id}`, JPEG, { 'content-type': 'image/jpeg' });
    const diary = (await owner.get(`/api/projects/${projectId}/diary`)).json();
    expect(diary[0].photos).toHaveLength(1);
    expect(diary[0].createdByName).toBe('Membro FIELD');
  });
});

describe('Jornada D — recebimentos', () => {
  let receivableId: string;

  it('plano de pagamento cobre exatamente o saldo do contrato ainda sem cobrança', async () => {
    const res = await owner.post(`/api/projects/${projectId}/payment-plan`, {
      downPaymentCents: 24720,
      downPaymentDate: today,
      installments: 2,
      firstInstallmentDate: addDaysISO(today, 30),
      confirm: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ count: 3, totalCents: 124720 });
    const list = (await owner.get(`/api/receivables?projectId=${projectId}`)).json();
    expect(list.reduce((a: number, r: { amountCents: number }) => a + r.amountCents, 0)).toBe(212720);
    receivableId = list.find((r: { kind: string }) => r.kind === 'DOWN_PAYMENT').id;
    expect((await owner.post(`/api/projects/${projectId}/payment-plan`, { downPaymentCents: 0, downPaymentDate: today, installments: 1, firstInstallmentDate: today, confirm: true })).statusCode).toBe(409);
  });

  it('pagamento parcial reduz o saldo sem alterar o valor do contrato; não aceita valor acima do saldo', async () => {
    const key = { 'idempotency-key': 'pagamento-entrada-1' };
    const body = { amountCents: 10000, paidOn: today, method: 'PIX', note: 'Comprovante no WhatsApp' };
    const r1 = await owner.post(`/api/receivables/${receivableId}/payments`, body, key);
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ amountCents: 24720, paidCents: 10000, balanceCents: 14720, status: 'PARTIAL' });
    const replay = await owner.post(`/api/receivables/${receivableId}/payments`, body, key);
    expect(replay.json().paidCents).toBe(10000);
    const over = await owner.post(`/api/receivables/${receivableId}/payments`, { ...body, amountCents: 14721 });
    expect(over.statusCode).toBe(400);
    const p = (await owner.get(`/api/projects/${projectId}`)).json();
    expect(p.contractTotalCents).toBe(212720);
    expect(p.finance.receivedCents).toBe(10000);
    expect(p.finance.toReceiveCents).toBe(212720 - 10000);
  });

  it('estorno mantém o registro e devolve o saldo; cobrança com pagamento não pode ser cancelada', async () => {
    const r = (await owner.get(`/api/receivables?projectId=${projectId}`)).json().find((x: { id: string }) => x.id === receivableId);
    expect((await owner.post(`/api/receivables/${receivableId}/cancel`, { reason: 'teste' })).statusCode).toBe(409);
    const rev = await owner.post(`/api/receivable-payments/${r.payments[0].id}/reverse`, { reason: 'PIX devolvido' });
    expect(rev.json()).toMatchObject({ paidCents: 0, balanceCents: 24720, status: 'OPEN' });
    expect(rev.json().payments[0].reverseReason).toBe('PIX devolvido');
    expect((await owner.post(`/api/receivable-payments/${r.payments[0].id}/reverse`, { reason: 'de novo' })).statusCode).toBe(409);
    await owner.post(`/api/receivables/${receivableId}/payments`, { amountCents: 24720, paidOn: today, method: 'CASH' });
  });

  it('cobrança avulsa vinculada à obra não pode passar do contrato', async () => {
    const res = await owner.post('/api/receivables', { projectId, customerId, kind: 'OTHER', description: 'Extra', amountCents: 100, dueDate: today });
    expect(res.statusCode).toBe(400);
  });
});

describe('Despesas, estoque e custo sem duplicidade', () => {
  let materialId: string;
  let locationId: string;
  let purchaseExpenseId: string;

  it('lança almoços (pago) e diárias (a pagar, vencida)', async () => {
    const lunch = await owner.post('/api/expenses', {
      projectId, category: 'FOOD', description: 'Almoço da equipe', quantity: '3', unit: 'refeição',
      amountCents: 7500, date: today, status: 'PAID', paidOn: today, paymentMethod: 'CASH',
    });
    expect(lunch.statusCode).toBe(201);
    const team = await owner.post('/api/expenses', {
      projectId, category: 'TEAM', description: 'Diárias ajudante', amountCents: 36000, date: today, dueDate: addDaysISO(today, -1), status: 'COMMITTED',
    });
    expect(team.statusCode).toBe(201);
    const p = (await owner.get(`/api/projects/${projectId}`)).json();
    expect(p.finance.actualCostCents).toBe(43500);
    expect(p.finance.paidCostCents).toBe(7500);
    expect(p.alerts.map((a: { code: string }) => a.code)).toContain('OVERDUE_PAYABLE');
  });

  it('rateio entre obras soma exatamente o valor', async () => {
    const other = (await owner.post('/api/projects', { customerId, name: 'Muro', contractTotalCents: 50000 })).json();
    const res = await owner.post('/api/expenses', {
      category: 'TRANSPORT', description: 'Gasolina', amountCents: 10001, date: today, status: 'PAID', paidOn: today, paymentMethod: 'PIX',
      allocations: [{ projectId, percent: '50' }, { projectId: other.id, percent: '50' }],
    });
    expect(res.statusCode).toBe(201);
    const list = (await owner.get('/api/expenses?category=TRANSPORT')).json();
    expect(list.reduce((a: number, e: { amountCents: number }) => a + e.amountCents, 0)).toBe(10001);
    expect(new Set(list.map((e: { groupId: string }) => e.groupId)).size).toBe(1);
  });

  it('compra de material = 1 despesa + 1 entrada física; uso na obra não gera custo', async () => {
    materialId = (await owner.post('/api/materials', { name: 'Argamassa AC-III 20 kg', unit: 'saco', minStock: '2' })).json().id;
    const p0 = (await owner.get(`/api/projects/${projectId}`)).json();
    locationId = p0.stockLocationId;
    const cost0 = p0.finance.actualCostCents;
    const buy = await owner.post('/api/stock/purchases', {
      materialId, quantity: '10', toLocationId: locationId, amountCents: 45900, date: today, supplier: 'Casa de Material',
      status: 'PAID', paidOn: today, paymentMethod: 'PIX',
    }, { 'idempotency-key': 'compra-argamassa-1' });
    expect(buy.statusCode).toBe(201);
    purchaseExpenseId = buy.json().expenseId;
    await owner.post('/api/stock/purchases', { materialId, quantity: '10', toLocationId: locationId, amountCents: 45900, date: today, status: 'PAID', paidOn: today, paymentMethod: 'PIX' }, { 'idempotency-key': 'compra-argamassa-1' });

    const use = await field.post('/api/stock/movements', { materialId, type: 'OUT', quantity: '4', fromLocationId: locationId, date: today });
    expect(use.statusCode).toBe(201);
    const p1 = (await owner.get(`/api/projects/${projectId}`)).json();
    expect(p1.finance.actualCostCents).toBe(cost0 + 45900); // custo contado UMA vez
    expect(p1.finance.costsByCategory.MATERIAL).toBe(45900);

    const balances = (await owner.get(`/api/stock/balances?locationId=${locationId}`)).json();
    expect(balances[0]).toMatchObject({ materialName: 'Argamassa AC-III 20 kg', quantity: '6' });
    const tooMuch = await field.post('/api/stock/movements', { materialId, type: 'OUT', quantity: '7', fromLocationId: locationId, date: today });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().message).toContain('há 6 saco');
  });

  it('material previsto mostra comprado × usado; campo não registra compra', async () => {
    const p = (await owner.get(`/api/projects/${projectId}`)).json();
    const pm = p.materials.find((m: { description: string }) => m.description === 'Argamassa AC-III');
    await owner.put(`/api/projects/${projectId}/materials/${pm.id}`, { materialId });
    const after = (await owner.get(`/api/projects/${projectId}`)).json().materials.find((m: { id: string }) => m.id === pm.id);
    // previsto 160 kg = 8 sacos; estoque controlado em "saco" => compara 8 × 10 recebidos × 4 usados
    expect(after).toMatchObject({ plannedQuantity: '160', plannedPackages: 8, stockUnit: 'saco', plannedInStockUnit: '8', unitMismatch: false, receivedQuantity: '10', usedQuantity: '4' });
    // material em unidade incompatível (sem fator) não é comparado por suposição
    const litros = (await owner.post('/api/materials', { name: 'Impermeabilizante', unit: 'L' })).json();
    await owner.put(`/api/projects/${projectId}/materials/${pm.id}`, { materialId: litros.id });
    const mismatch = (await owner.get(`/api/projects/${projectId}`)).json().materials.find((m: { id: string }) => m.id === pm.id);
    expect(mismatch).toMatchObject({ plannedInStockUnit: null, unitMismatch: true });
    await owner.put(`/api/projects/${projectId}/materials/${pm.id}`, { materialId });
    const res = await field.post('/api/stock/purchases', { materialId, quantity: '1', toLocationId: locationId, amountCents: 100, date: today, status: 'PAID', paidOn: today, paymentMethod: 'PIX' });
    expect(res.statusCode).toBe(403);
  });

  it('cancelar compra com entrada no estoque exige devolução antes', async () => {
    expect((await owner.post(`/api/expenses/${purchaseExpenseId}/cancel`, { reason: 'erro' })).statusCode).toBe(409);
  });

  it('visão geral e exportação CSV', async () => {
    const o = (await owner.get('/api/finance/overview')).json();
    expect(o.payable.overdueCents).toBe(36000);
    expect(o.cashFlow).toHaveLength(6);
    const csv = await owner.get('/api/finance/export/expenses.csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.body).toContain('Data;Obra;Categoria');
    expect(csv.body).toContain('459,00');
  });
});

describe('Isolamento entre empresas (Fase 2)', () => {
  it('outra empresa não acessa obra, medições, despesas, recebimentos nem estoque', async () => {
    const b = await signup(env.app, 'Outra Empresa');
    const c = b.client;
    expect((await c.get(`/api/projects/${projectId}`)).statusCode).toBe(404);
    expect((await c.get(`/api/projects/${projectId}/measurements`)).statusCode).toBe(404);
    expect((await c.get(`/api/projects/${projectId}/diary`)).statusCode).toBe(404);
    expect((await c.post(`/api/projects/${projectId}/measurements`, { measuredOn: today, items: [] })).statusCode).toBe(404);
    expect((await c.req('POST', `/api/projects/${projectId}/photos`, JPEG, { 'content-type': 'image/jpeg' })).statusCode).toBe(404);
    expect((await c.post(`/api/projects/${projectId}/payment-plan`, { downPaymentCents: 0, downPaymentDate: today, installments: 1, firstInstallmentDate: today, confirm: true })).statusCode).toBe(404);
    expect((await c.get('/api/projects')).json()).toHaveLength(0);
    expect((await c.get('/api/expenses')).json()).toHaveLength(0);
    expect((await c.get('/api/receivables')).json()).toHaveLength(0);
    const recs = (await owner.get(`/api/receivables?projectId=${projectId}`)).json();
    expect((await c.post(`/api/receivables/${recs[0].id}/payments`, { amountCents: 1, paidOn: today, method: 'PIX' })).statusCode).toBe(404);
    const exp = (await owner.get('/api/expenses')).json();
    expect((await c.post(`/api/expenses/${exp[0].id}/pay`, { paidOn: today, paymentMethod: 'PIX' })).statusCode).toBe(409);
    expect((await c.post('/api/expenses', { projectId, category: 'FOOD', description: 'x invasor', amountCents: 1, date: today })).statusCode).toBe(404);
    const mats = (await owner.get('/api/materials')).json();
    const p = (await owner.get(`/api/projects/${projectId}`)).json();
    expect((await c.post('/api/stock/movements', { materialId: mats[0].id, type: 'OUT', quantity: '1', fromLocationId: p.stockLocationId, date: today })).statusCode).toBe(404);
    expect((await c.get('/api/stock/balances')).json()).toHaveLength(0);
    const own = (await c.post('/api/materials', { name: 'Cimento', unit: 'saco' })).json();
    expect((await c.post('/api/stock/purchases', { materialId: own.id, quantity: '1', toLocationId: p.stockLocationId, amountCents: 100, date: today, status: 'PAID', paidOn: today, paymentMethod: 'PIX' })).statusCode).toBe(404);
  });
});
