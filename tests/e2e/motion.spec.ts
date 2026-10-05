import type { Page } from '@playwright/test';
import { expect, exprInput, openApp, setExpr, test } from './helpers';

/** What the page holds right now: the keypad, and the graph's height. */
const now = (page: Page) =>
  page.evaluate(() => ({
    keypad: document.querySelector('.keypad')?.className ?? null,
    graph: document.querySelector('.graph')?.getBoundingClientRect().height ?? 0,
  }));

/**
 * From here on, a log of what moves, noted by the page itself as it happens (the states last a
 * moment only): rows opening, places of removed rows closing, the keypad leaving (with the
 * graph's height then).
 */
async function watchMotion(page: Page) {
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { motionLog: string[] }).motionLog = log;
    const note = () => {
      const seen = (entry: string) => log.includes(entry) || log.push(entry);
      if (document.querySelector('.expr-row.entering')) seen('entering');
      if (document.querySelector('.expr-row-gone')) seen('gone');
      if (document.querySelector('.keypad.leaving') && !log.some((e) => e.startsWith('leaving'))) {
        log.push(`leaving ${document.querySelector('.graph')?.getBoundingClientRect().height}`);
      }
    };
    new MutationObserver(note).observe(document.body, {
      subtree: true,
      childList: true,
      attributeFilter: ['class'],
    });
  });
}

const motionLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { motionLog: string[] }).motionLog);

test.describe('rows coming and going', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard');

  test('a new row opens, a removed one closes its place, and focus moves as before', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x');
    await setExpr(page, 1, 'y = 2');
    await expect(page.locator('.expr-row.entering')).toHaveCount(0);
    await watchMotion(page);
    // Enter in the first row opens a new one under it.
    await exprInput(page, 0).press('Enter');
    await expect.poll(() => motionLog(page)).toContain('entering');
    await expect(exprInput(page, 1)).toBeFocused();
    await expect(exprInput(page, 1)).toHaveValue('');
    await expect(page.locator('.expr-row.entering')).toHaveCount(0);
    // Backspace in it takes it away: its place closes, and the caret goes up as before.
    await exprInput(page, 1).press('Backspace');
    await expect.poll(() => motionLog(page)).toContain('gone');
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
    await watchMotion(page);
    await exprInput(page, 0).press('Enter');
    await expect(exprInput(page, 1)).toBeFocused();
    await exprInput(page, 1).press('Backspace');
    await expect(exprInput(page, 0)).toBeFocused();
    await expect(page.getByTestId('expr-input')).toHaveCount(3);
    expect(await motionLog(page)).toEqual([]);
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
    await watchMotion(page);
    await page.getByTestId('keypad-hide').tap();
    await expect.poll(async () => (await motionLog(page)).join()).toMatch(/leaving/);
    const leaving = (await motionLog(page)).find((e) => e.startsWith('leaving')) ?? '';
    expect(Number(leaving.split(' ')[1])).toBeGreaterThan(open.graph);
    await expect(page.getByTestId('keypad')).toHaveCount(0);
    await expect(exprInput(page, 0)).toBeFocused();
    // Back while it slides away: the same sheet turns back from where it is, without a jump.
    await exprInput(page, 0).tap();
    await expect(page.getByTestId('keypad')).toBeVisible();
    await page.waitForTimeout(300);
    const run = await page.evaluate(async () => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const first = document.querySelector('.keypad');
      const top = () => first?.getBoundingClientRect().top ?? Number.NaN;
      const frames: Array<{ top: number; leaving: boolean }> = [];
      const note = () =>
        frames.push({ top: top(), leaving: !!first?.classList.contains('leaving') });
      const open = top();
      (document.querySelector('[data-testid="keypad-hide"]') as HTMLElement).click();
      for (let i = 0; i < 2; i++) {
        await frame();
        note();
      }
      (document.querySelector('[data-testid="expr-input"]') as HTMLElement).click();
      for (let i = 0; i < 25; i++) {
        await frame();
        note();
      }
      return { open, frames, same: document.querySelector('.keypad') === first };
    });
    expect(run.same).toBe(true);
    const turn = run.frames.findIndex((f) => !f.leaving);
    expect(turn).toBeGreaterThan(0);
    // Down while it left, then straight back up from there to where it was.
    expect(run.frames[turn - 1].top).toBeGreaterThan(run.open);
    for (let i = turn; i < run.frames.length; i++) {
      expect(run.frames[i].top).toBeLessThanOrEqual(run.frames[i - 1].top + 0.5);
    }
    expect(run.frames[run.frames.length - 1].top).toBeCloseTo(run.open, 0);
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
