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
    await drawn(page);
    await exprInput(page, 0).fill('y = x + 100');
    await drawn(page);
    await page.waitForTimeout(500);
    expect(await place(page)).toEqual(home);
    // Panned just now: the view is the user's.
    await page.getByTestId('graph').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => place(page)).not.toEqual(home);
    const panned = await place(page);
    await setExpr(page, 1, 'y = x - 100');
    await drawn(page);
    await page.waitForTimeout(500);
    expect(await place(page)).toEqual(panned);
  });
});
