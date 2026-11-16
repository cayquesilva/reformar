import { expect, test } from '@playwright/test';

test('Fase 5: gasto registrado sem internet fica na fila e é enviado uma única vez ao reconectar', async ({ page, context }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Ana Offline');
  await page.getByLabel('Nome da empresa').fill('Ana Obras');
  await page.getByLabel('E-mail').fill(`offline-${Date.now()}@teste.com.br`);
  await page.getByLabel('Crie uma senha').fill('senha-forte-123');
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();

  await page.getByRole('link', { name: 'Registrar gasto' }).click();
  await expect(page.getByRole('heading', { name: 'Registrar gasto' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/Sem internet\./)).toBeVisible();

  await page.getByRole('button', { name: 'Combustível' }).click();
  await page.getByLabel('Valor total').fill('120');
  await page.getByRole('button', { name: 'Salvar gasto' }).click();
  await expect(page.getByText(/gasto guardado no aparelho/)).toBeVisible();
  await expect(page.getByText('1 lançamento(s) aguardando envio.')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('1 lançamento(s) aguardando envio.')).toHaveCount(0, { timeout: 15_000 });
  // dispara o envio de novo (como num segundo "online") — a chave de idempotência impede duplicata
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  const h = { 'x-reformar-client': 'web' };
  const expenses = await (await page.request.get('/api/expenses', { headers: h })).json();
  expect(expenses).toHaveLength(1);
  expect(expenses[0]).toMatchObject({ category: 'TRANSPORT', amountCents: 12000 });
});
