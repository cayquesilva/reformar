/** Cria uma conta com dados de exemplo (clientes, orçamentos, obra com medição, gastos e estoque). */
import type { Page } from '@playwright/test';

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export async function seed(page: Page) {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Carlos Mestre');
  await page.getByLabel('Nome da empresa').fill('Carlos Reformas');
  const email = `telas-${Date.now()}@teste.com.br`;
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Crie uma senha').fill('senha-forte-123');
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.waitForURL('**/?bemvindo=1');
  const h = { 'x-reformar-client': 'web', 'content-type': 'application/json' };
  const post = async (url: string, data: unknown) => (await page.request.post(url, { headers: h, data })).json();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const valid = new Date(Date.now() + 15 * 86400_000).toISOString().slice(0, 10);
  const joao = await post('/api/customers', { name: 'João da Silva', phone: '11987654321', city: 'Campinas', state: 'SP' });
  const escola = await post('/api/customers', { name: 'Escola Municipal Centro', phone: '1133334444' });
  await post('/api/customers', { name: 'Maria Souza', phone: '11999990000' });
  const body = (customerId: string, title: string, qty: string, price: number) => ({
    customerId,
    title,
    validUntil: valid,
    items: [{ description: 'Assentamento de porcelanato', unit: 'M2', quantity: qty, unitPriceCents: price }],
    materials: [
      {
        description: 'Porcelanato 60x60',
        unit: 'm²',
        supply: 'CLIENT',
        itemIndex: 0,
        coefficient: '1',
        lossPercent: '10',
        packageSize: '2.5',
        packageLabel: 'caixa',
      },
    ],
    costs: [{ category: 'TEAM', description: 'Ajudante', quantity: '6', unit: 'diária', unitCostCents: 12000, chargeToClient: false }],
  });
  const q1 = await post('/api/quotes', body(joao.id, 'Porcelanato da sala', '32', 5500));
  await post(`/api/quotes/${q1.id}/send`, {});
  const q2 = await post('/api/quotes', body(escola.id, 'Piso das salas de aula', '120', 4500));
  await post(`/api/quotes/${q2.id}/approve`, { approvedByName: 'Diretora', channel: 'IN_PERSON', approvedOn: today });
  await post('/api/quotes', body(joao.id, 'Rodapé e pintura', '20', 3000));
  const project = await post('/api/projects/from-quote', { quoteId: q2.id, confirm: true, expectedEndDate: valid });
  const detail = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const m = await post(`/api/projects/${project.id}/measurements`, {
    measuredOn: today,
    notes: 'Salas 1 e 2 prontas',
    items: [{ stageId: detail.stages[0].id, quantity: '48' }],
  });
  await page.request.post(`/api/projects/${project.id}/photos?measurementId=${m.id}&caption=Sala%201`, {
    headers: { 'x-reformar-client': 'web', 'content-type': 'image/png' },
    data: PNG,
  });
  await post(`/api/projects/${project.id}/measurements/${m.id}/confirm`, { receivable: { amountCents: 216000, dueDate: valid } });
  await post(`/api/projects/${project.id}/payment-plan`, {
    downPaymentCents: 100000,
    downPaymentDate: today,
    installments: 2,
    firstInstallmentDate: valid,
    confirm: true,
  });
  await post('/api/expenses', {
    projectId: project.id,
    category: 'FOOD',
    description: 'Almoço da equipe',
    quantity: '3',
    amountCents: 7500,
    date: today,
    status: 'PAID',
    paidOn: today,
    paymentMethod: 'PIX',
  });
  await post('/api/expenses', {
    projectId: project.id,
    category: 'TEAM',
    description: 'Diárias ajudante',
    amountCents: 72000,
    date: today,
    dueDate: valid,
    status: 'COMMITTED',
  });
  const mat = await post('/api/materials', { name: 'Argamassa AC-III 20 kg', unit: 'saco', minStock: '5' });
  await post('/api/stock/purchases', {
    materialId: mat.id,
    quantity: '10',
    toLocationId: detail.stockLocationId,
    amountCents: 45900,
    date: today,
    status: 'PAID',
    paidOn: today,
    paymentMethod: 'PIX',
  });
  return { quoteId: q1.id, projectId: project.id, email };
}
