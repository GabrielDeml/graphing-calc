import type { Page } from '@playwright/test';
import { countColor, expect, exprInput, openApp, RED, setExpr, test } from './helpers';

/** The insight line under the nth row. */
const insight = (page: Page, row: number) =>
  page.locator('.expr-row').nth(row).getByTestId('insight');

/** The graph's view as [xmin, xmax, ymin, ymax]. */
async function view(page: Page) {
  return ((await page.getByTestId('graph').getAttribute('data-view')) ?? '').split(',').map(Number);
}

const center = async (page: Page) => {
  const [xmin, xmax, ymin, ymax] = await view(page);
  return [(xmin + xmax) / 2, (ymin + ymax) / 2];
};

/**
 * Where the view is and its scale: [cx, cy, x span]. A resize keeps them (the keypad opening on
 * a phone), so a view compared before and after one is still the same view.
 */
async function place(page: Page) {
  const [xmin, xmax, ymin, ymax] = await view(page);
  return [(xmin + xmax) / 2, (ymin + ymax) / 2, xmax - xmin].map((v) => v.toPrecision(4));
}

/** Two frames: whatever the graph was told before now is drawn (or animating). */
const drawn = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

test.describe('the insight line', () => {
  test('reads a parabola: vertex, roots and axis', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await expect(insight(page, 0)).toHaveText(
      'Parabola · vertex (0, −2) · roots −1.414, 1.414 · axis x = 0',
    );
    // The values at a point are chips, named for what they are.
    const line = insight(page, 0);
    await expect(line.getByRole('button', { name: 'Vertex (0, −2)' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'Root −1.414' })).toBeVisible();
  });

  test('reads a circle, a sine wave and a rose', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'x^2 + y^2 = 9');
    await setExpr(page, 1, 'y = sin(x)');
    await setExpr(page, 2, 'r = cos(3θ)');
    await expect(insight(page, 0)).toHaveText('Circle · centre (0, 0) · radius 3');
    await expect(insight(page, 1)).toHaveText(
      'Sine wave · period 2π · amplitude 1 · midline y = 0',
    );
    // (Selected, it goes on to say where it meets the others.)
    await expect(insight(page, 2)).toContainText('Rose with 3 petals · petal length 1');
  });

  test('a slider says which rows use it, and the curve follows its value', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 2');
    await setExpr(page, 1, 'y = x^2 + a');
    const used = insight(page, 0);
    await expect(used).toContainText('Used by');
    await expect(used.locator('.insight-row')).toHaveText('y=x2+a');
    await expect(insight(page, 1)).toContainText('vertex (0, 2)');
    await setExpr(page, 0, 'a = 3');
    await expect(insight(page, 1)).toContainText('vertex (0, 3)');
  });

  test('a function drawn too says which rows use it', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'f(x) = x^2');
    await setExpr(page, 1, 'y = f(x - 1)');
    await expect(insight(page, 0)).toContainText('Parabola · used by');
    await expect(insight(page, 0).locator('.insight-row')).toHaveCount(1);
  });

  test('what follows the rows named keeps up as they change', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    for (let i = 1; i <= 4; i++) await setExpr(page, i, `y = a + ${i}`);
    await expect(insight(page, 0)).toContainText('+1 more');
    await setExpr(page, 5, 'y = a + 5');
    await expect(insight(page, 0)).toContainText('+2 more');
    // The selected row's count of meetings, too (touching y = 2 at −1 counts once).
    await setExpr(page, 6, 'y = x^3 - 3x');
    await expect(insight(page, 6)).toContainText('y=a+1 at 2 points');
    await exprInput(page, 6).fill('y = x^3 - 3x + 1');
    await expect(insight(page, 6)).toContainText('y=a+1 at 3 points');
  });

  test('keeps up while a slider plays', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    await setExpr(page, 1, 'y = x^3 - a x');
    await expect(insight(page, 1)).toContainText('Cubic');
    await page.getByRole('button', { name: 'Play a' }).click();
    // Rows typed in while it plays, one using it and one not, are read within a second…
    await setExpr(page, 2, 'y = x^2 - 2');
    await expect(insight(page, 2)).toContainText('Parabola', { timeout: 1500 });
    await setExpr(page, 3, 'y = x^2 - a');
    await expect(insight(page, 3)).toContainText('Parabola', { timeout: 1500 });
    // …and so is an edit to one using it.
    await exprInput(page, 1).fill('y = x^2 + a');
    await expect(insight(page, 1)).toContainText('Parabola', { timeout: 1500 });
    await expect(page.getByRole('button', { name: 'Pause a' })).toBeVisible();
  });

  test('a chip stays put while a slider plays: it takes presses and keeps focus', async ({
    page,
  }) => {
    await openApp(page);
    await setExpr(page, 0, 'a = 1');
    await setExpr(page, 1, 'y = (a^2 + 1) x^2 - 2');
    const line = insight(page, 1);
    // The vertex holds still while the roots move.
    const chip = line.getByRole('button', { name: 'Vertex (0, −2)' });
    await expect(chip).toBeVisible();
    const before = await line.textContent();
    await line.evaluate((el) => {
      const w = window as unknown as { chipsRemoved: number };
      w.chipsRemoved = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.removedNodes) {
            if (
              n instanceof Element &&
              (n.matches('.insight-chip') || n.querySelector('.insight-chip'))
            )
              w.chipsRemoved++;
          }
        }
      }).observe(el, { childList: true, subtree: true });
    });
    await page.getByRole('button', { name: 'Play a' }).click();
    await chip.focus();
    await expect(line).not.toHaveText(before ?? '');
    await page.waitForTimeout(1000);
    await expect(chip).toBeFocused();
    expect(
      await page.evaluate(() => (window as unknown as { chipsRemoved: number }).chipsRemoved),
    ).toBe(0);
    await expect(page.getByRole('button', { name: 'Pause a' })).toBeVisible();
  });

  test('the selected row says where it meets the others', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x/3');
    await setExpr(page, 1, 'y = x^3 - x');
    // The row being edited is the selected one.
    await expect(insight(page, 1)).toContainText('meets');
    await expect(insight(page, 1)).toContainText('at 3 points');
    await expect(insight(page, 1).locator('.insight-row')).toHaveText('y=x/3');
    await expect(insight(page, 0)).not.toContainText('meets');
    await exprInput(page, 0).click();
    await expect(insight(page, 0)).toContainText('meets');
    await expect(insight(page, 1)).not.toContainText('meets');
  });

  test('a value shows its value; the line stays out of it', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, '2^10');
    await setExpr(page, 1, 'y = 3');
    await expect(insight(page, 1)).toHaveText('Horizontal line · y = 3');
    await expect(page.locator('.expr-row').first().locator('.expr-value')).toHaveText('= 1024');
    await expect(insight(page, 0)).toHaveCount(0);
  });

  test('says nothing while the row has an error', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x^2 - 2');
    await expect(insight(page, 0)).toContainText('Parabola');
    await exprInput(page, 0).fill('y = x^2 -');
    await expect(page.locator('.expr-row').first().getByRole('alert')).toBeVisible();
    await expect(insight(page, 0)).toHaveCount(0);
    await exprInput(page, 0).fill('y = x^2 - 1');
    await expect(insight(page, 0)).toContainText('roots −1, 1');
  });

  test('no chip is named like a color', async ({ page }) => {
    await openApp(page);
    const sources = ['y = x^2 - 2', 'x^2 + y^2 = 9', 'r = 1 + cos(θ)', '(3cos t, 2sin t)'];
    for (let i = 0; i < sources.length; i++) await setExpr(page, i, sources[i]);
    for (let i = 0; i < sources.length; i++) await expect(insight(page, i)).toBeVisible();
    const names = await page
      .getByTestId('insight')
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) expect(name).not.toMatch(/red/i);
  });

  test('a chip flies the graph to its point and pins the trace there', async ({ page }) => {
    await openApp(page);
    // The curve shows at home (no framing), its vertex far to the right.
    await setExpr(page, 0, 'y = (x - 30)^2/50 - 5');
    const chip = insight(page, 0).getByRole('button', { name: 'Vertex (30, −5)' });
    await chip.click();
    await expect.poll(async () => (await center(page))[0]).toBeCloseTo(30, 3);
    expect((await center(page))[1]).toBeCloseTo(-5, 3);
    await expect(page.getByTestId('trace').getByRole('status')).toHaveText('(30, -5)');
  });
});

