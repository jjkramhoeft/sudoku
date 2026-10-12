importScripts('sudoku.js');

self.onmessage = (e) => {
  const { id, diff } = e.data;
  const r = self.Sudoku.generate(diff);
  self.postMessage({ id, puzzle: r.puzzle, solution: r.solution });
};
