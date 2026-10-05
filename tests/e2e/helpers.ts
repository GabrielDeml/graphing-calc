import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every test fails on console errors (including CSP violations) or uncaught exceptions, in any
 * page of its context (a second tab too).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      context.on('weberror', (e) => errors.push(String(e.error())));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const RED = '#c74440';
export const BLUE = '#2d70b3';
export const GREEN = '#388c46';
/** The first curve color in the dark color scheme (src/state/colors.ts). */
export const RED_DARK = '#f0605b';
/** Axis colors (src/styles/global.css), counted with a tolerance of 20. */
export const AXIS = '#3a3d44';
export const AXIS_DARK = '#80868f';

export function exprInput(page: Page, index: number) {
  return page.getByTestId('expr-input').nth(index);
}

/** Put text into the nth expression row (rows are created automatically as you type). */
export async function setExpr(page: Page, index: number, text: string) {
  const input = exprInput(page, index);
  await input.click();
  await input.fill(text);
}

export async function openApp(page: Page) {
  await page.goto('./');
  await expect(exprInput(page, 0)).toBeVisible();
  await expect(page.getByTestId('graph')).toHaveAttribute('data-view', /,/);
}

function parseHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Number of canvas pixels within `tol` (per channel) of a color. */
export async function countColor(page: Page, hex: string, tol = 40): Promise<number> {
  const rgb = parseHex(hex);
  return page.evaluate(
    ([r, g, b, t]) => {
      const c = document.querySelector('canvas.graph-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - r) <= t &&
          Math.abs(data[i + 1] - g) <= t &&
          Math.abs(data[i + 2] - b) <= t
        ) {
          n++;
        }
      }
      return n;
    },
    [...rgb, tol] as const,
  );
}

/** Screen (CSS px, relative to the graph element) of a world point, from the graph's data-view. */
export async function worldToScreen(page: Page, x: number, y: number) {
  return page.getByTestId('graph').evaluate(
    (el, [wx, wy]) => {
      const [xmin, xmax, ymin, ymax] = (el.getAttribute('data-view') ?? '').split(',').map(Number);
      return {
        sx: ((wx - xmin) / (xmax - xmin)) * el.clientWidth,
        sy: ((ymax - wy) / (ymax - ymin)) * el.clientHeight,
      };
    },
    [x, y] as const,
  );
}

/** Count pixels of a color in a small square around a world point. */
export async function countColorNear(
  page: Page,
  x: number,
  y: number,
  hex: string,
  radiusPx = 6,
  tol = 50,
): Promise<number> {
  const { sx, sy } = await worldToScreen(page, x, y);
  const rgb = parseHex(hex);
  return page.evaluate(
    ([px, py, rad, r, g, b, t]) => {
      const c = document.querySelector('canvas.graph-canvas') as HTMLCanvasElement;
      const dpr = c.width / c.clientWidth;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      const x0 = Math.max(0, Math.round((px - rad) * dpr));
      const y0 = Math.max(0, Math.round((py - rad) * dpr));
      const size = Math.max(1, Math.round(2 * rad * dpr));
      const { data } = ctx.getImageData(x0, y0, size, size);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - r) <= t &&
          Math.abs(data[i + 1] - g) <= t &&
          Math.abs(data[i + 2] - b) <= t
        ) {
          n++;
        }
      }
      return n;
    },
    [sx, sy, radiusPx, ...rgb, tol] as const,
  );
}

/** Average color in a small square around a world point. */
export async function colorAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const { sx, sy } = await worldToScreen(page, x, y);
  return page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('canvas.graph-canvas') as HTMLCanvasElement;
      const dpr = c.width / c.clientWidth;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      const { data } = ctx.getImageData(Math.round(px * dpr) - 1, Math.round(py * dpr) - 1, 3, 3);
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) {
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
      }
      return sum.map((s) => Math.round(s / 9)) as [number, number, number];
    },
    [sx, sy] as const,
  );
}

type TouchPoint = { x: number; y: number };

/** Raw multi-touch input through CDP (Chromium only), for holds, drags and pinches. */
export async function touchSession(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: TouchPoint[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  return {
    start: (...points: TouchPoint[]) => send('touchStart', points),
    move: (...points: TouchPoint[]) => send('touchMove', points),
    end: () => send('touchEnd', []),
  };
}

/** Two-finger spread centred on (x, y). */
export async function pinchOut(page: Page, x: number, y: number) {
  const touch = await touchSession(page);
  await touch.start({ x: x - 20, y }, { x: x + 20, y });
  for (let d = 20; d <= 120; d += 10) {
    await touch.move({ x: x - d, y }, { x: x + d, y });
  }
  await touch.end();
}

/** Centre of an element's box, in page coordinates. */
export async function center(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Whether `inner` lies entirely inside `outer` (with 1px tolerance). */
export function contains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
) {
  return (
    inner.y >= outer.y - 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1 &&
    inner.x >= outer.x - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1
  );
}
