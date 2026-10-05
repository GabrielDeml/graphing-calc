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
| `y = m x + b` | Letters nothing defines become sliders (`m = 1`, `b = 1`) by themselves, undoable |
| `k = 2a + 1` | Derived variable, shows its value |
| `f(x) = x^2`, `g(u, v) = u v` | Functions you can call from other rows: `y = f(x - 1)` |
| `2^10`, `sqrt(2)` | Shows the value |
| `y = (x+1)/(x^2+1)`, `sqrt(x)`, `e^(-x^2)` | Shown typeset as you type: a stacked fraction, a radical, a raised exponent (see **Editing math** below) |
| `y = x^2 - 2`, `x^2 + y^2 = 9`, `r = cos(3θ)` | A quiet line under the row says what the curve is: "Parabola · vertex (0, −2) · roots −1.414, 1.414 · axis x = 0", "Circle · centre (0, 0) · radius 3", "Rose with 3 petals · petal length 1" (see **Insights** below) |

Syntax notes:

- **Implicit multiplication:** `2x`, `3sin x`, `x y`, `2(x+1)` and `(x+1)(x-1)` all multiply. A
  number never multiplies the thing *before* it, so write `2x`, not `x2`.
- **Functions without parentheses:** `sin x^2` means `sin(x²)` and `sin x cos x` means
  `sin(x)·cos(x)`. `sin^2 x` means `sin(x)²`.
- **Powers and division:** `^` is right-associative and `-x^2` means `-(x²)`. `1/2x` means
  `(1/2)·x` (typed key by key in a row, it becomes `1/(2x)`: see **Editing math**).
- **Absolute value:** `|x|`, plus `!` for factorial, `π` / `pi`, `τ` / `tau`, `e`, `θ` / `theta`.
- **Built-in functions:**
  - trig `sin cos tan sec csc cot`
  - inverse trig `asin acos atan` (two-argument `atan(y, x)` too)
  - hyperbolic `sinh cosh tanh …`
  - `sqrt cbrt abs exp ln log floor ceil round sign min max mod gcd lcm`
- **Variable names:** a name with more than one letter may not contain `x` or `y` (so `ax = 1`
  stays the line a·x = 1). Subscripts always work: `a_1`, `v_{max}`, `x_0`.
- **Unknown names:** an unknown name such as `m` in `y = m x` becomes a slider `m = 1` once you
  press `Enter` or leave the row (see **Sliders made for you** below).

## Using it

- **Graph:** drag to pan, use the wheel or pinch to zoom, double-click to zoom in, and the buttons
  at the top right zoom in and out, fit and reset the view. With the graph focused, the keyboard
  works too: arrows pan, `+` and `-` zoom, `0` resets.
- **Zoom to fit:** the button between zoom out and reset (its icon a curve in a frame) flies to
  show every curve on the graph, with some room around and the same scale on both axes. A
  closed curve (a circle, a rose, a parametric loop, even a small one far away) and points are
  shown whole; a curve without end such as `y = x^3 - x` is shown by what is worth seeing of it
  over the x in view (where it crosses the axes, turns and ends), not by how high it climbs
  there, and `y = 1/x` without the far reaches of its pole. Such a curve is never zoomed in on
  closer than a quarter of what the home view shows across, so `y = x + 0.001` doesn't dive
  into its two intercepts a hair apart. Pressed again, it stays put (`y = sin(x)` doesn't creep
  outwards); with nothing on the graph it goes home like reset.
- **Framing new curves:** a curve that appears out of sight, such as `y = x + 100`, makes the
  graph glide over to it (along with what was in view, unless that is much farther away) once
  its row settles: you press Enter, leave the row, or stop typing for a second. What it is on
  the way doesn't count: typing `y = 12x` passes `y = 12`, out of sight, and the graph stays
  put; typing a circle far away doesn't fly off to `y = x − 50` halfway through. Only when a row
  first settles into a curve, and only when none of it shows: never for a slider moving, for a
  later edit to a curve (`y = x + 1`, left, then changed to `y = x + 100` stays where you put
  the view), for a curve brought back by undo, or within two seconds of you moving the view
  yourself. A curve without end is brought into view at the scale you had; a closed one is
  shown whole.
