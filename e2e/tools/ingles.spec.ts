/**
 * Revisão visual da interface em inglês e do painel de meios de pagamento:
 * troca de idioma pelo menu da conta, telas principais em inglês (desktop e celular), página pública em inglês,
 * painel da plataforma (Asaas/PayPal) e uma busca por textos que ficaram em português.
 * Uso: npm run telas  (SCREENS=1, projeto "telas")
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { seed } from './seed';

const OUT = process.env.SCREENS_DIR ?? 'e2e/test-results/telas';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Dados de exemplo (digitados pelo usuário) que podem ter acento sem ser texto da interface. */
const DATA = ['João da Silva', 'João', 'Diárias ajudante', 'Almoço da equipe', 'Diretora', 'Argamassa AC-III 20 kg'];
/** Palavras da interface em português que não podem sobrar na versão em inglês. */
const PT_WORDS =
  /\b(Orçamentos?|Início|Salvar|Cancelar|Voltar|Carregando|Nenhuma?|Obras?|Clientes?|Financeiro|Estoque|Medições?|Configurações|Assinatura|Empresa|Aguardando|Rascunhos?|Enviar|Excluir|Editar|Previsão|Recebido|Valor|Situação|Plano|Usuários)\b/;

async function leftovers(page: Page) {
  const text = await page.locator('main, .lp').first().innerText();
  let clean = text;
  for (const d of DATA) clean = clean.split(d).join(' ');
  return clean
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && (PT_WORDS.test(l) || /[ãõçÃÕÇ]|ção\b/.test(l)));
}

const PAGES: [string, string][] = [
  ['inicio', '/'],
  ['orcamentos', '/orcamentos'],
  ['novo-orcamento', '/orcamentos/novo'],
  ['obras', '/obras'],
  ['financeiro', '/financeiro'],
  ['estoque', '/estoque'],
  ['clientes', '/clientes'],
  ['empresa', '/empresa'],
  ['conta', '/conta'],
  ['mais', '/mais'],
];

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'celular', width: 390, height: 844 },
]) {
  test(`interface em inglês ${vp.name}`, async ({ browser }) => {
    test.setTimeout(480_000);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'pt-BR', deviceScaleFactor: 1 });
    const page = await context.newPage();
    const ids = await seed(page);

    // Troca pelo menu da conta (opção de escolha única, como o tema).
    await page.goto('/');
    await page.getByRole('button', { name: /Minha conta/ }).first().click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hi, Carlos!' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const violations: string[] = [];
    const found: string[] = [];
    for (const [name, url] of [...PAGES, ['orcamento', `/orcamentos/${ids.quoteId}`], ['obra', `/obras/${ids.projectId}`]] as [string, string][]) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/en-${vp.name}-${name}.png`, fullPage: vp.name === 'desktop' });
      const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      violations.push(...axe.violations.map((v) => `${name}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`));
      found.push(...(await leftovers(page)).map((l) => `${name}: ${l}`));
    }
    // A escolha fica salva e a API responde erros em inglês.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const err = await page.evaluate(async () => {
      const r = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'X-Reformar-Client': 'web', 'Content-Type': 'application/json', 'Accept-Language': 'en' },
        body: JSON.stringify({}),
      });
      return (await r.json()).message as string;
    });
    expect(err).toBe('Check the highlighted fields.');

    // Volta para português pela busca rápida.
    await page.goto('/');
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    // Botão de busca (no celular é o ícone da lupa; no desktop, o campo do topo).
    await page.locator('button.search-trigger:visible, .mobile-top-actions button.top-icon:visible').first().click();
    await page.getByRole('combobox', { name: /Search screens/ }).fill('Português');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Olá, Carlos!' })).toBeVisible();

    test.info().annotations.push({ type: 'sobras em português', description: found.join('\n') || 'nenhuma' });
    expect(found).toEqual([]);
    expect(violations).toEqual([]);
    await context.close();
  });
}

test('página pública em inglês', async ({ browser }) => {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'celular', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'pt-BR', deviceScaleFactor: 1 });
    await context.addInitScript(() => localStorage.setItem('reformar:vista-casa', '2d'));
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('.lp.is-ready').waitFor();
    // Troca pelo seletor PT | EN (no celular ele fica no rodapé).
    await page.getByRole('button', { name: /^EN/ }).last().click();
    await expect(page.getByRole('heading', { level: 1, name: 'From quote to keys, without losing count.' })).toBeVisible();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/en-landing-${vp.name}-topo.png` });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/en-landing-${vp.name}-fim.png` });
    expect(await leftovers(page)).toEqual([]);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    // Telas de entrada também em inglês, com o seletor.
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/en-entrar-${vp.name}.png` });
    await context.close();
  }
});

for (const lang of ['pt', 'en'] as const) {
  test(`painel da plataforma: meios de pagamento (${lang})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', deviceScaleFactor: 1 });
    const page = await context.newPage();
    const { email } = await seed(page);
    if (lang === 'en') await page.evaluate(() => localStorage.setItem('reformar:idioma', 'en'));
    // Concede acesso de administração da plataforma pelo script oficial (o mesmo do manual).
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'platform:admin', '-w', '@reformar/api', '--', email], {
      cwd: existsSync('apps/api') ? '.' : '..',
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    await page.goto('/plataforma');
    const panel = page.locator('section', { has: page.getByRole('heading', { name: lang === 'en' ? 'Payment methods' : 'Meios de pagamento' }) });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'PayPal' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Asaas' })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/plataforma-meios-${lang}.png`, fullPage: true });
    // Ligar o PayPal sem credenciais mostra o que falta (nada é salvo).
    const paypal = panel.locator('article', { has: page.getByRole('heading', { name: 'PayPal' }) });
    await paypal.getByLabel(lang === 'en' ? 'Offer for new subscriptions' : 'Oferecer para novas assinaturas').check();
    await paypal.getByRole('button', { name: lang === 'en' ? 'Save' : 'Salvar' }).click();
    await expect(paypal.getByText(lang === 'en' ? 'Enter the client ID.' : 'Informe o client ID.')).toBeVisible();
    await paypal.screenshot({ path: `${OUT}/plataforma-paypal-erros-${lang}.png` });
    const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    await context.close();
  });
}
