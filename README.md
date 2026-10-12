# Sudoku

A clean, static Sudoku game in six difficulty levels (Easy → Extreme). No build step, no dependencies.

## Features

- Unique-solution puzzles, generated in the browser (Web Worker) and graded by solving technique
- Mistake limit (3), score with speed bonus, timer with pause, undo, erase, notes, 3 or 7 hints (setting)
- High scores per difficulty: today, this week and all time (stored in the browser)
- Win pictures: a random picture from r/Art by default; players can enter any subreddit in settings (NSFW off by default; pictures can be turned off entirely), with Picsum as fallback
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

## Win pictures

Browsers can't read Reddit directly, so the pictures are collected ahead of time into `pictures.json`
from the subreddits' RSS feeds (top posts of the month). A GitHub Actions workflow
(`.github/workflows/update-pictures.yml`) refreshes it daily and whenever the subreddit list changes.

To change the default sources, edit `tools/subreddits.txt` and push. A subreddit a player types in settings
that isn't in `pictures.json` is fetched live through [meme-api](https://meme-api.com), which only knows a
handful of current posts per subreddit, so its pictures repeat more often. To refresh by hand:

```bash
python tools/update_pictures.py
```
