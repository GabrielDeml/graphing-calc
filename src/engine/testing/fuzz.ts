// Random math source for fuzz and differential tests (parser, and later the typeset editor):
// token soup, grammar-shaped expressions and small mutations, from a seeded PRNG so failures
// reproduce. Test-only; nothing in the app imports it.

/** Small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plausible pieces of input, including Unicode forms and spacing. */
export const PIECES = [
  ...'0123456789',
  '.',
  '1.5',
  'x',
  'x',
  'y',
  'y',
  't',
  'r',
  'a',
  'b',
  'e',
  'E',
  'f',
  'g',
  'k',
  'sin',
  'cos',
  'ln',
  'max',
  'sqrt',
  'asin',
  'theta',
  'pi',
  'xy',
  'sinx',
  '(',
  '(',
  ')',
  ')',
  '|',
  '|',
  '^',
  '^',
  '!',
  ',',
  '=',
  '<',
  '>',
  '<=',
  '>=',
  '+',
  '-',
  '-',
  '*',
  '/',
  '**',
  ' ',
  ' ',
  ' ',
  'π',
  'θ',
  '√',
  'τ',
  '·',
  '−',
  '≤',
  '_1',
  '_{ab}',
];

/** Rare pieces that are always lexical errors (or odd lexical forms). */
export const JUNK = ['_', '==', '{', '[', '$', 'é', '😀', '\t', '..', '=<', '!='];

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

/** Random token soup: mostly plausible pieces, occasionally junk. */
export function randomSoup(rand: () => number): string {
  const count = 1 + Math.floor(rand() * 16);
  let source = '';
  for (let k = 0; k < count; k++) source += pick(rand, rand() < 0.02 ? JUNK : PIECES);
  return source;
}

export const ATOMS = ['x', 'y', 't', 'θ', 'a', 'b', 'e', 'pi', 'π', '2', '0.5', '10', 'a_1', 'xy'];
export const PREFIX_FNS = ['sin', 'cos', 'ln', 'sqrt', '√', 'exp', 'tanh', 'asin'];

/** Random well-formed-ish expression, built from the grammar's constructs. */
export function randomExpr(rand: () => number, depth: number): string {
  if (depth <= 0 || rand() < 0.25) return pick(rand, ATOMS);
  const a = () => randomExpr(rand, depth - 1);
  switch (Math.floor(rand() * 13)) {
    case 0:
      return `${a()} + ${a()}`;
    case 1:
      return `${a()}-${a()}`;
    case 2:
      return `${a()}*${a()}`;
    case 3:
      return `${a()}/${a()}`;
    case 4:
      return `${a()}^${a()}`;
    case 5:
      return `-${a()}`;
    case 6:
      return `(${a()})`;
    case 7:
      return `|${a()}|`;
    case 8:
      return `${pick(rand, PREFIX_FNS)} ${a()}`;
    case 9:
      return `${pick(rand, PREFIX_FNS)}(${a()})`;
    case 10:
      return `${a()}${a()}`;
    case 11:
      return `${a()}!`;
    default:
      return `(${a()}, ${a()})`;
  }
}

/** Deletes, duplicates or inserts a piece at a random position. */
export function mutate(rand: () => number, source: string): string {
  const at = Math.floor(rand() * (source.length + 1));
  const r = rand();
  if (r < 0.4) return source.slice(0, at) + source.slice(at + 1);
  if (r < 0.6) return source.slice(0, at) + source.slice(at, at + 3) + source.slice(at);
  return source.slice(0, at) + pick(rand, PIECES) + source.slice(at);
}

export function randomSource(rand: () => number): string {
  const r = rand();
  if (r < 0.4) return randomSoup(rand);
  let source = randomExpr(rand, 4);
  if (rand() < 0.3)
    source = `${pick(rand, ['y', 'x', 'r', 'a', 'f(x)'])} ${pick(rand, ['=', '<', '>=', '≤'])} ${source}`;
  if (rand() < 0.1) source = `(${source}, ${randomExpr(rand, 2)}), (1, 2)`;
  return rand() < 0.5 ? mutate(rand, source) : source;
}
