// Where a caret can stand in a typeset row. The text stays the model, so a caret is a source
// offset; `depth` (how many fractions, scripts, radicals and groups it is inside) tells apart the
// places one offset can mean: at the end of `2x/3` the caret is either at the end of the
// denominator (depth 1) or after the fraction (depth 0). Each stop is unique by
// {offset, depth}.

import type { AtomBox, Block, Box, Plan } from './plan';

export interface CaretStop {
  offset: number;
  depth: number;
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
}

/**
 * Every caret stop of a plan: the start and end of each block and each gap between its boxes,
 * and the places between the characters of numbers and long names. There is no stop after a
 * box that runs to the end of an unclosed group: text typed there would land inside the group.
 * Exponents written as superscript characters (`x²`) take no caret inside.
 */
export function caretStops(plan: Plan): CaretStops {
  const list: CaretStop[] = [];
  const byKey = new Map<string, CaretStop>();
  const push = (stop: CaretStop) => {
    const key = `${stop.offset}:${stop.depth}`;
    // A slot has no width: the places before and after it are one.
    if (byKey.has(key)) return;
    byKey.set(key, stop);
    list.push(stop);
  };

  const visitBlock = (block: Block) => {
    const { boxes, depth } = block;
    push({ offset: block.start, depth, block, index: 0 });
    boxes.forEach((box, i) => {
      visitBox(box, block, i);
      if (box.unclosed) return;
      // The block's end is past any spaces after its last box, except after an empty place:
      // the caret then stays in it.
      const last = i === boxes.length - 1 && box.kind !== 'slot';
      const offset = last ? Math.max(block.end, box.span.end) : box.span.end;
      push({ offset, depth, block, index: i + 1 });
    });
    if (boxes.length === 0) push({ offset: block.end, depth, block, index: 0 });
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
  return { list, at: (offset, depth) => byKey.get(`${offset}:${depth}`) };
}
