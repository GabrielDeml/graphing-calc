# graphing-calc

A fast graphing calculator that runs entirely in the browser and installs as an app (PWA). It works
offline, and on phones it shows its own math keypad instead of the device keyboard.

**Live app: <https://gabrieldeml.github.io/graphing-calc/>.** To install it, open the link on your
phone and use "Add to Home Screen" (iOS Safari) or "Install app" (Android/desktop Chrome).

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
| `a = 2` | Slider with a play button and editable min, max and step |
| `k = 2a + 1` | Derived variable, shows its value |
| `f(x) = x^2`, `g(u, v) = u v` | Functions you can call from other rows: `y = f(x - 1)` |
| `2^10`, `sqrt(2)` | Shows the value |
| `y = (x+1)/(x^2+1)`, `sqrt(x)`, `e^(-x^2)` | Typed as plain text, shown typeset once you leave the row: a stacked fraction, a radical, a raised exponent |

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
  at the top right zoom or reset the view. With the graph focused, the keyboard works too: arrows
  pan, `+` and `-` zoom, `0` resets.
- **Trace:** hover a curve to see its coordinates, in a pill with the curve's color; its row in the
  list lights up faintly. On touch, tap a curve to pin the trace. Near a point of interest the
  trace snaps to it and names it ("Root", "Minimum", "Intersection with ● y = x/3"), and its ring
  grows. Where curves cross, the trace stays on the selected one. To scrub along a curve on
  touch, drag the pinned trace's dot, or press and hold on a curve for a moment (the dot grows)
  and then drag; any other drag pans, and a tap next to the pinned dot is still a tap. `Esc`
  lets go of a pinned trace along with the selection.
- **The selected curve:** the selected row's curve is drawn on top, a little bolder, with a soft
  halo. Clicking or tapping a curve selects its row (it scrolls into view and pulses briefly)
  without opening it for editing, so no keypad pops up; a click a little away from every curve
  deselects. Pointing at a row in the list brings its curve forward the same way while the
  pointer rests there.
- **Points of interest:** the selected curve shows its roots (including where it ends on the
  axis, as `sqrt(4 - x^2)` does at ±2), local maxima and minima, where it crosses the axes and
  where it meets the other curves, as grey rings that bloom in once found. Hover or click one (or
  tap it) to see what it is; clicking a ring pins the trace there, while clicking elsewhere on a
  curve only selects it. From the graph, `Tab` reaches them and the arrow keys walk from one to
  the next. Only what is in view is shown, and only while it stays readable: kinds of points
  that would crowd the graph are left out whole, extrema first and then crossings of the axes
  (zoomed out on `sin(x)`, its extrema go, then its roots), until you zoom in. While you type in
  the selected row, its rings stay, faded, until the new ones are found.
- **Typeset math:** rows you aren't editing show their math typeset, as in a textbook: stacked
  fractions, raised exponents (and `x²` typed with a superscript), subscripts, square and cube
  roots under a radical sign, parentheses and `|x|` bars that grow around a fraction, function
  names upright and letters in italic, `≤` `≥` `−` `·` `π` `θ` for `<=` `>=` `-` `*` `pi` `theta`
  (only on screen: the text stays as typed). Letters group the way the graph reads them, so
  `asin(x)` shows as a·sin once there is a slider `a`, and `pix` as πx. Click or tap a symbol to
  edit the row with the caret right there; the row you edit shows its plain text and keeps its
  height. A row with an error underlines the mistake in the typeset math too, and a missing part
  (`y = 2 +`, `x^`) shows as a faint box. The empty first row shows "Try y = sin(x)". A row too
  long for the list fades out at its end.
