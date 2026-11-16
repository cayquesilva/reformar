import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function expectAccessible(page: Page, where: string) {
  // Mede o estado final: espera as animações de entrada terminarem (ignora as infinitas, como o esqueleto).
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), where).toEqual([]);
}

test('Jornadas C e D: obra, medição com foto, cobrança, recebimento parcial e gasto (celular)', async ({ page }) => {
  const email = `obra-${Date.now()}@teste.com.br`;
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Carlos Mestre');
  await page.getByLabel('Nome da empresa').fill('Carlos Obras');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Crie uma senha').fill('senha-forte-123');
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Carlos!' })).toBeVisible();

  // Preparação rápida via API (mesma sessão): cliente + orçamento aprovado.
  const h = { 'x-reformar-client': 'web', 'content-type': 'application/json' };
  const customer = await (await page.request.post('/api/customers', { headers: h, data: { name: 'Escola Municipal', phone: '11987654321' } })).json();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const valid = new Date(Date.now() + 15 * 86400_000).toISOString().slice(0, 10);
  const quote = await (
    await page.request.post('/api/quotes', {
      headers: h,
      data: {
        customerId: customer.id,
        title: 'Piso da escola',
        validUntil: valid,
        items: [{ description: 'Assentamento de cerâmica', unit: 'M2', quantity: '100', unitPriceCents: 4000 }],
        materials: [],
        costs: [],
      },
    })
  ).json();
  await page.request.post(`/api/quotes/${quote.id}/approve`, { headers: h, data: { approvedByName: 'Diretora', channel: 'IN_PERSON', approvedOn: today } });

  // ---------- Orçamento aprovado -> obra ----------
  await page.goto(`/orcamentos/${quote.id}`);
  await page.getByRole('link', { name: 'Transformar em obra' }).click();
  await expect(page.getByRole('heading', { name: 'Transformar em obra' })).toBeVisible();
  await page.getByRole('button', { name: 'Criar obra' }).click();
  await expect(page.getByRole('heading', { name: /Obra 0001 · Piso da escola/ })).toBeVisible();
  await expect(page.getByText('R$ 4.000,00 do contrato ainda sem cobrança lançada.')).toBeVisible();
  await expectAccessible(page, 'detalhe da obra');

  // ---------- Medição com foto ----------
  await page.getByRole('link', { name: 'Nova medição' }).first().click();
  await page.getByLabel(/Executado agora/).fill('40');
  await expect(page.getByText('Valor estimado desta medição: R$ 1.600,00')).toBeVisible();
  await expectAccessible(page, 'nova medição');
  await page.getByRole('button', { name: 'Salvar e adicionar fotos' }).click();
  await expect(page.getByRole('heading', { name: 'Medição nº 1' })).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'sala.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Foto enviada.')).toBeVisible();
  await expect(page.locator('.photo-grid img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Confirmar medição' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Valor a cobrar')).toHaveValue('1600,00');
  await dialog.getByRole('button', { name: 'Sim, confirmar' }).click();
  await expect(page.getByText(/Confirmada por Carlos Mestre/)).toBeVisible();

  // ---------- Andamento e cobranças ----------
  await page.getByRole('link', { name: /Obra 0001/ }).click();
  await expect(page.getByRole('progressbar', { name: /Andamento físico/ })).toHaveAttribute('aria-valuenow', '40');
  await page.getByRole('tab', { name: 'Financeiro' }).click();
  await page.getByRole('button', { name: /Lançar entrada e parcelas/ }).click();
  await page.getByLabel('Número de parcelas').fill('2');
  await expect(page.getByLabel('Prévia das parcelas').getByText('R$ 1.200,00')).toHaveCount(2);
  await page.getByRole('button', { name: 'Criar parcelas' }).click();
  await expect(page.getByText('Parcelas criadas.')).toBeVisible();

  // Recebimento parcial da medição
  await page.getByRole('button', { name: 'Receber' }).first().click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Valor recebido').fill('1000');
  await pay.getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByText(/Ainda falta R\$ 600,00/)).toBeVisible();
  await expect(page.getByText('Pago em parte')).toBeVisible();
  await expectAccessible(page, 'financeiro da obra');

  // ---------- Gasto ----------
  await page.getByRole('link', { name: 'Registrar gasto' }).click();
  await page.getByRole('button', { name: 'Almoço / alimentação' }).click();
  await page.getByLabel('Quantidade').fill('3');
  await page.getByLabel('Valor total').fill('75');
  await expectAccessible(page, 'registrar gasto');
  await page.getByRole('button', { name: 'Salvar gasto' }).click();
  await expect(page.getByText('Gasto registrado.')).toBeVisible();
  await page.getByRole('tab', { name: 'Resumo' }).click();
  await expect(page.locator('.totals').getByText('Custo lançado até agora')).toBeVisible();
  await expect(page.locator('dd', { hasText: 'R$ 75,00' }).first()).toBeVisible();

  // ---------- Financeiro geral ----------
  await page.getByRole('navigation', { name: 'Menu principal (celular)' }).getByRole('link', { name: 'Financeiro' }).click();
  await expect(page.getByRole('heading', { name: 'Fluxo de caixa' })).toBeVisible();
  await expectAccessible(page, 'financeiro');
});
