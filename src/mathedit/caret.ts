// Where a caret can stand in a typeset row. The text stays the model, so a caret is a source
// offset; `depth` (how many fractions, scripts, radicals and groups it is inside) tells apart the
// places one offset can mean: at the end of `2x/3` the caret is either at the end of the
// denominator (depth 1) or after the fraction (depth 0). Each stop is unique by
// {offset, depth}.

import type { AtomBox, Block, Box, Plan } from './plan';

/** A caret position: a source offset, and how deep in the typeset structure it stands. */
export interface Caret {
  offset: number;
  depth: number;
}

export interface CaretStop extends Caret {
  /** The block the caret is in. */
  block: Block;
  /** Index in block.boxes of the box after the caret (block.boxes.length at its end). */
  index: number;
  /** The atom whose characters the caret is between (`1‸23`, `a‸_1`). */
  inside?: AtomBox;
}

export interface CaretStops {
  /** In visual order: left to right, a numerator before its denominator. */
  list: CaretStop[];
  /** The stop at {offset, depth}, if there is one. */
  at(offset: number, depth: number): CaretStop | undefined;
  /** Every stop at an offset, shallowest first. */
  atOffset(offset: number): readonly CaretStop[];
}

function isSpace(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || (c >= 0x2000 && c <= 0x200b);
}

/**
 * Every caret stop of a plan: the start and end of each block and each gap between its boxes,
 * the places between the characters of numbers and long names, and each typed space between
 * boxes (the text is the model, so `y = ‸x` and `y =‸ x` are different places). There is no stop
 * after a box that runs to the end of an unclosed group: text typed there would land inside the
 * group. Exponents written as superscript characters (`x²`) take no caret inside.
 */
export function caretStops(plan: Plan): CaretStops {
  const { source } = plan;
  const list: CaretStop[] = [];
  const byKey = new Map<string, CaretStop>();
  const byOffset = new Map<number, CaretStop[]>();
  const push = (stop: CaretStop) => {
    const key = `${stop.offset}:${stop.depth}`;
    // A slot has no width: the places before and after it are one.
    if (byKey.has(key)) return;
    byKey.set(key, stop);
    list.push(stop);
    const same = byOffset.get(stop.offset);
    if (same) same.push(stop);
    else byOffset.set(stop.offset, [stop]);
  };

  /** Stops after each space in source[from, to), all before box `index`. */
  const spaces = (from: number, to: number, block: Block, index: number) => {
    for (let o = from + 1; o <= to && isSpace(source.charCodeAt(o - 1)); o++) {
      push({ offset: o, depth: block.depth, block, index });
    }
  };

  const visitBlock = (block: Block) => {
    const { boxes, depth } = block;
    push({ offset: block.start, depth, block, index: 0 });
    let gap = block.start;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i] as Box;
      spaces(gap, box.span.start, block, i);
      visitBox(box, block, i);
      if (box.unclosed) return;
      push({ offset: box.span.end, depth, block, index: i + 1 });
      gap = box.span.end;
    }
    if (boxes.length === 0) push({ offset: block.end, depth, block, index: 0 });
    // The block's end is past any spaces after its last box.
    spaces(gap, block.end, block, boxes.length);
  };

  const visitBox = (box: Box, block: Block, index: number) => {
    switch (box.kind) {
      case 'atom': {
        const end = box.subStart ?? box.span.end;
        if (box.chars) {
          for (let o = box.span.start + 1; o < end; o++) {
            push({ offset: o, depth: block.depth, block, index, inside: box });
          }
        }
        if (box.sub) {
          push({ offset: end, depth: block.depth, block, index, inside: box });
          visitBlock(box.sub);
        }
        break;
      }
      case 'frac':
        visitBlock(box.num);
        visitBlock(box.den);
        break;
      case 'sup':
        if (!box.atomic) visitBlock(box.body);
        break;
      case 'radical':
      case 'fence':
        visitBlock(box.body);
        break;
      case 'slot':
        break;
    }
  };

  visitBlock(plan.root);
  for (const same of byOffset.values()) same.sort((a, b) => a.depth - b.depth);
  return {
    list,
    at: (offset, depth) => byKey.get(`${offset}:${depth}`),
    atOffset: (offset) => byOffset.get(offset) ?? [],
  };
}

/**
 * The stop for a caret that may not be one: at its offset, the stop at its depth, else the
 * deepest one above it, else the shallowest below; with no stop at its offset, the nearest
 * offset that has one (the later one on a tie). Always a stop (every plan has one at 0).
 */
export function resolveCaret(stops: CaretStops, offset: number, depth: number): CaretStop {
  let same = stops.atOffset(offset);
  if (same.length === 0) {
    let best: CaretStop | undefined;
    for (const st of stops.list) {
      if (
        !best ||
        Math.abs(st.offset - offset) < Math.abs(best.offset - offset) ||
        (Math.abs(st.offset - offset) === Math.abs(best.offset - offset) && st.offset > best.offset)
      ) {
        best = st;
      }
    }
    same = best ? stops.atOffset(best.offset) : [];
  }
  let pick: CaretStop | undefined;
  for (const st of same) if (st.depth <= depth) pick = st;
  return (pick ?? same[0] ?? stops.list[0]) as CaretStop;
}
