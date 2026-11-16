/**
 * Revisão visual da vista 3D da página pública e do seletor 2D/3D: cena em várias posições de scroll,
 * troca de vista no meio da obra, escolha lembrada e o link antigo /apresentacao-3d.
 * Uso: npm run telas  (SCREENS=1, projeto "telas")
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const OUT = process.env.SCREENS_DIR ?? 'e2e/test-results/telas';
const STOPS = [0, 0.14, 0.3, 0.46, 0.62, 0.8, 1];

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'celular', width: 390, height: 844 },
  { name: 'pequeno', width: 320, height: 640 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'reduzido', width: 1280, height: 800, reduced: true },
]) {
  test(`landing 3d ${vp.name}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: 'pt-BR',
      deviceScaleFactor: 1,
      reducedMotion: vp.reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const lp = page.locator('.lp');
    const r2d = page.getByRole('radio', { name: /2D/ });
    const r3d = page.getByRole('radio', { name: /3D/ });

    // Primeira visita: abre na maquete 3D.
    await page.goto('/');
    await expect(r3d).toBeChecked();
    await expect(lp).toHaveAttribute('data-show', '3d', { timeout: 30_000 });
    await page.waitForTimeout(2500);
    const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (const [i, f] of STOPS.entries()) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(total * f));
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}/landing3d-${vp.name}-${i}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    }
    await expect(page.locator('.lp-readout-pct [data-pct]')).toHaveText('100%');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

    // Troca no meio da obra: o desenho aparece na mesma etapa, e a maquete volta.
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(total * 0.46));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/landing3d-${vp.name}-seletor.png`, clip: await stageClip(page) });
    await r2d.check();
    await expect(lp).toHaveAttribute('data-show', '2d');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/landing3d-${vp.name}-troca.png` });
    await page.waitForTimeout(700);
    await expect(page.locator('.lp-canvas')).toBeHidden();
    await page.screenshot({ path: `${OUT}/landing3d-${vp.name}-2d.png` });
    // Setas do teclado mudam a opção (botões de opção nativos).
    await r2d.focus();
    await page.keyboard.press('ArrowRight');
    await expect(r3d).toBeChecked();
    await expect(lp).toHaveAttribute('data-show', '3d');
    await page.keyboard.press('ArrowLeft');
    await expect(lp).toHaveAttribute('data-show', '2d');

    // A escolha fica lembrada no aparelho.
    await page.reload();
    await expect(r2d).toBeChecked();
    await expect(lp).toHaveAttribute('data-show', '2d');

    // O link antigo da versão de teste abre direto no 3D.
    await page.goto('/apresentacao-3d');
    await expect(r3d).toBeChecked();
    await expect(lp).toHaveAttribute('data-show', '3d', { timeout: 30_000 });

    // 401 = conferência de sessão do visitante (esperada em "/"); o resto é ruído do WebGL por software.
    expect(errors.filter((e) => !/GPU stall|WebGL|GL Driver|swiftshader|status of 401/i.test(e))).toEqual([]);
    await context.close();
  });
}

async function stageClip(page: import('@playwright/test').Page) {
  const box = await page.locator('.lp-view').boundingBox();
  const vw = page.viewportSize()!.width;
  const x = Math.max(0, Math.round((box?.x ?? 0) - 40));
  return { x, y: Math.max(0, Math.round((box?.y ?? 0) - 20)), width: Math.min(vw - x, Math.round((box?.width ?? 200) + 80)), height: 90 };
}