- **Rows:**
  - `Enter` starts a new row. On an empty row it moves on to the next one instead, and on the
    empty row at the end it stays put (the keypad's ↵ puts the keypad away there).
  - `Backspace` on an empty row deletes it (on the empty row at the end it just moves up).
  - `↑` and `↓` move between rows.
  - Tap a curve's color dot to hide it (the dot turns hollow and the row fades) or show it again.
  - The row you are working on is selected: a bar and a faint wash in its color, which stay when
    you click the graph, until `Esc`, a tap on empty graph, or deleting the row. Clicking another
    curve selects its row instead.
  - Pointing at a row (or selecting it) shows its color and delete buttons at its right end. On
    touch, they show on the selected row.
  - A curve gets its color when it first draws: the least-used one, red first, so the first three
    curves are red, blue and green wherever they sit in the list (then purple, orange and teal).
    Rows that draw nothing (sliders, values such as `k = 2a + 1`, empty rows) don't take a color,
    and a curve turned into one gives its color back.
  - Errors show as one line under the row after a pause in typing, with the mistake underlined.
  - Half-typed math doesn't make the graph flicker: while the row you are typing in is broken
    for a moment (`y = x^` on the way to `y = x^2`), its curve stays as a faint ghost and its
    color dot, slider or value stay in place. Curves it breaks along the way (retyping a slider
    they use) do the same, and their errors wait until you leave the row.
- **Sliders:** drag the thumb (its value shows above it, except under the row's own text, which
  shows it too) or press play. The min and max under the
  track's ends are fields you can edit; the step field appears while the row is being edited.
- **Undo:** `Ctrl+Z` (`⌘Z` on a Mac) undoes and `Ctrl+Shift+Z` (`⌘⇧Z`) or `Ctrl+Y` redoes, from
  anywhere in the app. Typing undoes in bursts, and deleting is a burst of its own, so text
  deleted or typed over right after it was typed comes back. A slider drag is one step, arrow
  keys on a slider undo like typing, and a playing slider adds none (undoing something else
  leaves it where it is). Undo puts the caret back where the change was; a change made outside
  the rows (delete, a color, New graph) is scrolled into view. Phones have no undo key yet: **New
  graph**, and deleting a row by touch, show an Undo button for a few seconds instead (it waits
  while you point at it or it has focus).
- **Saved automatically:** the expression list, the view and the panel layout (including the
  list's width) are kept in the browser and come back on the next visit (sliders come back
  paused), and so is the keypad mode once you pick one with the header's keyboard button. Nothing
  is stored until you change something. **New graph** in the header's More options (⋯) menu
  starts over, at the home view. With the app open in two windows, each one picks up the list the
  other saves (each keeps its own view). A hidden list stays hidden on wide screens only; phones
  always show it. Data saved by a newer version of the app is never overwritten by an older one.
- **Layout:** on a wide screen the list sits beside the graph. Drag its right edge to resize it
  (or focus the edge and use the arrow keys, `Home` and `End`); double-click the edge for the
  default width. The sidebar button in the list's header hides it, and the same button at the top
  of the graph's controls brings it back.
- **Look:** follows the system's light or dark setting. Math is set in STIX Two Text (with `≤`,
  `≥`, `√` and superscripts from STIX Two Math), bundled with the app so it works offline: letters
  in italic, digits, operators and function names upright; radical signs and tall parentheses are
  drawn to fit. With reduced motion turned on in the system,
  transitions, the zoom animation and the points of interest's bloom are skipped.
- **Math keypad:** on touch devices, tapping a row opens the built-in keypad, which has three pages:
  numbers, functions and letters. The keyboard key on the letters page switches that row to the
  device keyboard, and the keyboard button in the header switches modes for good. Tapping the
  graph or the chevron hides the keypad; on a phone held sideways, the list and keypad sit beside
  the graph. On desktop the keypad is off by default and can be turned on from the header.

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
src/plot/         geometry: viewport, ticks, adaptive samplers, marching squares, points of
                  interest (pure TS)
src/keypad/       on-screen keypad layouts and text-editing logic (pure TS)
src/mathedit/     typeset rows: a tolerant parse that reads text exactly as the engine does,
                  the render plan (boxes, spacing, error marks) and caret stops (pure TS)
src/render/       canvas drawing and the render loop
src/interaction/  pan / zoom / pinch gestures
src/state/        Solid stores and signals; the undo history core, the autosave format and what
                  stays steady while typing are plain TS
src/components/   UI
tests/e2e/        Playwright specs
```

The pure-TS layers have no DOM or framework dependencies; `tsconfig.engine.json` checks this.
That keeps them unit-testable and ready to move into a Web Worker later.

## Deployment

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs lint, typecheck, unit tests and
the Playwright suite on every pull request and every push to `main`. It runs the tests against the
same `/<repo>/` sub-path build that Pages serves. On `main` it then builds the site and deploys it
to GitHub Pages.

One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

The build reads the URL path it is served from out of `BASE_PATH`. It defaults to `/`, so
`pnpm dev` and `pnpm preview` serve at the root. To try the Pages layout locally, run
`BASE_PATH=/graphing-calc/ pnpm build && BASE_PATH=/graphing-calc/ pnpm preview`, then open
<http://127.0.0.1:4173/graphing-calc/>.
