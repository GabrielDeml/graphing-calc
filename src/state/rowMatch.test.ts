import { describe, expect, it } from 'vitest';
import { matchRowIds } from './rowMatch';

const rows = (...sources: string[]) => sources.map((source, i) => ({ id: `r${i}`, source }));

describe('matchRowIds', () => {
  it('keeps every id when nothing changed', () => {
    expect(matchRowIds(['y = x', 'y = 2x', ''], rows('y = x', 'y = 2x', ''))).toEqual([
      'r0',
      'r1',
      'r2',
    ]);
  });

  it('keeps the ids of the rows below one inserted elsewhere', () => {
    expect(matchRowIds(['y = x', 'k = 1', 'y = 2x', ''], rows('y = x', 'y = 2x', ''))).toEqual([
      'r0',
      undefined,
      'r1',
      'r2',
    ]);
  });

  it('a row edited keeps its id, and a slider made under it is new', () => {
    expect(
      matchRowIds(['y = x', 'y = 2x + k + 1', 'k = 1', ''], rows('y = x', 'y = 2x', '')),
    ).toEqual(['r0', 'r1', undefined, 'r2']);
  });

  it('keeps the ids of the rows left when one is removed', () => {
    expect(matchRowIds(['y = x', ''], rows('y = x', 'y = 2x', ''))).toEqual(['r0', 'r2']);
  });

  it('rows all changed keep the ids by place', () => {
    expect(matchRowIds(['a', 'b', 'c'], rows('x', 'y'))).toEqual(['r0', 'r1', undefined]);
  });

  it('copes with nothing on either side', () => {
    expect(matchRowIds([], rows('y = x'))).toEqual([]);
    expect(matchRowIds(['y = x'], [])).toEqual([undefined]);
  });
});
