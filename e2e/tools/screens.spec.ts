/**
 * Ferramenta de revisão visual (não é teste de regressão): cria dados de exemplo e
 * fotografa as telas principais em desktop e celular.
 * Uso: SCREENS_DIR=caminho npx playwright test -c e2e/playwright.config.ts --project=telas
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { seed } from './seed';

const OUT = process.env.SCREENS_DIR ?? 'e2e/test-results/telas';
for (const base of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'celular', width: 390, height: 844 },
  { name: 'tablet', width: 900, height: 1100 },
]) {
  // Tema claro em todos os tamanhos; escuro no desktop e no celular.
  for (const tema of base.name === 'tablet' ? ['claro'] : ['claro', 'escuro']) {
    const vp = { ...base, name: tema === 'escuro' ? `${base.name}-escuro` : base.name };
    test(`telas ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'pt-BR', deviceScaleFactor: 1 });
      await context.addInitScript((t) => localStorage.setItem('reformar:tema', t), tema === 'escuro' ? 'dark' : 'light');
      const page = await context.newPage();
      const ids = await seed(page);
      const violations: string[] = [];
      const shots: [string, string][] = [
        ['inicio', '/'],
        ['orcamentos', '/orcamentos'],
        ['orcamento', `/orcamentos/${ids.quoteId}`],
        ['novo-orcamento', '/orcamentos/novo'],
        ['obra', `/obras/${ids.projectId}`],
        ['financeiro', '/financeiro'],
        ['estoque', '/estoque'],
        ['clientes', '/clientes'],
        ['mais', '/mais'],
        ['empresa', '/empresa'],
        ['conta', '/conta'],
      ];
      for (const [name, url] of shots) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        await page.waitForFunction(() =>
          document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
        );
        await page.screenshot({ path: `${OUT}/${vp.name}-${name}.png` });
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        violations.push(...axe.violations.map((v) => `${vp.name}/${name}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`));
      }
      await page.goto('/orcamentos');
      await page.getByRole('button', { name: 'Quadro' }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${vp.name}-quadro.png` });
      const axeBoard = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      violations.push(
        ...axeBoard.violations.map((v) => `${vp.name}/quadro: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      );
      await page.getByRole('button', { name: 'Lista' }).click();
      if (base.name === 'desktop') {
        await page.goto('/');
        await page.getByRole('button', { name: 'Recolher menu' }).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${vp.name}-menu-recolhido.png` });
        await page.getByRole('button', { name: 'Expandir menu' }).click();
      }
      // Paleta de comandos: atalho, busca real e navegação pelo teclado.
      await page.goto('/');
      // O atalho só existe depois que o layout montou: espera o título da tela inicial.
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await page.keyboard.press('Control+K');
      const combo = page.getByRole('combobox', { name: /Buscar telas/ });
      await expect(combo).toBeFocused();
      await combo.fill('jo');
      // A busca vai à API; com os outros testes rodando em paralelo ela pode passar de 5 s.
      await expect(page.getByRole('option', { name: /João da Silva/ }).first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${vp.name}-busca.png` });
      const axeCmd = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      violations.push(...axeCmd.violations.map((v) => `${vp.name}/busca: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`));
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/clientes\//);
      // Menu da conta aberto
      await page
        .getByRole('button', { name: /Minha conta/ })
        .first()
        .click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${vp.name}-menu-conta.png` });
      const axeMenu = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      violations.push(
        ...axeMenu.violations.map((v) => `${vp.name}/menu-conta: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      );
      await page.keyboard.press('Escape');
      expect(violations).toEqual([]);
      await context.close();
    });
  }
}

/**
 * Auditoria de responsividade: em cada largura, nenhuma tela pode rolar na horizontal
 * nem ter elemento saindo da tela (exceto dentro de áreas com rolagem própria, como tabelas e o quadro).
 */
async function offenders(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw) out.push(`scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    const scrolls = (el: Element | null): boolean => {
      for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      }
      return false;
    };
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      // Ignora o que fica fora da tela de propósito (ex.: link de pular para o conteúdo).
      if (r.width === 0 || r.height === 0 || r.right <= 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !scrolls(el)) {
        const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '';
        out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      if (out.length > 8) break;
    }
    return out;
  });
}

test('responsivo em todas as larguras', async ({ browser }) => {
  test.setTimeout(600_000);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const problems: string[] = [];
  const check = async (label: string) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
    const o = await offenders(page);
    if (o.length) problems.push(`${label}: ${o.join(' ; ')}`);
  };
  const widths = [320, 390, 768, 1024, 1440, 1920];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const url of ['/entrar', '/criar-conta', '/esqueci-senha']) {
      await page.goto(url);
      await check(`${w}${url}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  const urls = [
    '/',
    '/orcamentos',
    `/orcamentos/${ids.quoteId}`,
    `/orcamentos/${ids.quoteId}/editar`,
    '/orcamentos/novo',
    '/clientes',
    '/clientes/novo',
    '/obras',
    `/obras/${ids.projectId}`,
    `/obras/${ids.projectId}/medicoes/nova`,
    '/financeiro',
    '/financeiro/gasto/novo',
    '/estoque',
    '/empresa',
    '/empresa/servicos',
    '/assistente',
    '/assinatura',
    '/conta',
    '/mais',
    '/nao-existe',
  ];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const url of urls) {
      await page.goto(url);
      await check(`${w}${url}`);
    }
    await page.goto('/orcamentos');
    await page.getByRole('button', { name: 'Quadro' }).click();
    await check(`${w}/orcamentos (quadro)`);
    await page.getByRole('button', { name: 'Lista' }).click();
  }
  expect(problems).toEqual([]);
  await context.close();
});
