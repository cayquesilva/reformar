import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type Page } from '@playwright/test';

/** Verificação automática de acessibilidade (regras WCAG 2.x A/AA detectáveis por ferramenta). */
async function expectAccessible(page: Page, where: string) {
  // Mede o estado final: espera os dados chegarem (cartões que só aparecem depois, como "A receber") e as
  // animações de entrada terminarem (ignora as infinitas, como o esqueleto).
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `Violações de acessibilidade em ${where}`).toEqual([]);
}

test('Jornada A: criar conta, orçar 32 m² de porcelanato, emitir PDF, compartilhar e aprovar (celular)', async ({ page, baseURL }) => {
  const email = `e2e-${Date.now()}@teste.com.br`;

  // ---------- Cadastro ----------
  await page.goto('/criar-conta');
  await expectAccessible(page, 'criar conta');
  await page.getByLabel('Seu nome').fill('Maria Pedreira');
  await page.getByLabel('Nome da empresa').fill('Maria Reformas');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Crie uma senha').fill('senha-forte-123');
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Maria!' })).toBeVisible();
  await expectAccessible(page, 'início');

  // ---------- Passo 1: cliente e obra ----------
  await page.getByRole('link', { name: 'Novo orçamento' }).first().click();
  await expect(page.getByRole('heading', { name: /Passo 1 de 6/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cadastrar novo cliente' }).click();
  await page.getByLabel('Nome do cliente').fill('João da Silva');
  await page.getByLabel(/Telefone \/ WhatsApp/).fill('(11) 98765-4321');
  await page.getByRole('button', { name: 'Cadastrar e usar' }).click();
  await expect(page.getByText('Cliente: João da Silva')).toBeVisible();
  await page.getByLabel('Nome do orçamento').fill('Porcelanato da sala');
  await expectAccessible(page, 'passo 1');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // ---------- Passo 2: serviços ----------
  await expect(page.getByRole('heading', { name: /Passo 2 de 6/ })).toBeVisible();
  // tentar avançar sem serviço mostra erro amigável
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Adicione pelo menos um serviço.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Assentamento de porcelanato' }).click();
  await page.getByLabel('Quantidade (m²)').fill('32');
  await page.getByLabel('Preço por m²').fill('55');
  await expect(page.getByText('32 m² × R$ 55,00 = R$ 1.760,00')).toBeVisible();
  await expectAccessible(page, 'passo 2');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // ---------- Passo 3: materiais ----------
  await expect(page.getByRole('heading', { name: /Passo 3 de 6/ })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar material' }).click();
  await page.getByLabel('Material', { exact: true }).fill('Porcelanato 60x60');
  await page.getByLabel(/Perda \/ quebra/).fill('10');
  await page.getByLabel(/Vende em/).fill('caixa');
  await page.getByLabel(/Quanto vem em cada/).fill('2,5');
  await expect(page.getByText('Comprar: 15 caixa(s) = 37,5 m²')).toBeVisible();
  await expectAccessible(page, 'passo 3');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // ---------- Passo 4: custos ----------
  await expect(page.getByRole('heading', { name: /Passo 4 de 6/ })).toBeVisible();
  await page.getByRole('button', { name: 'Ajudante / servente' }).click();
  await page.getByLabel('Quantidade', { exact: true }).fill('6');
  await page.getByLabel('Valor de cada').fill('120');
  await expect(page.getByText('6 diária × R$ 120,00 = R$ 720,00')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // ---------- Passo 5: condições ----------
  await expect(page.getByRole('heading', { name: /Passo 5 de 6/ })).toBeVisible();
  await page.getByRole('button', { name: '50% de entrada e 50% na entrega.' }).click();
  await expectAccessible(page, 'passo 5');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // ---------- Passo 6: conferir ----------
  await expect(page.getByRole('heading', { name: /Passo 6 de 6/ })).toBeVisible();
  const review = page.locator('.card');
  await expect(review.getByText('R$ 1.760,00').first()).toBeVisible();
  await expect(review.getByText('Lucro estimado (59,09%)')).toBeVisible();
  await expect(review.locator('dd', { hasText: 'R$ 1.040,00' })).toBeVisible(); // 1.760 − 720
  await expectAccessible(page, 'passo 6');
  await page.getByRole('button', { name: 'Salvar orçamento' }).click();

  // ---------- Detalhe ----------
  await expect(page.getByRole('heading', { name: 'Orçamento nº 0001' })).toBeVisible();
  await expect(page.getByText('Rascunho', { exact: true })).toBeVisible();
  const quoteId = page.url().split('/').pop()!;
  const draftPdf = await page.request.get(`/api/quotes/${quoteId}/pdf`);
  expect(draftPdf.status()).toBe(200);
  expect(draftPdf.headers()['content-type']).toBe('application/pdf');
  await expectAccessible(page, 'detalhe do orçamento');

  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sim, emitir' }).click();
  await expect(page.getByText('Enviado', { exact: true })).toBeVisible();

  // ---------- Compartilhar ----------
  await page.getByRole('button', { name: 'Enviar ao cliente' }).click();
  const whatsapp = page.getByRole('link', { name: 'Enviar pelo WhatsApp' });
  await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/5511987654321\?text=/);
  const shareUrl = await page.getByLabel('Link do orçamento').inputValue();
  const anonymous = await request.newContext({ baseURL });
  const publicPdf = await anonymous.get(new URL(shareUrl).pathname);
  expect(publicPdf.status()).toBe(200);
  expect(publicPdf.headers()['content-type']).toBe('application/pdf');
  await anonymous.dispose();

  // ---------- Aprovação ----------
  await page.getByRole('button', { name: 'Cliente aprovou' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Quem aprovou')).toHaveValue('João da Silva');
  await dialog.getByLabel(/Observação/).fill('Aceitou pelo WhatsApp');
  await dialog.getByRole('button', { name: 'Confirmar aprovação' }).click();
  await expect(page.getByText('Aprovado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Aprovado por/)).toContainText('João da Silva');
  await expect(page.getByRole('link', { name: 'Editar' })).toHaveCount(0);
});

test('acesso sem login redireciona para entrar', async ({ page }) => {
  await page.goto('/orcamentos');
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});