- **Trace:** hover a curve to see its coordinates, in a pill with the curve's color; its row in the
  list lights up faintly. On touch, tap a curve to pin the trace; with a mouse, click the selected
  curve (the first click on a curve selects it). Near a point of interest the
  trace snaps to it and names it ("Root", "Minimum", "Intersection with ● y = x/3"), and its ring
  grows. Where curves cross, the trace stays on the selected one. To scrub along a curve on
  touch, drag the pinned trace's dot, or press and hold on a curve for a moment (the dot grows)
  and then drag; any other drag pans, and a tap next to the pinned dot is still a tap. `Esc`
  lets go of a pinned trace along with the selection. On a pinned point of a curve `y = f(x)` (or
  `x = f(y)`), two buttons by the coordinates add a row below the curve's: **Tangent here** adds
  the tangent line there, as `y = 2.828(x - 1.414)`, and **Keep point** adds the point, as
  `(1.414, 0)`, written the way the pill shows the numbers (the slope as precisely as the view
  needs, however far out it is zoomed). There is no tangent at a corner like `|x|` at 0, nor on
  a straight line, which is its own. A second tap adds nothing more, and on touch a toast offers
  to undo it. The pill moves below the point near the top of the graph, and keeps clear of the
  zoom buttons.
- **The selected curve:** the selected row's curve is drawn on top, a little bolder, with a soft
  halo. Clicking or tapping a curve selects its row (it scrolls into view and pulses briefly)
  without opening it for editing, so no keypad pops up; a click a little away from every curve
  deselects. Pointing at a row in the list brings its curve forward the same way while the
  pointer rests there.
- **Points of interest:** the selected curve shows its roots (including where it ends on the
  axis, as `sqrt(4 - x^2)` does at ±2), local maxima and minima, where it crosses the axes and
  where it meets the other curves, as grey rings that bloom in once found. Hover or click one (or
  tap it) to see what it is; clicking a ring pins the trace there, while clicking elsewhere on a
  curve only selects it (a click on the selected curve pins it there). From the graph, `Tab`
  reaches them and the arrow keys walk from one to the next. Only what is in view is shown, and
  only while it stays readable: kinds of points that would crowd the graph are left out whole,
  extrema first and then crossings of the axes (zoomed out on `sin(x)`, its extrema go, then its
  roots), until you zoom in. While you type in the selected row, its rings stay, faded, until the
  new ones are found.
