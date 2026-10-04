# graphing-calc

A fast graphing calculator that runs entirely in the browser and installs as an app (PWA). It works
offline, and on phones it shows its own math keypad instead of the device keyboard.

Built with Vite, TypeScript and SolidJS. The math engine (tokenizer, Pratt parser and a compiler
to closures) and the plotting code (adaptive samplers and marching squares) are written from
scratch in plain TypeScript.

## What you can type

| Input | What it does |
| --- | --- |
| `y = x^2 - 3`, `sin(x)`, `2x + 1` | Graph of y as a function of x (a bare expression in x means `y = …`) |
| `x = y^2` | Graph of x as a function of y |
| `x^2 + y^2 = 9`, `xy = 1` | Implicit curve |
| `y > x^2`, `x <= 2`, `x^2 + y^2 < 4` | Shaded inequality (strict `<` `>` draw a dashed boundary) |
| `(cos t, sin t)` | Parametric curve; the t range can be edited below the row |
| `r = 1 + cos θ` (or `theta`) | Polar curve |
| `(1, 2)`, `(1, 2), (3, 4)` | Points |
| `a = 2` | Slider with play button and editable min/max/step |
| `k = 2a + 1` | Derived variable, shows its value |
| `f(x) = x^2`, `g(u, v) = u v` | Functions you can call from other rows: `y = f(x - 1)` |
| `2^10`, `sqrt(2)` | Shows the value |

Syntax notes:

- **Implicit multiplication:** `2x`, `3sin x`, `x y`, `2(x+1)` and `(x+1)(x-1)` all multiply. A
  number never multiplies the thing *before* it, so write `2x`, not `x2`.
- **Functions without parentheses:** `sin x^2` means `sin(x²)` and `sin x cos x` means
  `sin(x)·cos(x)`. `sin^2 x` means `sin(x)²`.
- **Powers and division:** `^` is right-associative and `-x^2` means `-(x²)`. `1/2x` means
  `(1/2)·x`.
- **Absolute value:** `|x|`, plus `!` for factorial, `π` / `pi`, `τ` / `tau`, `e`, `θ` / `theta`.
- **Built-in functions:**
  - trig `sin cos tan sec csc cot`
  - inverse trig `asin acos atan` (two-argument `atan(y, x)` too)
  - hyperbolic `sinh cosh tanh …`
  - `sqrt cbrt abs exp ln log floor ceil round sign min max mod gcd lcm`
- **Variable names:** a name with more than one letter may not contain `x` or `y` (so `ax = 1`
  stays the line a·x = 1). Subscripts always work: `a_1`, `v_{max}`, `x_0`.
- **Unknown names:** an unknown name such as `m` in `y = m x` offers a one-tap "Add slider".

## Using it

- **Graph:** drag to pan, use the wheel or pinch to zoom, double-click to zoom in, and the buttons
  zoom or reset the view. With the graph focused, the keyboard works too: arrows pan, `+` and `-`
  zoom, `0` resets.
- **Trace:** hover a curve to see coordinates. On touch, tap a curve to pin the trace.
- **Rows:**
  - `Enter` starts a new row.
  - `Backspace` on an empty row deletes it.
  - `↑` and `↓` move between rows.
  - Tap the color dot to show or hide a curve.
- **Math keypad:** on touch devices, tapping a row opens the built-in keypad, which has three pages:
  numbers, functions and letters. The ⌨ key on the letters page switches that row to the device
  keyboard, and the ⌨ button in the header switches modes for good. Tapping the graph or ⌄ hides
  the keypad; on a phone held sideways, the list and keypad sit beside the graph. On desktop the
  keypad is off by default and can be turned on from the header.

## Development

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev          # dev server
pnpm build        # production build (includes the service worker)
pnpm preview      # serve the build on http://127.0.0.1:4173
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright, builds and previews first)
pnpm lint         # Biome
pnpm typecheck
pnpm ci           # everything above
pnpm icons        # regenerate PWA icons from public/logo.svg
```

### Layout

```
src/engine/       math language: tokenizer, parser, classifier, compiler, document engine (pure TS)
src/plot/         geometry: viewport, ticks, adaptive samplers, marching squares (pure TS)
src/keypad/       on-screen keypad layouts and text-editing logic (pure TS)
src/render/       canvas drawing and the render loop
src/interaction/  pan / zoom / pinch gestures
src/state/        Solid stores and signals
src/components/   UI
tests/e2e/        Playwright specs
```

The pure-TS layers have no DOM or framework dependencies; `tsconfig.engine.json` checks this.
That keeps them unit-testable and ready to move into a Web Worker later.
