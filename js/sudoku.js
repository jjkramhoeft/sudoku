/* Sudoku core: solver, difficulty rater and generator. Works in window and worker scopes. */
(function (root) {
  'use strict';

  const ROW = [], COL = [], BOX = [], UNITS = [], PEERS = [];
  for (let i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
  }
  for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = ((b / 3) | 0) * 3, c0 = (b % 3) * 3;
    UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));
  }
  for (let i = 0; i < 81; i++) {
    const s = new Set();
    for (const u of [UNITS[ROW[i]], UNITS[9 + COL[i]], UNITS[18 + BOX[i]]]) for (const j of u) if (j !== i) s.add(j);
    PEERS.push([...s]);
  }

  const ALL = 0x3fe; // bits 1..9
  const POP = new Uint8Array(1024);
  for (let m = 1; m < 1024; m++) POP[m] = POP[m >> 1] + (m & 1);
  const low = (m) => 31 - Math.clz32(m & -m);

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* Backtracking solver with bitmasks. Stops after `limit` solutions. */
  function solve(grid, limit = 2, random = false) {
    const g = Array.from(grid);
    const rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    for (let i = 0; i < 81; i++) {
      const d = g[i];
      if (!d) continue;
      const b = 1 << d;
      if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return { count: 0, solution: null };
      rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
    }
    let count = 0, solution = null;

    function rec() {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
        const n = POP[m];
        if (n === 0) return false;
        if (n < bestN) { best = i; bestMask = m; bestN = n; if (n === 1) break; }
      }
      if (best < 0) {
        count++;
        if (!solution) solution = g.slice();
        return count >= limit;
      }
      const digits = [];
      for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
      if (random) shuffle(digits);
      const r = ROW[best], c = COL[best], x = BOX[best];
      for (const d of digits) {
        const b = 1 << d;
        g[best] = d; rows[r] |= b; cols[c] |= b; boxes[x] |= b;
        if (rec()) return true;
        g[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[x] &= ~b;
      }
      return false;
    }

    rec();
    return { count, solution };
  }

  /* ---------- Human-style rater ----------
     1 = singles, 2 = locked candidates / pairs, 3 = triples / x-wing, 4 = harder */

  function combos(arr, k, fn, start = 0, acc = []) {
    if (acc.length === k) { fn(acc); return; }
    for (let i = start; i <= arr.length - (k - acc.length); i++) {
      acc.push(arr[i]);
      combos(arr, k, fn, i + 1, acc);
      acc.pop();
    }
  }

  function lockedCandidates(cand) {
    let changed = false;
    for (let bx = 0; bx < 9; bx++) {
      const u = UNITS[18 + bx];
      for (let d = 1; d <= 9; d++) {
        const b = 1 << d;
        let rm = 0, cm = 0, n = 0;
        for (const i of u) if (cand[i] & b) { rm |= 1 << ROW[i]; cm |= 1 << COL[i]; n++; }
        if (n < 2) continue;
        if (POP[rm] === 1) for (const j of UNITS[low(rm)]) if (BOX[j] !== bx && cand[j] & b) { cand[j] &= ~b; changed = true; }
        if (POP[cm] === 1) for (const j of UNITS[9 + low(cm)]) if (BOX[j] !== bx && cand[j] & b) { cand[j] &= ~b; changed = true; }
      }
    }
    for (let ui = 0; ui < 18; ui++) {
      const u = UNITS[ui];
      for (let d = 1; d <= 9; d++) {
        const b = 1 << d;
        let bm = 0, n = 0;
        for (const i of u) if (cand[i] & b) { bm |= 1 << BOX[i]; n++; }
        if (n < 2 || POP[bm] !== 1) continue;
        for (const j of UNITS[18 + low(bm)]) {
          const inLine = ui < 9 ? ROW[j] === ui : COL[j] === ui - 9;
          if (!inLine && cand[j] & b) { cand[j] &= ~b; changed = true; }
        }
      }
    }
    return changed;
  }

  function subsets(cand, k) {
    let changed = false;
    for (const u of UNITS) {
      const cells = u.filter((i) => cand[i]);
      if (cells.length <= k) continue;
      combos(cells, k, (set) => {
        let m = 0;
        for (const i of set) m |= cand[i];
        if (POP[m] !== k) return;
        for (const i of cells) if (!set.includes(i) && cand[i] & m) { cand[i] &= ~m; changed = true; }
      });
      const digits = [];
      for (let d = 1; d <= 9; d++) if (cells.some((i) => cand[i] & (1 << d))) digits.push(d);
      combos(digits, k, (ds) => {
        let dm = 0;
        for (const d of ds) dm |= 1 << d;
        const where = cells.filter((i) => cand[i] & dm);
        if (where.length !== k) return;
        for (const i of where) if (cand[i] & ~dm) { cand[i] &= dm; changed = true; }
      });
    }
    return changed;
  }

  function xWing(cand) {
    let changed = false;
    for (let d = 1; d <= 9; d++) {
      const b = 1 << d;
      for (const byRow of [true, false]) {
        const lines = [];
        for (let l = 0; l < 9; l++) {
          let m = 0;
          for (let k = 0; k < 9; k++) if (cand[byRow ? l * 9 + k : k * 9 + l] & b) m |= 1 << k;
          if (POP[m] === 2) lines.push([l, m]);
        }
        for (let a = 0; a < lines.length; a++) {
          for (let c = a + 1; c < lines.length; c++) {
            if (lines[a][1] !== lines[c][1]) continue;
            const m = lines[a][1];
            for (let k = 0; k < 9; k++) {
              if (!(m & (1 << k))) continue;
              for (let l = 0; l < 9; l++) {
                if (l === lines[a][0] || l === lines[c][0]) continue;
                const i = byRow ? l * 9 + k : k * 9 + l;
                if (cand[i] & b) { cand[i] &= ~b; changed = true; }
              }
            }
          }
        }
      }
    }
    return changed;
  }

  function rate(puzzle) {
    const g = Array.from(puzzle);
    const cand = new Int32Array(81);
    let empty = 0;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      empty++;
      let m = ALL;
      for (const p of PEERS[i]) if (g[p]) m &= ~(1 << g[p]);
      cand[i] = m;
    }
    const place = (i, d) => {
      g[i] = d; cand[i] = 0; empty--;
      const nb = ~(1 << d);
      for (const p of PEERS[i]) cand[p] &= nb;
    };

    let level = 0;
    while (empty > 0) {
      let did = false;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = cand[i];
        if (!m) return 99;
        if (POP[m] === 1) { place(i, low(m)); did = true; }
      }
      if (!did) {
        for (const u of UNITS) {
          for (let d = 1; d <= 9; d++) {
            const b = 1 << d;
            let where = -1, n = 0;
            for (const i of u) if (cand[i] & b) { n++; where = i; }
            if (n === 1) { place(where, d); did = true; }
          }
        }
      }
      if (did) { level = Math.max(level, 1); continue; }
      if (lockedCandidates(cand) || subsets(cand, 2)) { level = Math.max(level, 2); continue; }
      if (subsets(cand, 3) || xWing(cand)) { level = Math.max(level, 3); continue; }
      return 4;
    }
    return level;
  }

  /* ---------- Generator ---------- */

  const LEVELS = {
    easy:    { givens: 40, min: 1, max: 1 },
    medium:  { givens: 33, min: 1, max: 1 },
    hard:    { givens: 28, min: 1, max: 2 },
    expert:  { givens: 25, min: 2, max: 3 },
    master:  { givens: 24, min: 3, max: 4 },
    extreme: { givens: 21, min: 4, max: 4 },
  };

  function attempt(cfg) {
    const solution = solve(new Array(81).fill(0), 1, true).solution;
    const p = solution.slice();
    let givens = 81;
    for (const i of shuffle(Array.from({ length: 81 }, (_, k) => k))) {
      if (givens <= cfg.givens) break;
      const v = p[i];
      p[i] = 0;
      if (solve(p, 2).count !== 1 || (cfg.max < 4 && rate(p) > cfg.max)) p[i] = v;
      else givens--;
    }
    return { puzzle: p, solution, level: rate(p), givens };
  }

  function generate(diff, budgetMs = 4000) {
    const cfg = LEVELS[diff] || LEVELS.easy;
    const t0 = Date.now();
    let best = null, bestCost = Infinity;
    do {
      const r = attempt(cfg);
      const off = r.level < cfg.min ? cfg.min - r.level : r.level > cfg.max ? r.level - cfg.max : 0;
      const extra = Math.max(0, r.givens - cfg.givens - 2);
      const cost = off * 100 + extra;
      if (cost === 0) return r;
      if (cost < bestCost) { best = r; bestCost = cost; }
    } while (Date.now() - t0 < budgetMs);
    return best;
  }

  root.Sudoku = { ROW, COL, BOX, UNITS, PEERS, LEVELS, solve, rate, generate };
})(typeof self !== 'undefined' ? self : this);
