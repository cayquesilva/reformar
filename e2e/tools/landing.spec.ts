/**
 * Revisão visual da página inicial pública (não é teste de regressão):
 * fotografa a casa (vista em desenho) em várias posições de scroll, em vários tamanhos de tela e com movimento reduzido,
 * e confere acessibilidade (axe) e ausência de rolagem horizontal.
 * Uso: npm run telas  (SCREENS=1, projeto "telas")
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const OUT = process.env.SCREENS_DIR ?? 'e2e/test-results/telas';
const STOPS = [0, 0.12, 0.28, 0.45, 0.62, 0.8, 1];

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'notebook', width: 1280, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'celular', width: 390, height: 844 },
  { name: 'pequeno', width: 320, height: 640 },
  { name: 'deitado', width: 844, height: 390 },
  { name: 'reduzido', width: 390, height: 844, reduced: true },
]) {
  test(`landing ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: 'pt-BR',
      deviceScaleFactor: 1,
      reducedMotion: vp.reduced ? 'reduce' : 'no-preference',
    });
    // Esta revisão é da vista em desenho (2D); a 3D tem a sua em landing3d.spec.ts.
    await context.addInitScript(() => localStorage.setItem('reformar:vista-casa', '2d'));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.lp')).toHaveAttribute('data-show', '2d');
    await expect(page.getByRole('heading', { level: 1, name: /Do orçamento às chaves/ })).toBeVisible();
    await page.locator('.lp.is-ready').waitFor();
    await page.waitForTimeout(2200); // terreno se desenha sozinho

    const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (const [i, f] of STOPS.entries()) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(total * f));
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/landing-${vp.name}-${i}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, `rolagem horizontal em ${f}`).toBeLessThanOrEqual(0);
    }
    // No fim a obra está completa.
    await expect(page.locator('.lp-readout-pct [data-pct]')).toHaveText('100%');

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

    // A trena leva às etapas.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.getByRole('button', { name: 'Laje' }).click();
    await page.waitForTimeout(1400);
    await expect(page.getByRole('button', { name: 'Laje' })).toHaveAttribute('aria-current', 'step');

    // Entrar no sistema remove o motor e a folha dele.
    await page.getByRole('link', { name: 'Já tenho conta' }).first().click();
    await page.waitForURL('**/entrar');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await expect(page.locator('link[data-scrollcraft]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/lp-on/);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/landing-${vp.name}-entrar.png` });
    const axeLogin = await new AxeBuilder({ page }).analyze();
    expect(axeLogin.violations.map((v) => v.id)).toEqual([]);

    expect(errors).toEqual([]);
    await context.close();
  });
}
