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
  const done = () => {
    el.classList.remove('entering');
    // Focused as it opened (Enter made it): in view now that it has its height.
    if (el.isConnected && el.contains(document.activeElement)) {
      el.scrollIntoView({ block: 'nearest' });
    }
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
