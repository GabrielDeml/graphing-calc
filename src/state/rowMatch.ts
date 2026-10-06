/**
 * Which of this window's rows each row another window saved continues, by id. Rows whose text is
 * unchanged keep theirs (the longest run in common, in order), wherever the other window put
 * rows before them; between two of those, rows that changed take the ids of the rows they
 * replaced, in order. Any beyond those are new (undefined).
 */
export function matchRowIds(
  saved: readonly string[],
  current: readonly { id: string; source: string }[],
): (string | undefined)[] {
  const n = saved.length;
  const m = current.length;
  // common[i * (m + 1) + j]: how many rows saved[i…] and current[j…] have in common, in order.
  const w = m + 1;
  const common = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i * w + j] =
        saved[i] === current[j].source
          ? common[(i + 1) * w + j + 1] + 1
          : Math.max(common[(i + 1) * w + j], common[i * w + j + 1]);
    }
  }
  const ids: (string | undefined)[] = new Array(n).fill(undefined);
  // The rows since the last ones in common: changed ones, paired up in order.
  let fromI = 0;
  let fromJ = 0;
  const pairChanged = (toI: number, toJ: number) => {
    for (let k = 0; fromI + k < toI && fromJ + k < toJ; k++) ids[fromI + k] = current[fromJ + k].id;
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (saved[i] === current[j].source) {
      pairChanged(i, j);
      ids[i] = current[j].id;
      i++;
      j++;
      fromI = i;
      fromJ = j;
    } else if (common[(i + 1) * w + j] >= common[i * w + j + 1]) i++;
    else j++;
  }
  pairChanged(n, m);
  return ids;
}
