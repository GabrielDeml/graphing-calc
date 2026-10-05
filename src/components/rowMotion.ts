import { DUR_2, EASE_OUT, reducedMotion } from '../state/motion';

/**
 * Rows coming and going: a new row opens to its height as it fades in, a removed one leaves a
 * blank space that closes, so the rows around them slide instead of jumping. Not for the rows
 * the list opens with (see armRowMotion), nor when motion is reduced.
 */
let armed = false;

/** From the frame after the list first shows, rows added or removed are animated. */
export function armRowMotion(): void {
  requestAnimationFrame(() => {
    armed = true;
  });
}

function animates(el: HTMLElement): boolean {
  return armed && !reducedMotion() && typeof el.animate === 'function';
}

/** A row just added: it opens from nothing (WAAPI; no style attributes, which the CSP forbids). */
export function enterRow(el: HTMLElement): void {
  if (!animates(el)) return;
  const height = el.getBoundingClientRect().height;
  if (!(height > 0)) return;
  const { paddingTop, paddingBottom } = getComputedStyle(el);
  el.classList.add('entering');
  const animation = el.animate(
    [
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      { height: `${height}px`, paddingTop, paddingBottom, opacity: 1 },
    ],
    { duration: DUR_2, easing: EASE_OUT },
  );
  // Scrolled into view as it opens (Enter made it, an undo brought it back: see focus.ts
  // revealRow): it stays in view, frame by frame, as it grows to its height.
  const follow = () => {
    if (!el.classList.contains('entering')) return;
    if (el.hasAttribute('data-reveal')) el.scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  const done = () => {
    el.classList.remove('entering');
    if (el.isConnected && el.hasAttribute('data-reveal')) el.scrollIntoView({ block: 'nearest' });
    el.removeAttribute('data-reveal');
  };
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
}

/**
 * A row about to be removed (still in place): a blank stand-in of its height and wash takes its
 * place and closes. Only a stand-in: nothing in it can be found, pressed or read out.
 */
export function leaveRow(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent || !el.isConnected || !animates(el)) return;
  const height = el.getBoundingClientRect().height;
  if (!(height > 0)) return;
  const gone = document.createElement('li');
  gone.className = 'expr-row-gone';
  gone.setAttribute('aria-hidden', 'true');
  gone.style.height = `${height}px`;
  gone.style.backgroundColor = getComputedStyle(el).backgroundColor;
  parent.insertBefore(gone, el);
  const animation = gone.animate(
    [
      { height: `${height}px`, opacity: 1 },
      { height: '0px', opacity: 0 },
    ],
    { duration: DUR_2, easing: EASE_OUT },
  );
  const remove = () => gone.remove();
  animation.addEventListener('finish', remove);
  animation.addEventListener('cancel', remove);
}
