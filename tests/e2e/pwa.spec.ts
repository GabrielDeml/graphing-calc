import { countColor, expect, openApp, RED, setExpr, test } from './helpers';

test.describe('PWA', () => {
  test.skip(({ isMobile }) => isMobile, 'service worker behaviour is the same on mobile');

  test('manifest is valid and installable', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(`/${href?.replace(/^\//, '')}`);
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toBe('Graphing Calculator');
    expect(manifest.display).toBe('standalone');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect((await request.get(`/${icon.src}`)).ok()).toBe(true);
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
    await context.setOffline(false);
  });

  test('production build ships a strict CSP', async ({ page }) => {
    await page.goto('/');
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
  });
});
