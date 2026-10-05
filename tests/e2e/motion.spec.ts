import type { Page } from '@playwright/test';
import { expect, exprInput, openApp, setExpr, test } from './helpers';

/** What the page holds right now: rows opening, places of removed rows closing, the keypad. */
const now = (page: Page) =>
  page.evaluate(() => ({
    entering: document.querySelectorAll('.expr-row.entering').length,
    gone: document.querySelectorAll('.expr-row-gone').length,
    keypad: document.querySelector('.keypad')?.className ?? null,
    graph: document.querySelector('.graph')?.getBoundingClientRect().height ?? 0,
  }));

test.describe('rows coming and going', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard');

  test('a new row opens, a removed one closes its place, and focus moves as before', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 2');
    await expect(page.locator('.expr-row.entering')).toHaveCount(0);
    // Enter in the first row opens a new one under it.
    await exprInput(page, 0).press('Enter');
    expect((await now(page)).entering).toBe(1);
    await expect(exprInput(page, 1)).toBeFocused();
    await expect(exprInput(page, 1)).toHaveValue('');
    await expect(page.locator('.expr-row.entering')).toHaveCount(0);
    // Backspace in it takes it away: its place closes, and the caret goes up as before.
    await exprInput(page, 1).press('Backspace');
    expect((await now(page)).gone).toBe(1);
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(exprInput(page, 1)).toHaveValue('y = 2');
    await expect(page.locator('.expr-row-gone')).toHaveCount(0);
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
  });

  test('with reduced motion they just appear and go', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 2');
    await exprInput(page, 0).press('Enter');
    expect((await now(page)).entering).toBe(0);
    await expect(exprInput(page, 1)).toBeFocused();
    await exprInput(page, 1).press('Backspace');
    expect((await now(page)).gone).toBe(0);
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
  });
});

test.describe('the phone layout in motion', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout');

  test('the panel glides between snaps, the graph drawn quickly meanwhile', async ({ page }) => {
    await page.goto('./?debug');
    await expect(exprInput(page, 0)).toBeVisible();
    // A log of the snap's transition and of the quality of every frame drawn meanwhile.
    await page.evaluate(() => {
      const app = document.querySelector('.app') as HTMLElement;
      const overlay = document.querySelector('.debug-overlay') as HTMLElement;
      const log: string[] = [];
      (window as unknown as { snapLog: string[] }).snapLog = log;
      const rows = (e: TransitionEvent) =>
        e.target === app && e.propertyName === 'grid-template-rows';
      app.addEventListener('transitionrun', (e) => rows(e) && log.push('run'));
      app.addEventListener('transitionend', (e) => rows(e) && log.push('end'));
      new MutationObserver(() => log.push(overlay.textContent?.split(' ').pop() ?? '')).observe(
        overlay,
        { childList: true, characterData: true, subtree: true },
      );
    });
    const log = () => page.evaluate(() => (window as unknown as { snapLog: string[] }).snapLog);
    await page.locator('.panel-title').tap();
    await expect(page.locator('.app')).toHaveAttribute('data-panel', 'full');
    await expect.poll(async () => (await log()).includes('end')).toBe(true);
    await expect.poll(async () => (await log()).at(-1)).toBe('final');
    const entries = await log();
    const during = entries.slice(entries.indexOf('run') + 1, entries.indexOf('end'));
    expect(during.length).toBeGreaterThan(1);
    expect(during.filter((q) => q !== 'interactive')).toEqual([]);
  });

  test('the keypad slides away while the graph takes its room at once', async ({ page }) => {
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await page.waitForTimeout(300);
    const open = await now(page);
    await page.getByTestId('keypad-hide').tap();
    const leaving = await now(page);
    expect(leaving.keypad).toMatch(/\bleaving\b/);
    expect(leaving.graph).toBeGreaterThan(open.graph);
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 0)).toBeFocused();
    // Back while it slides away: the same sheet comes back.
    await exprInput(page, 0).tap();
    await page.getByTestId('keypad-hide').tap();
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('keypad')).not.toHaveClass(/\bleaving\b/);
  });

  test('with reduced motion the keypad goes at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await page.getByTestId('keypad-hide').tap();
    expect((await now(page)).keypad).toBeNull();
  });
});