- **Insights:** a moment after a row settles, a quiet line fades in under it saying what its
  curve is, and nothing it can't check: every model is fitted on a few samples and then held to
  the curve at many more, near and far. It is always one line, so rows keep their height
  whatever it says; what doesn't fit fades out at its end (widen the list to see more, or Tab
  along its chips).
  - `y = f(x)` (and `x = f(y)`): an exact polynomial up to degree 4 (a horizontal or vertical
    line, a line with its slope and intercepts, a parabola with its vertex, roots and axis, a
    cubic or quartic with its roots and turning points, a double or triple root named once), an
    exponential `a·bˣ + c` (its base,
    asymptote and intercept), a periodic function (its period, from the arguments of its `sin`,
    `cos`, `tan`… and checked as f(x + P) = f(x), its amplitude and midline; "Sine wave" when it
    is one). Otherwise the selected row counts what is in view ("In view: 3 roots, 2 turning
    points", or its vertical asymptotes, such as `x = 0` for `y = 1/x`).
  - An implicit equation: a circle (centre, radius), an ellipse (centre, semi-axes, tilt), a
    hyperbola (centre, vertices, asymptotes), a parabola (vertex, axis), a line, two lines.
  - `r = f(θ)`: a circle, a cardioid, a limaçon (with an inner loop, dimpled or convex), a rose
    with its number of petals, an Archimedean spiral; only when the θ range draws it whole.
  - A parametric curve: a segment, a circle or an ellipse, else whether it is closed.
  - A slider, a variable or a function: "Used by ● y = a sin(x)", the rows that use it (the
    first three, then "+2 more"). A function of x is drawn too, so `f(x) = x^2` also says it is
    a parabola.
  - The selected row also says where it meets the other curves, right after what the curve is
    first: "meets ● y = x/3 at 3 points", each point once even where they only touch (exactly
    for two polynomials, first; otherwise counted in view), the first three and then "meets 2
    more curves".
  - Values at a point are chips: click or tap one ("Vertex (0, −2)") and the graph flies there
    and pins the trace on it; a circle's centre is flown to without a pin. Numbers have four
    significant digits and multiples of π read as such (`2π`).
  - The line dims while you type a change and updates once you pause; a row with an error, or a
    hidden curve, has none. While a slider plays, the lines that depend on it keep up a few times
    a second, and a row typed or changed meanwhile is read as usual; what was counted in view
    waits, dimmed, for the graph to count again once the slider stops. Values (`2^10`) keep
    showing `= 1024` instead.
- **Typeset math:** rows you aren't editing show their math typeset, as in a textbook: stacked
  fractions, raised exponents (and `x²` typed with a superscript), subscripts, square and cube
  roots under a radical sign, parentheses and `|x|` bars that grow around a fraction, function
  names upright and letters in italic, `≤` `≥` `−` `·` `π` `θ` for `<=` `>=` `-` `*` `pi` `theta`
  (only on screen: the text stays as typed). Letters group the way the graph reads them, so
  `asin(x)` shows as a·sin once there is a slider `a`, and `pix` as πx. Click or tap a symbol to
  put the caret right there (see **Editing math**). Slider bounds and t/θ ranges show typeset too
  (`2pi` as 2π) and are edited as plain text. A row with an error underlines the mistake in the
  typeset math too: a missing part (`y = 2 +`, `x^`) shows as a faint box, a parenthesis
  you haven't closed stays visible (`y = 1/(x`), and numbers missing an operator between them
  stay apart (`2 3`). Exponents rise clear of the baseline, even a fraction (`e^(-x^2/2)`), and
  `a_1^2` stacks the 2 over the 1. The color mark and the row's buttons line up with the math's
  main line, however tall a fraction makes the row. The empty first row shows "Try y = sin(x)".
  A row too long for the list fades out at its end (checked again as the list's width changes);
  absurdly deep nesting (`1/x/x/…` dozens of levels down) shows as plain text past 64 levels.
- **Editing math:** a row is edited where it is typeset, with a caret in the row's color that
  glides through the math and blinks once you stop typing. The text underneath stays plain math
  (`1/(2x)`), which is what copy and paste use, and what you type stays where the caret is:
  - `/` makes a fraction of what is before the caret (with nothing there, an empty numerator
    first) and puts the caret in the denominator; `^` starts an exponent, and `_` a subscript
    right after a letter. With a selection, `/` and `^` take it as the numerator or the base, and
    `(` and `|` put it in parentheses or bars. Empty places show as faint boxes.
  - Typing goes on in the denominator or exponent you are in: `1/2x` typed key by key becomes
    `1/(2x)` and `e^2x` becomes `e^(2x)`, with parentheses added only where the math needs them.
    `+`, `-`, `=`, `<`, `>` and `,` at the end of an exponent or subscript leave it first, so
    `x^2+1` reads as typed (after an operator, `x^(2*-1`, a sign stays in); `Space` leaves an
    exponent or subscript too (elsewhere it is a space, and inside a fraction's part or an
    exponent it keeps that part together). `→` leaves a denominator. A function's power is one
    number or name, so `sin^2(x)` and `sin^2x` read as typed. A function's name typed into a
    denominator or exponent needs no parentheses (`1/sin(x)`, `e^sin(x)`), and right after a
    `)` that closes a denominator, `^` and `!` go on it as the text reads: `1/(x+1)^2`.
  - `(` shows its `)` faintly until you type it, or press `→` at the end of the group; `)` and
    `|` step over a closer that is already there, and at the end of a denominator or exponent
    they close the group around the fraction (`(1/2x)` typed key by key is `(1/(2x))`). Typing
    `sqrt` or `cbrt` opens its parentheses, and a `(` typed right after is that one, so
    `sqrt(x)+1` reads as typed. In a subscript, `{` and `}` are the editor's (`x_{10}` is
    `x_10`). `=` after `=` is ignored, `=<` and `=>` become `<=` and `>=`, and a dash `—` is a
    minus.
  - What you type right after a fraction whose denominator is still empty (`y = 1/`, after `End`
    or a paste) goes into that denominator.
  - `←` and `→` walk through the math (into a numerator, on into its denominator, then out), `↑`
    and `↓` go between numerator and denominator and in and out of exponents (and on to the row
    above or below when there is nowhere else to go), `Home` and `End` go to the row's start and
    end. With `Shift` they select, and so does dragging the mouse across the math; a selection
    takes whole fractions and exponents. A double click selects the number or name under it.
    Moving to the row above or below keeps the caret where it is on screen.
  - `Backspace` at the start of a numerator, denominator, exponent, subscript, radical or
    parentheses takes that structure apart and keeps what it held (`x^‸2` becomes `x2`); right
    after one, it steps inside. Function names, `π`, `<=` and `x²` go as one symbol, and an
    exponent or subscript left empty goes away when you move the caret out of it (with the
    arrows or a click).
  - Pasted text goes in exactly as written. So does text from an input method (IME), except a
    word or number a phone keyboard composes (or a single character), which goes through the
    typing rules like keys.
  - A long row scrolls sideways to keep the caret in view; a wheel, a trackpad or a finger
    sliding sideways scrolls it too. The caret stays where it was when the row loses focus and
    gets it back (the keypad toggle, another window).
  - Adding `?plain` to the app's address (`…/graphing-calc/?plain`) edits rows as plain text
    instead, typeset only once you leave them: a way out if a browser or a keyboard app has
    trouble with the editor. It is remembered (an app installed on a phone keeps it); `?plain=0`
    turns it off.
- **Rows:**
  - `Enter` starts a new row. On an empty row it moves on to the next one instead, and on the
    empty row at the end it stays put (the keypad's ↵ puts the keypad away there).
  - `Backspace` on an empty row deletes it (on the empty row at the end it just moves up).
  - `↑` and `↓` move between rows (once there is no fraction or exponent to move into).
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
  - Errors show as one line under the row after a pause in typing, with the mistake underlined
    (letters nothing defines, in the row you are typing in, are offered as sliders instead: see
    **Sliders made for you**).
  - Half-typed math doesn't make the graph flicker: while the row you are typing in is broken
    for a moment (`y = x^` on the way to `y = x^2`), its curve stays as a faint ghost and its
    color dot, slider or value stay in place. Curves it breaks along the way (retyping a slider
    they use) do the same, and their errors wait until you leave the row.
- **Sliders:** drag the thumb (its value shows above it, except under the row's own text, which
  shows it too) or press play. The min and max under the
  track's ends are fields you can edit; the step field appears while the row is being edited.
  Typing a value past a bound that is a plain number moves the bound out to it.
- **Sliders made for you:** letters a row uses that nothing defines (`m` and `b` in
  `y = m x + b`) become sliders `m = 1` and `b = 1` right below it when you press `Enter` (the new
  row for your next expression comes after them), when you leave the row (once the click that
  left it has landed), or when you pause typing for a moment and the caret isn't on a name. The
  new rows pulse once, and a toast says "Added sliders m, b" with an Undo button; `Ctrl+Z` undoes
  them too, in one step, and the row keeps its caret. Meanwhile, the letters are offered quietly
  as an "Add sliders: m, b" chip under the row (no error; not the name you are still typing),
  which adds them at once. A pause makes none while the letters just before the caret may be on
  their way to a function (`s` before `sin`, a space away too; leaving the row or `Enter` makes
  them). A name called like a function still to define is never made one: `f`, `g` or `h`
  before `(`, or any name given just names, as in `F(x)`; `a(x - h)^2` is a product, so `a`,
  `h` and `k` in `y = a(x - h)^2 + k` all become sliders. Nor is a name in a slider's bounds or a
  t range, and switching to another window or app mid-name makes nothing. Sliders you undo or
  delete, or add with the chip and undo, aren't made again for that row; it says the name is not
  defined instead, with the chip. An undo or redo never makes sliders by itself either. A slider
  made this way that you type a value into beyond its range takes a round range around it
  instead of just widening (`a = 50` gives 0 to 100, `a = -3` gives -10 to 0), until you set its
  bounds yourself.
- **Completions:** typing the first two or more letters of a function's name (a built-in one or
  one you defined, such as `area(r)`) shows the rest of it faintly after the caret, with its
  parenthesis: `si` shows `n(`. `Tab` or `→` (the keypad's `→` too) takes it; anything else
  carries on as usual, so the suggestion never gets typed by itself, and holding `→` down only
  moves the caret. Taken inside parentheses (`sqrt(si)`), it adds the call's own `)` too, so the
  group around keeps its closer: `sqrt(sin())`. Letters that already read as names (`ex` is e·x,
  `ab` with sliders a and b) are left alone.
- **Fixes:** when an error's hint names a rewrite, the rewrite is offered as a chip on the error
  line, set as math (`x²`, `≤`): `x2` → `x^2` or `2x`, `=<` → `<=`, `==` → `=`, `2e3` →
  `2*10^3`, `sin^-1(x)` → `asin(x)`, `a = x^2` → `a(x) = x^2`, `log_2(x)` → `log(x)/log(2)`
  (`_` after `log` types its base). The hint then only says what the chips don't. Click a chip,
  or press `Tab` in a row you have typed in to take the first one (and the sliders chip the same
  way); `Tab` moves on as usual otherwise. A fix is one undo step of its own (typing after it is
  another), and the caret stays where it was.
- **Undo:** `Ctrl+Z` (`⌘Z` on a Mac) undoes and `Ctrl+Shift+Z` (`⌘⇧Z`) or `Ctrl+Y` redoes, from
  anywhere in the app. Typing undoes in bursts, and deleting is a burst of its own, so text
  deleted or typed over right after it was typed comes back. A slider drag is one step, arrow
  keys on a slider undo like typing, and a playing slider adds none (undoing something else
  leaves it where it is). Undo puts the caret back where the change was (in the denominator it
  was in, not after the fraction); a change made outside
  the rows (delete, a color, New graph) is scrolled into view. Phones have no undo key yet: **New
  graph**, deleting a row by touch, sliders made for you and rows the trace adds show an Undo
  button for a few seconds instead (it waits while you point at it or it has focus).
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
  transitions, the zoom animation (and the flights to fit, frame or follow a chip) and the
  points of interest's bloom are skipped.
- **Math keypad:** on touch devices, tapping a row opens the built-in keypad, which has three pages:
  numbers, functions and letters. The keyboard key on the letters page switches that row to the
  device keyboard, and the keyboard button in the header switches modes for good. Tapping the
  graph or the chevron hides the keypad; on a phone held sideways, the list and keypad sit beside
  the graph. On desktop the keypad is off by default and can be turned on from the header. Its
  keys edit the way typing does: `÷` starts a fraction and `aᵇ` an exponent, `a²` squares what is
  before the caret and carries on after the exponent, and `←` `→` walk through the math.

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
                  interest, the trace's tangent lines, exact fits and what they say about a
                  curve (insights), where a curve is (bounds, for fitting and framing) (pure TS)
src/keypad/       on-screen keypad layouts and text-editing logic (pure TS)
src/mathedit/     typeset rows: a tolerant parse that reads text exactly as the engine does,
                  the render plan (boxes, spacing, error marks), caret stops, the editing
                  commands, which splice the text and check where it landed, and the
                  completions of function names (pure TS)
src/render/       canvas drawing and the render loop
src/interaction/  pan / zoom / pinch gestures
src/state/        Solid stores and signals; the undo history core, the autosave format, what
                  stays steady while typing and which unknown names become sliders are plain TS
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
