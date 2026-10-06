import { countColor, expect, exprInput, openApp, RED, setExpr, test } from './helpers';

test.describe('PWA', () => {
  test.skip(({ isMobile }) => isMobile, 'service worker behaviour is the same on mobile');

  test('manifest is valid and installable', async ({ page, request }) => {
    await page.goto('./');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifestUrl = new URL(href ?? '', page.url()).href;
    const res = await request.get(manifestUrl);
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toBe('Graphing Calculator');
    expect(manifest.display).toBe('standalone');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect((await request.get(new URL(icon.src, manifestUrl).href)).ok()).toBe(true);
    }
  });

  test('works offline after the first visit', async ({ page, context }) => {
    await openApp(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Shown once, when the service worker has precached everything on first install.
    await expect(page.getByTestId('sw-toast')).toContainText(/offline/i);
    // The first load isn't controlled yet; reload until the service worker takes over.
    await expect
      .poll(async () => {
        await page.reload();
        return page.evaluate(() => !!navigator.serviceWorker.controller);
      })
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await openApp(page);
    await setExpr(page, 0, 'y = sin(x)');
    await expect.poll(() => countColor(page, RED)).toBeGreaterThan(200);
    // The bundled math font comes from the precache too (a failed load would be a console error).
    await expect
      .poll(() =>
        page.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].some(
            (f) => f.family.replace(/"/g, '') === 'STIX Math Letters' && f.status === 'loaded',
          );
        }),
      )
      .toBe(true);
    // Left, the row shows typeset in STIX Two Text, offline too.
    await exprInput(page, 0).press('Enter');
    await expect(page.locator('.math-view').first().locator('.m-fn')).toHaveText('sin');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].some(
            (f) =>
              f.family.replace(/"/g, '') === 'STIX Two Text' &&
              f.style === 'italic' &&
              f.status === 'loaded',
          );
        }),
      )
      .toBe(true);
    await context.setOffline(false);
  });

  test('production build ships a strict CSP', async ({ page }) => {
    await page.goto('./');
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
  });
});
