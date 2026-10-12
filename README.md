# Sudoku

A clean, static Sudoku game in six difficulty levels (Easy → Extreme). No build step, no dependencies.

## Features

- Unique-solution puzzles, generated in the browser (Web Worker) and graded by solving technique
- Mistake limit (3), score with speed bonus, timer with pause, undo, erase, notes, 3 hints
- High scores per difficulty: today, this week and all time (stored in the browser)
- Highlighting of row/column/box, identical numbers and duplicates
- Auto-save and resume, light/dark theme, keyboard support (1–9, arrows, Backspace, N, Ctrl+Z, Space)

## Run locally

Serve the folder over HTTP (the puzzle worker does not load from `file://`):

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`.
3. The game is served at `https://<user>.github.io/<repo>/`.
