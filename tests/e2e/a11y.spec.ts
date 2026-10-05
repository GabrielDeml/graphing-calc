import type { Page } from '@playwright/test';
import { expect, exprInput, openApp, setExpr, test } from './helpers';

// The buttons are counted, then checked one by one: the service worker's "Ready to work offline"
// toast (pwa.spec covers it) would come and go in between, taking its Dismiss button along.
test.use({ serviceWorkers: 'block' });

/** Every shown button without visible text (an icon, a color dot) must still have a name. */
async function expectIconButtonsNamed(page: Page, atLeast: number) {
  const buttons = page.locator('button:visible').filter({ hasNotText: /\S/ });
  const n = await buttons.count();
  expect(n).toBeGreaterThanOrEqual(atLeast);
  for (let i = 0; i < n; i++) {
    await expect(
      buttons.nth(i),
      await buttons.nth(i).evaluate((b) => b.outerHTML),
    ).toHaveAccessibleName(/\S/);
  }
}

test.describe('accessibility on desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout');

  test('every icon-only button has an accessible name', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2');
    await setExpr(page, 1, 'a = 2');
    await setExpr(page, 2, 'y = m x');
    await expect(page.locator('.expr-row').nth(2).getByRole('alert')).toBeVisible();
    // Header, graph controls, row marks and actions, play.
    await expectIconButtonsNamed(page, 10);

    await page.locator('.expr-row').first().getByRole('button', { name: 'Change color' }).click();
    await expectIconButtonsNamed(page, 16);
    await page.keyboard.press('Escape');

    await page.getByTestId('keypad-toggle').click();
    await exprInput(page, 0).click();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await page.getByTestId('keypad-tab-abc').click();
    await expectIconButtonsNamed(page, 15);

    await page.getByRole('button', { name: 'Hide expression list' }).click();
    await expect(page.getByRole('button', { name: 'Show expression list' })).toHaveAccessibleName(
      'Show expression list',
    );
  });

  test('the graph is a labelled group around its picture and controls', async ({ page }) => {
    await openApp(page);
    const graph = page.getByRole('group', { name: /^Graph area\./ });
    await expect(graph).toBeVisible();
    await expect(graph).toHaveAttribute('data-testid', 'graph');
    await expect(graph.getByRole('img', { name: 'Graph of the expressions' })).toBeVisible();
    // Buttons inside an img would be hidden from assistive technology.
    await expect(graph.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(graph.getByRole('button', { name: 'Reset view' })).toBeVisible();
  });

  test('math is set in the bundled STIX Two Text', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts]
            .filter((f) => f.status === 'loaded')
            .map((f) => f.family.replace(/"/g, ''));
        }),
      )
      .toContain('STIX Math Letters');
  });
});

test.describe('accessibility on touch devices', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('every icon-only button has an accessible name', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2');
    await expect(page.getByTestId('keypad')).toBeVisible();
    await expectIconButtonsNamed(page, 8);
    await page.getByTestId('keypad-tab-abc').tap();
    await expectIconButtonsNamed(page, 10);
  });
});