test.describe('framing', () => {
  test('Zoom to fit shows every curve whole, equally scaled', async ({ page }) => {
    await openApp(page);
    // Its ends at (±20, 0) are out of view; its top and bottom are in it.
    await setExpr(page, 0, 'x^2/400 + y^2/25 = 1');
    await page.getByRole('button', { name: 'Zoom to fit', exact: true }).click();
    await expect.poll(async () => (await view(page))[0]).toBeLessThan(-20);
    await page.waitForTimeout(300);
    const [xmin, xmax, ymin, ymax] = await view(page);
    expect(xmax).toBeGreaterThan(20);
    expect(ymin).toBeLessThan(-5);
    expect(ymax).toBeGreaterThan(5);
    // Not out much farther than that.
    expect(xmax - xmin).toBeLessThan(60);
    const { width, height } = await page
      .getByTestId('graph')
      .evaluate((el) => el.getBoundingClientRect());
    expect((xmax - xmin) / width / ((ymax - ymin) / height)).toBeCloseTo(1, 4);
  });

  test('Zoom to fit with nothing plotted goes home', async ({ page }) => {
    await openApp(page);
    const home = await view(page);
    await page.getByTestId('graph').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('-');
    await expect.poll(async () => (await view(page))[1]).not.toBeCloseTo(home[1], 3);
    await page.getByRole('button', { name: 'Zoom to fit', exact: true }).click();
    await expect.poll(() => view(page)).toEqual(home);
  });

  test('a new curve out of sight is framed', async ({ page }) => {
    await openApp(page);
    await setExpr(page, 0, 'y = x + 100');
    await expect.poll(async () => (await center(page))[1]).toBeCloseTo(100, 3);
    await page.waitForTimeout(300);
    expect(await countColor(page, RED)).toBeGreaterThan(100);
  });

  test('a curve in view is not framed', async ({ page }) => {
    await openApp(page);
    const home = await place(page);
    await setExpr(page, 0, 'x^2 + y^2 = 9');
    await drawn(page);
    await page.waitForTimeout(500);
    expect(await place(page)).toEqual(home);
  });

  test('nor is a curve edited out of sight, or one after the view was moved', async ({ page }) => {
    await openApp(page);
    const home = await place(page);
    await setExpr(page, 0, 'y = x');
    // Left (Escape): it is a curve in view now…
    await exprInput(page, 0).press('Escape');
    await drawn(page);
    // …so an edit taking it out of sight leaves the view be.
    await exprInput(page, 0).fill('y = x + 100');
    await exprInput(page, 0).press('Escape');
    await drawn(page);
    await page.waitForTimeout(500);
    expect(await place(page)).toEqual(home);
    // Panned just now: the view is the user's.
    await page.getByTestId('graph').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => place(page)).not.toEqual(home);
    // (An arrow key's pan is a short animated step.)
    await page.waitForTimeout(300);
    const panned = await place(page);
    await setExpr(page, 1, 'y = x - 100');
    await exprInput(page, 1).press('Escape');
    await drawn(page);
    await page.waitForTimeout(500);
    expect(await place(page)).toEqual(panned);
  });

  test('a curve typed key by key is framed once the typing pauses', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await input.pressSequentially('y = x + 100', { delay: 30 });
    await expect.poll(async () => (await center(page))[1], { timeout: 4000 }).toBeCloseTo(100, 3);
  });

  test('never on the way there', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await drawn(page);
    const before = await place(page);
    // `(x-50)` on the way plots y = x − 50, out of sight: the graph doesn't fly there…
    await input.pressSequentially('(x-50)^2+(y-50)^2=4', { delay: 30 });
    await expect(input).toHaveValue('(x-50)^2+(y-50)^2=4');
    expect(await place(page)).toEqual(before);
    // …but to the circle, once the typing pauses.
    await expect.poll(async () => (await center(page))[0], { timeout: 4000 }).toBeCloseTo(50, 3);
    expect((await center(page))[1]).toBeCloseTo(50, 3);
  });

  test('nor when the curve typed is in view, whatever it was on the way', async ({ page }) => {
    await openApp(page);
    const input = exprInput(page, 0);
    await input.click();
    await drawn(page);
    const before = await place(page);
    // y = 12 on the way is out of sight; y = 12x is in it.
    await input.pressSequentially('y = 12x', { delay: 30 });
    await page.waitForTimeout(1500);
    expect(await place(page)).toEqual(before);
  });
});
