import { addDaysISO, todayISO } from '@reformar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  Client,
  createCustomer,
  createTestEnv,
  pdfToText,
  quoteBody,
  signup,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let owner: Client;
let tenantId: string;
let customerId: string;

beforeAll(async () => {
  env = await createTestEnv();
  const s = await signup(env.app, 'Reformas Silva');
  owner = s.client;
  tenantId = s.tenantId;
  customerId = await createCustomer(owner);
  await owner.put('/api/company', {
    tradeName: 'Reformas Silva',
    document: '12.345.678/0001-90',
    phone: '(11) 3333-4444',
    whatsapp: '(11) 98888-7777',
    primaryColor: '#0B5394',
    defaultValidityDays: 10,
  });
});
afterAll(async () => env.close());

describe('Jornada A — orçamento manual', () => {
  let quoteId: string;

  it('cria rascunho com numeração sequencial e cálculo autoritativo no servidor', async () => {
    const res = await owner.post('/api/quotes', quoteBody(customerId));
    expect(res.statusCode).toBe(201);
    quoteId = res.json().id;
    expect(res.json().number).toBe(1);

    const detail = (await owner.get(`/api/quotes/${quoteId}`)).json();
    expect(detail.status).toBe('DRAFT');
    expect(detail.calculation.items[0].totalCents).toBe(176000);
    expect(detail.calculation.materials[0].calculatedQuantity).toBe('35.2');
    expect(detail.calculation.materials[0].packages).toBe(15);
    expect(detail.calculation.totals.materialsBilledCents).toBe(36720);
    expect(detail.totalCents).toBe(176000 + 36720);
    expect(detail.calculation.totals.internalCostsCents).toBe(36720 + 72000 + 22500);
    expect(detail.content.items[0].quantity).toBe('32');

    const second = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    expect(second.number).toBe(2);
  });

  it('o cliente não consegue impor totais: valores vêm do cálculo do servidor', async () => {
    const res = await owner.post('/api/quotes', { ...quoteBody(customerId), totalCents: 1 });
    const detail = (await owner.get(`/api/quotes/${res.json().id}`)).json();
    expect(detail.totalCents).toBe(212720);
  });

  it('edita com controle de concorrência (lockVersion)', async () => {
    const detail = (await owner.get(`/api/quotes/${quoteId}`)).json();
    const body = quoteBody(customerId, {
      items: [{ description: 'Assentamento de porcelanato', unit: 'M2', quantity: '40', unitPriceCents: 5500 }],
    });
    const ok = await owner.put(`/api/quotes/${quoteId}`, { lockVersion: detail.lockVersion, content: body });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().calculation.items[0].totalCents).toBe(220000);
    // mesma lockVersion antiga => conflito (outro aparelho editou)
    const stale = await owner.put(`/api/quotes/${quoteId}`, { lockVersion: detail.lockVersion, content: body });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('STALE');
  });

  it('PDF de rascunho é marcado como prévia', async () => {
    const res = await owner.get(`/api/quotes/${quoteId}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const text = pdfToText(res.rawPayload);
    expect(text).toContain('RASCUNHO');
  });

  it('emite (envia) e congela a revisão 1', async () => {
    const res = await owner.post(`/api/quotes/${quoteId}/send`);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('SENT');
    expect(res.json().versions).toHaveLength(1);
    // reenviar não duplica versão
    const again = await owner.post(`/api/quotes/${quoteId}/send`);
    expect(again.json().versions).toHaveLength(1);
  });

  it('PDF para o cliente mostra empresa, cliente e totais, sem custos internos nem lucro', async () => {
    const res = await owner.get(`/api/quotes/${quoteId}/pdf?mode=detailed`);
    const text = pdfToText(res.rawPayload);
    expect(text).toContain('Reformas Silva');
    expect(text).toContain('12.345.678/0001-90');
    expect(text).toContain('João da Silva');
    expect(text).toContain('R$ 2.200,00');
    expect(text).toContain('R$ 55,00');
    expect(text).toContain('18 caixas'); // 40 m² + 10% = 44 ÷ 2,5 = 17,6
    expect(text).not.toContain('RASCUNHO');
    expect(text).not.toMatch(/lucro/i);
    expect(text).not.toContain('Ajudante');
    expect(text).not.toContain('Almoço da equipe');
    expect(text).not.toContain('USO INTERNO');
  });

  it('PDF resumido não mostra preços unitários', async () => {
    const text = pdfToText((await owner.get(`/api/quotes/${quoteId}/pdf?mode=summary`)).rawPayload);
    expect(text).toContain('VALOR TOTAL');
    expect(text).not.toContain('R$ 55,00');
    expect(text).not.toMatch(/lucro/i);
  });

  it('PDF interno mostra custos e lucro estimado, com aviso', async () => {
    const text = pdfToText((await owner.get(`/api/quotes/${quoteId}/pdf?mode=internal`)).rawPayload);
    expect(text).toContain('USO INTERNO');
    expect(text).toContain('LUCRO ESTIMADO');
    expect(text).toContain('Ajudante');
  });

  it('editar orçamento enviado abre revisão 2 e preserva a revisão 1', async () => {
    const detail = (await owner.get(`/api/quotes/${quoteId}`)).json();
    const body = quoteBody(customerId, {
      items: [{ description: 'Assentamento de porcelanato', unit: 'M2', quantity: '40', unitPriceCents: 6000 }],
    });
    const res = await owner.put(`/api/quotes/${quoteId}`, { lockVersion: detail.lockVersion, content: body });
    expect(res.json().status).toBe('DRAFT');
    expect(res.json().currentRevision).toBe(2);
    const r1 = pdfToText((await owner.get(`/api/quotes/${quoteId}/pdf?revision=1`)).rawPayload);
    expect(r1).toContain('R$ 2.200,00');
    expect(r1).not.toContain('R$ 2.400,00');
    await owner.post(`/api/quotes/${quoteId}/send`);
    const r2 = pdfToText((await owner.get(`/api/quotes/${quoteId}/pdf`)).rawPayload);
    expect(r2).toContain('R$ 2.400,00');
    expect(r2).toContain('Revisão 2');
  });

  it('link seguro: abre sem login, só a revisão emitida, nunca o modo interno', async () => {
    const share = (await owner.post(`/api/quotes/${quoteId}/share`, { mode: 'detailed' })).json();
    expect(share.url).toMatch(/\/api\/public\/quotes\/[\w-]+\/pdf$/);
    expect(share.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5511987654321\?text=/);
    const path = new URL(share.url).pathname;
    const anon = new Client(env.app);
    const res = await anon.get(path);
    expect(res.statusCode).toBe(200);
    const text = pdfToText(res.rawPayload);
    expect(text).toContain('R$ 2.400,00');
    expect(text).not.toMatch(/lucro/i);
    expect((await anon.get(`${path}?mode=internal`)).statusCode).toBe(200);
    expect(pdfToText((await anon.get(`${path}?mode=internal`)).rawPayload)).not.toMatch(/lucro/i);
    expect((await anon.get('/api/public/quotes/tokeninexistente1234567890/pdf')).statusCode).toBe(404);
  });

  it('link revogado ou expirado deixa de funcionar', async () => {
    const share = (await owner.post(`/api/quotes/${quoteId}/share`)).json();
    const path = new URL(share.url).pathname;
    await env.db.quoteShareLink.updateMany({ where: { tenantId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await new Client(env.app).get(path)).statusCode).toBe(404);
  });

  it('aprovação: valida data, registra evidência e é idempotente', async () => {
    const future = await owner.post(`/api/quotes/${quoteId}/approve`, {
      approvedByName: 'João da Silva',
      channel: 'WHATSAPP',
      approvedOn: addDaysISO(todayISO(), 1),
    });
    expect(future.statusCode).toBe(400);

    const body = { approvedByName: 'João da Silva', channel: 'WHATSAPP', approvedOn: todayISO(), note: 'Aceitou pelo WhatsApp' };
    const key = 'aprovacao-teste-0001';
    const first = await owner.post(`/api/quotes/${quoteId}/approve`, body, { 'idempotency-key': key });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('APPROVED');
    expect(first.json().approval.revision).toBe(2);
    expect(first.json().approval.recordedByName).toBe('Fulano de Tal');
    // retransmissão com a mesma chave: sem novo registro
    const replay = await owner.post(`/api/quotes/${quoteId}/approve`, body, { 'idempotency-key': key });
    expect(replay.statusCode).toBe(200);
    expect(await env.db.quoteApproval.count({ where: { quoteId } })).toBe(1);
    // nova tentativa sem chave: recusada (já aprovado)
    expect((await owner.post(`/api/quotes/${quoteId}/approve`, body)).statusCode).toBe(409);
  });

  it('orçamento aprovado fica travado; duplicar cria novo rascunho', async () => {
    const detail = (await owner.get(`/api/quotes/${quoteId}`)).json();
    expect(detail.canEdit).toBe(false);
    const edit = await owner.put(`/api/quotes/${quoteId}`, { lockVersion: detail.lockVersion, content: quoteBody(customerId) });
    expect(edit.statusCode).toBe(409);
    expect((await owner.del(`/api/quotes/${quoteId}`)).statusCode).toBe(409);
    const dup = await owner.post(`/api/quotes/${quoteId}/duplicate`);
    expect(dup.statusCode).toBe(201);
    const copy = (await owner.get(`/api/quotes/${dup.json().id}`)).json();
    expect(copy.status).toBe('DRAFT');
    expect(copy.title).toContain('(cópia)');
    expect(copy.validUntil).toBe(addDaysISO(todayISO(), 10));
    expect(copy.totalCents).toBe(detail.totalCents);
  });

  it('histórico registra criação, revisões, envio e aprovação', async () => {
    const detail = (await owner.get(`/api/quotes/${quoteId}`)).json();
    const actions = detail.history.map((h: { action: string }) => h.action);
    expect(actions).toEqual(
      expect.arrayContaining(['quote.created', 'quote.updated', 'quote.sent', 'quote.revision_started', 'quote.approved']),
    );
  });
});

describe('regras de status', () => {
  it('não emite orçamento sem serviço ou com validade vencida', async () => {
    const empty = (await owner.post('/api/quotes', quoteBody(customerId, { items: [], materials: [] }))).json();
    expect((await owner.post(`/api/quotes/${empty.id}/send`)).statusCode).toBe(400);
    const old = (await owner.post('/api/quotes', quoteBody(customerId, { validUntil: addDaysISO(todayISO(), -1) }))).json();
    const res = await owner.post(`/api/quotes/${old.id}/send`);
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.validUntil).toBeTruthy();
  });

  it('enviado e vencido aparece como Vencido e não aceita aprovação após a validade', async () => {
    const q = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    await owner.post(`/api/quotes/${q.id}/send`);
    await env.db.quote.update({ where: { id: q.id }, data: { validUntil: new Date(`${addDaysISO(todayISO(), -2)}T00:00:00Z`) } });
    const detail = (await owner.get(`/api/quotes/${q.id}`)).json();
    expect(detail.displayStatus).toBe('EXPIRED');
    const expired = (await owner.get('/api/quotes?status=EXPIRED')).json();
    expect(expired.data.some((x: { id: string }) => x.id === q.id)).toBe(true);
    const late = await owner.post(`/api/quotes/${q.id}/approve`, { approvedByName: 'João', channel: 'PHONE', approvedOn: todayISO() });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('EXPIRED');
    // aprovação registrada com data dentro da validade é aceita
    const inTime = await owner.post(`/api/quotes/${q.id}/approve`, {
      approvedByName: 'João',
      channel: 'PHONE',
      approvedOn: addDaysISO(todayISO(), -3),
    });
    expect(inTime.statusCode).toBe(200);
  });

  it('recusa: só de enviado, guarda motivo; rascunho nunca emitido pode ser excluído', async () => {
    const q = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    expect((await owner.post(`/api/quotes/${q.id}/refuse`, { reason: 'Achou caro' })).statusCode).toBe(409);
    await owner.post(`/api/quotes/${q.id}/send`);
    const refused = await owner.post(`/api/quotes/${q.id}/refuse`, { reason: 'Achou caro' });
    expect(refused.json().status).toBe('REFUSED');
    expect(refused.json().refusedReason).toBe('Achou caro');
    expect((await owner.del(`/api/quotes/${q.id}`)).statusCode).toBe(409);

    const draft = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    expect((await owner.del(`/api/quotes/${draft.id}`)).statusCode).toBe(200);
    expect((await owner.get(`/api/quotes/${draft.id}`)).statusCode).toBe(404);
  });

  it('aprovar direto do rascunho emite a versão automaticamente', async () => {
    const q = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    const res = await owner.post(`/api/quotes/${q.id}/approve`, { approvedByName: 'João', channel: 'IN_PERSON', approvedOn: todayISO() });
    expect(res.statusCode).toBe(200);
    expect(res.json().versions).toHaveLength(1);
  });
});

describe('idempotência na criação', () => {
  it('mesma Idempotency-Key não cria orçamento duplicado', async () => {
    const before = await env.db.quote.count({ where: { tenantId } });
    const key = 'criar-orcamento-abc-123';
    const r1 = await owner.post('/api/quotes', quoteBody(customerId), { 'idempotency-key': key });
    const r2 = await owner.post('/api/quotes', quoteBody(customerId), { 'idempotency-key': key });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.json().id).toBe(r1.json().id);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(await env.db.quote.count({ where: { tenantId } })).toBe(before + 1);
  });

  it('falha de validação não consome a chave', async () => {
    const key = 'criar-orcamento-falha-1';
    const bad = await owner.post('/api/quotes', quoteBody('00000000-0000-4000-8000-000000000000'), { 'idempotency-key': key });
    expect(bad.statusCode).toBe(400);
    const ok = await owner.post('/api/quotes', quoteBody(customerId), { 'idempotency-key': key });
    expect(ok.statusCode).toBe(201);
  });
});

describe('permissões por perfil', () => {
  it('colaborador de campo não acessa orçamentos nem altera clientes', async () => {
    const field = await addMember(env, tenantId, 'FIELD');
    expect((await field.get('/api/quotes')).statusCode).toBe(403);
    expect((await field.post('/api/customers', { name: 'X' })).statusCode).toBe(403);
    expect((await field.get('/api/customers')).statusCode).toBe(200);
  });

  it('orçamentista não altera dados da empresa nem registra aprovação', async () => {
    const estimator = await addMember(env, tenantId, 'ESTIMATOR');
    expect((await estimator.put('/api/company', { tradeName: 'Outro nome' })).statusCode).toBe(403);
    const q = (await estimator.post('/api/quotes', quoteBody(customerId))).json();
    expect((await estimator.post(`/api/quotes/${q.id}/send`)).statusCode).toBe(200);
    const approve = await estimator.post(`/api/quotes/${q.id}/approve`, { approvedByName: 'Xavier Lima', channel: 'OTHER', approvedOn: todayISO() });
    expect(approve.statusCode).toBe(403);
  });

  it('financeiro registra aprovação mas não edita orçamento', async () => {
    const finance = await addMember(env, tenantId, 'FINANCE');
    const q = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    expect((await finance.put(`/api/quotes/${q.id}`, { lockVersion: 0, content: quoteBody(customerId) })).statusCode).toBe(403);
    await owner.post(`/api/quotes/${q.id}/send`);
    const ok = await finance.post(`/api/quotes/${q.id}/approve`, { approvedByName: 'Yara Souza', channel: 'EMAIL', approvedOn: todayISO() });
    expect(ok.statusCode).toBe(200);
  });
});

describe('logomarca', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  it('aceita PNG verdadeiro e usa no PDF', async () => {
    const res = await owner.put('/api/company/logo', png, { 'content-type': 'image/png' });
    expect(res.statusCode).toBe(200);
    expect((await owner.get('/api/company')).json().hasLogo).toBe(true);
    const logo = await owner.get('/api/company/logo');
    expect(logo.headers['content-type']).toBe('image/png');
    const q = (await owner.post('/api/quotes', quoteBody(customerId))).json();
    expect((await owner.get(`/api/quotes/${q.id}/pdf`)).statusCode).toBe(200);
  });

  it('recusa arquivo disfarçado de imagem', async () => {
    const fake = Buffer.from('<script>alert(1)</script>');
    const res = await owner.put('/api/company/logo', fake, { 'content-type': 'image/png' });
    expect(res.statusCode).toBe(400);
  });
});

describe('dashboard', () => {
  it('resume orçamentos aguardando, aprovados no mês e rascunhos', async () => {
    const d = (await owner.get('/api/dashboard')).json();
    expect(d.approvedThisMonth.count).toBeGreaterThanOrEqual(2);
    expect(d.drafts).toBeGreaterThan(0);
    expect(d.recentQuotes.length).toBeLessThanOrEqual(5);
  });
});
