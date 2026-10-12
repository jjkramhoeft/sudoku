(function () {
  'use strict';

  const S = window.Sudoku;
  const DIFFS = ['easy', 'medium', 'hard', 'expert', 'master', 'extreme'];
  const NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master', extreme: 'Extreme' };
  const POINTS = { easy: 50, medium: 75, hard: 100, expert: 150, master: 200, extreme: 250 };
  const PAR = { easy: 240, medium: 420, hard: 600, expert: 900, master: 1200, extreme: 1500 };
  const MAX_MISTAKES = 3;
  const MAX_HINTS = 3;
  const KEY_GAME = 'sudoku.game';
  const KEY_SETTINGS = 'sudoku.settings';
  const KEY_POOL = 'sudoku.pool';
  const KEY_SCORES = 'sudoku.scores';

  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_RESTART = '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

  const $ = (id) => document.getElementById(id);

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    },
  };

  /* ---------- Settings ---------- */

  const SETTINGS = [
    ['dark', 'Dark mode'],
    ['mistakeLimit', 'Mistake limit'],
    ['autoNotes', 'Auto-remove notes'],
    ['dupes', 'Highlight duplicates'],
    ['areas', 'Highlight areas'],
    ['same', 'Highlight identical numbers'],
    ['timer', 'Timer'],
  ];

  const settings = Object.assign({
    dark: window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches,
    mistakeLimit: true,
    autoNotes: true,
    dupes: true,
    areas: true,
    same: true,
    timer: true,
  }, store.get(KEY_SETTINGS, {}));

  function applyTheme() {
    document.documentElement.dataset.theme = settings.dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = settings.dark ? '#16191f' : '#ffffff';
  }

  /* ---------- High scores ---------- */

  function startOfDay(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function startOfWeek(t) {
    const d = new Date(startOfDay(t));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // weeks start on Monday
    return d.getTime();
  }

  const RANGES = [
    { key: 'day', name: 'Today', since: startOfDay, record: 'Best today' },
    { key: 'week', name: 'Week', since: startOfWeek, record: 'Best this week' },
    { key: 'all', name: 'All time', since: () => 0, record: 'New record' },
  ];

  const isBetter = (a, b) => !b || a.s > b.s || (a.s === b.s && a.t < b.t);

  function loadScores() {
    const list = store.get(KEY_SCORES, []);
    return Array.isArray(list) ? list.filter((e) => e && DIFFS.includes(e.d)) : [];
  }

  function bestScore(list, diff, since) {
    let best = null;
    for (const e of list) if (e.d === diff && e.at >= since && isBetter(e, best)) best = e;
    return best;
  }

  /* Saves a finished game and returns the widest range it is a new best for, if any. */
  function recordScore(entry) {
    const list = loadScores();
    let record = null;
    for (const r of RANGES) if (isBetter(entry, bestScore(list, entry.d, r.since(entry.at)))) record = r.record;
    list.push(entry);
    const weekStart = startOfWeek(entry.at);
    const keep = new Set(DIFFS.map((d) => bestScore(list, d, 0)));
    store.set(KEY_SCORES, list.filter((e) => e.at >= weekStart || keep.has(e)));
    return record;
  }

  /* ---------- Puzzle generation (worker with sync fallback) ---------- */

  function makeGenerator() {
    let worker = null;
    let seq = 0;
    const pending = new Map();
    const fallback = (job) => setTimeout(() => job.resolve(S.generate(job.diff)), 20);
    try {
      worker = new Worker('js/worker.js');
      worker.onmessage = (e) => {
        const job = pending.get(e.data.id);
        if (!job) return;
        pending.delete(e.data.id);
        job.resolve(e.data);
      };
      worker.onerror = (e) => {
        if (e.preventDefault) e.preventDefault();
        worker = null;
        for (const job of pending.values()) fallback(job);
        pending.clear();
      };
    } catch (e) {
      worker = null;
    }
    return {
      get ready() { return !!worker; },
      run(diff) {
        return new Promise((resolve) => {
          const job = { diff, resolve };
          if (!worker) return fallback(job);
          const id = ++seq;
          pending.set(id, job);
          worker.postMessage({ id, diff });
        });
      },
    };
  }

  const fg = makeGenerator();
  const bg = makeGenerator();
  let filling = false;

  function takePuzzle(diff) {
    const pool = store.get(KEY_POOL, {});
    const list = pool[diff] || [];
    if (list.length) {
      const p = list.shift();
      pool[diff] = list;
      store.set(KEY_POOL, pool);
      if (p && p.puzzle && p.puzzle.length === 81) return Promise.resolve(p);
    }
    return fg.run(diff);
  }

  async function fillPool() {
    if (filling || !bg.ready) return;
    filling = true;
    const order = [game.diff].concat(DIFFS.filter((d) => d !== game.diff));
    for (const d of order) {
      if ((store.get(KEY_POOL, {})[d] || []).length) continue;
      const r = await bg.run(d);
      const pool = store.get(KEY_POOL, {});
      (pool[d] = pool[d] || []).push({ puzzle: r.puzzle, solution: r.solution });
      store.set(KEY_POOL, pool);
    }
    filling = false;
  }

  /* ---------- State ---------- */

  let game = null;
  let sel = -1;
  let notesMode = false;
  let paused = false;
  let busy = false;
  let busyDiff = null;

  function freshGame(diff, puzzle, solution) {
    return {
      diff,
      puzzle: puzzle.slice(),
      solution: solution.slice(),
      values: puzzle.slice(),
      notes: new Array(81).fill(0),
      scored: new Array(81).fill(0),
      mistakes: 0,
      hints: MAX_HINTS,
      score: 0,
      time: 0,
      status: 'playing',
      history: [],
    };
  }

  function save() {
    if (game) store.set(KEY_GAME, game);
  }

  function validSaved(g) {
    return g && DIFFS.includes(g.diff) && ['puzzle', 'solution', 'values', 'notes', 'scored']
      .every((k) => Array.isArray(g[k]) && g[k].length === 81) && Array.isArray(g.history);
  }

  const isLocked = (i) => !!game.puzzle[i] || (game.values[i] !== 0 && game.values[i] === game.solution[i]);
  const canPlay = () => game && game.status === 'playing' && !paused && !busy;
  const isSolved = () => game.values.every((v, i) => v === game.solution[i]);
  const hasProgress = () => game && game.status === 'playing' && (game.history.length > 0 || game.time > 30);

  /* ---------- DOM ---------- */

  const boardEl = $('board');
  const overlayEl = $('overlay');
  const numpadEl = $('numpad');
  const levelsEl = $('levels');
  const modalEl = $('modal');
  const cardEl = $('card');
  const cells = [];
  const baseClass = [];
  const numBtns = [];

  for (let i = 0; i < 81; i++) {
    const r = S.ROW[i], c = S.COL[i];
    const el = document.createElement('div');
    let cls = 'cell';
    if (c === 2 || c === 5) cls += ' br';
    if (r === 2 || r === 5) cls += ' bb';
    if (c === 8) cls += ' c8';
    if (r === 8) cls += ' r8';
    el.setAttribute('role', 'gridcell');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      select(i);
    });
    baseClass.push(cls);
    cells.push(el);
    boardEl.appendChild(el);
  }

  for (let d = 1; d <= 9; d++) {
    const b = document.createElement('button');
    b.className = 'num';
    b.textContent = d;
    b.setAttribute('aria-label', String(d));
    b.addEventListener('click', () => input(d));
    numBtns.push(b);
    numpadEl.appendChild(b);
  }

  for (const d of DIFFS) {
    const b = document.createElement('button');
    b.textContent = NAMES[d];
    b.dataset.diff = d;
    b.addEventListener('click', () => askNewGame(d));
    levelsEl.appendChild(b);
  }

  /* ---------- Rendering ---------- */

  function formatTime(t) {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function renderTime() {
    $('time').textContent = formatTime(game ? game.time : 0);
  }

  function renderBoard() {
    const v = game.values, sol = game.solution;
    const sv = sel >= 0 ? v[sel] : 0;
    const conflict = new Uint8Array(81);
    if (settings.dupes) {
      for (let i = 0; i < 81; i++) {
        if (!v[i]) continue;
        for (const p of S.PEERS[i]) if (v[p] === v[i]) { conflict[i] = 1; break; }
      }
    }
    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      let cls = baseClass[i];
      if (!game.puzzle[i] && v[i]) cls += v[i] === sol[i] ? ' user' : ' wrong';
      if (i === sel) cls += ' sel';
      else if (conflict[i] && (v[i] !== sol[i] || (sv && v[i] === sv))) cls += ' conflict';
      else if (settings.same && sv && v[i] === sv) cls += ' same';
      else if (settings.areas && sel >= 0 &&
        (S.ROW[i] === S.ROW[sel] || S.COL[i] === S.COL[sel] || S.BOX[i] === S.BOX[sel])) cls += ' area';
      el.className = cls;

      const hl = settings.same ? sv : 0;
      const key = v[i] ? 'v' + v[i] : 'n' + game.notes[i] + ':' + hl;
      if (el._key === key) continue;
      el._key = key;
      if (v[i]) {
        el.textContent = v[i];
      } else if (game.notes[i]) {
        let h = '<div class="notes">';
        for (let d = 1; d <= 9; d++) {
          const on = game.notes[i] & (1 << d);
          h += `<span${on && d === hl ? ' class="hl"' : ''}>${on ? d : ''}</span>`;
        }
        el.innerHTML = h + '</div>';
      } else {
        el.textContent = '';
      }
    }
  }

  function update() {
    overlayEl.classList.toggle('loading', busy);
    for (const b of levelsEl.children) b.classList.toggle('active', b.dataset.diff === (busyDiff || (game && game.diff)));
    if (!game) {
      overlayEl.hidden = !busy;
      return;
    }
    renderBoard();

    $('mistakes').textContent = settings.mistakeLimit ? `${game.mistakes}/${MAX_MISTAKES}` : String(game.mistakes);
    $('score').textContent = game.score.toLocaleString('en-US');
    renderTime();
    document.querySelector('.time').classList.toggle('hide-time', !settings.timer);

    const counts = new Array(10).fill(0);
    game.values.forEach((v, i) => { if (v && v === game.solution[i]) counts[v]++; });
    numBtns.forEach((b, k) => b.classList.toggle('done', counts[k + 1] >= 9));
    numpadEl.classList.toggle('notes-mode', notesMode);

    const nb = $('notesBadge');
    nb.textContent = notesMode ? 'ON' : 'OFF';
    nb.classList.toggle('on', notesMode);
    $('notesBtn').classList.toggle('active', notesMode);
    $('hintBadge').textContent = game.hints;
    $('hintBtn').disabled = game.hints <= 0;

    const showPause = paused && game.status === 'playing';
    $('pauseBtn').innerHTML = showPause ? ICON_PLAY : ICON_PAUSE;
    $('pauseBtn').setAttribute('aria-label', showPause ? 'Resume' : 'Pause');
    boardEl.classList.toggle('paused', showPause || busy);
    overlayEl.hidden = !(showPause || busy);
    save();
  }

  function flashUnits(i) {
    const units = [S.UNITS[S.ROW[i]], S.UNITS[9 + S.COL[i]], S.UNITS[18 + S.BOX[i]]];
    for (const u of units) {
      if (!u.every((j) => game.values[j] === game.solution[j])) continue;
      for (const j of u) {
        const dist = Math.abs(S.ROW[j] - S.ROW[i]) + Math.abs(S.COL[j] - S.COL[i]);
        flash(j, dist * 45);
      }
    }
  }

  function flash(j, delay) {
    const el = cells[j];
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = `flash 0.5s ease ${delay}ms`;
  }

  /* ---------- Moves ---------- */

  function setCell(tx, i, value, notes) {
    tx.push([i, game.values[i], game.notes[i]]);
    game.values[i] = value;
    game.notes[i] = notes;
  }

  function commit(tx) {
    if (!tx.length) return;
    game.history.push(tx);
    if (game.history.length > 500) game.history.shift();
  }

  function clearPeerNotes(tx, i, d) {
    const b = 1 << d;
    for (const p of S.PEERS[i]) if (game.notes[p] & b) setCell(tx, p, game.values[p], game.notes[p] & ~b);
  }

  function select(i) {
    if (!game || paused || busy) return;
    sel = i;
    update();
  }

  function input(d) {
    if (!canPlay() || sel < 0 || isLocked(sel)) return;
    const i = sel;
    const tx = [];

    if (notesMode) {
      if (game.values[i]) return;
      setCell(tx, i, 0, game.notes[i] ^ (1 << d));
      commit(tx);
      return update();
    }

    if (game.values[i] === d) return;
    setCell(tx, i, d, 0);

    if (d === game.solution[i]) {
      if (settings.autoNotes) clearPeerNotes(tx, i, d);
      if (!game.scored[i]) {
        game.scored[i] = 1;
        game.score += POINTS[game.diff];
      }
      commit(tx);
      flashUnits(i);
      if (isSolved()) return win();
    } else {
      game.mistakes++;
      commit(tx);
      if (settings.mistakeLimit && game.mistakes >= MAX_MISTAKES) {
        game.status = 'lost';
        update();
        return showLost();
      }
    }
    update();
  }

  function erase() {
    if (!canPlay() || sel < 0 || isLocked(sel)) return;
    if (!game.values[sel] && !game.notes[sel]) return;
    const tx = [];
    setCell(tx, sel, 0, 0);
    commit(tx);
    update();
  }

  function undo() {
    if (!canPlay()) return;
    const tx = game.history.pop();
    if (!tx) return;
    for (let k = tx.length - 1; k >= 0; k--) {
      const [i, v, n] = tx[k];
      game.values[i] = v;
      game.notes[i] = n;
    }
    update();
  }

  function hint() {
    if (!canPlay() || game.hints <= 0) return;
    let i = sel >= 0 && !isLocked(sel) ? sel : -1;
    if (i < 0) {
      const open = [];
      for (let k = 0; k < 81; k++) if (game.values[k] !== game.solution[k]) open.push(k);
      if (!open.length) return;
      i = open[(Math.random() * open.length) | 0];
      sel = i;
    }
    const d = game.solution[i];
    const tx = [];
    setCell(tx, i, d, 0);
    if (settings.autoNotes) clearPeerNotes(tx, i, d);
    commit(tx);
    game.hints--;
    game.scored[i] = 1;
    flashUnits(i);
    if (isSolved()) return win();
    update();
  }

  function toggleNotes() {
    if (!game || game.status !== 'playing') return;
    notesMode = !notesMode;
    update();
  }

  function togglePause() {
    if (!game || game.status !== 'playing' || busy) return;
    paused = !paused;
    update();
  }

  function move(dr, dc) {
    if (!game || paused || busy) return;
    if (sel < 0) return select(40);
    const r = (S.ROW[sel] + dr + 9) % 9, c = (S.COL[sel] + dc + 9) % 9;
    select(r * 9 + c);
  }

  function winBonus() {
    const speed = PAR[game.diff] / (PAR[game.diff] + game.time);
    const accuracy = Math.max(0, 1 - 0.2 * game.mistakes);
    return Math.round((POINTS[game.diff] * 30 * speed * accuracy) / 10) * 10;
  }

  function win() {
    game.status = 'won';
    game.score += winBonus();
    game.record = recordScore({ d: game.diff, s: game.score, t: game.time, at: Date.now() });
    sel = -1;
    update();
    for (let i = 0; i < 81; i++) flash(i, (S.ROW[i] + S.COL[i]) * 40);
    setTimeout(showWon, 900);
  }

  /* ---------- Games ---------- */

  function newGame(diff) {
    closeModal();
    busy = true;
    busyDiff = diff;
    paused = false;
    notesMode = false;
    sel = -1;
    update();
    takePuzzle(diff).then((p) => {
      game = freshGame(diff, p.puzzle, p.solution);
      busy = false;
      busyDiff = null;
      update();
      fillPool();
    });
  }

  function restart() {
    closeModal();
    game = freshGame(game.diff, game.puzzle, game.solution);
    sel = -1;
    paused = false;
    notesMode = false;
    update();
  }

  function secondChance() {
    closeModal();
    game.status = 'playing';
    const last = game.history[game.history.length - 1];
    undo();
    if (last) for (const [i] of last) if (game.values[i] && game.values[i] !== game.solution[i]) game.values[i] = 0;
    game.mistakes = MAX_MISTAKES - 1;
    update();
  }

  function askNewGame(diff) {
    if (busy) return;
    if (!hasProgress()) return newGame(diff);
    openModal(`
      <h2>New ${NAMES[diff]} game?</h2>
      <div class="btn-row">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="start">Start</button>
      </div>`, { start: () => newGame(diff) });
  }

  /* ---------- Modals ---------- */

  let modalActions = {};
  let modalLocked = false;

  function openModal(html, actions, locked) {
    cardEl.innerHTML = html;
    modalActions = actions || {};
    modalLocked = !!locked;
    modalEl.hidden = false;
    const focus = cardEl.querySelector('.primary, button');
    if (focus) focus.focus({ preventScroll: true });
  }

  function closeModal() {
    modalEl.hidden = true;
    cardEl.innerHTML = '';
    modalActions = {};
    modalLocked = false;
  }

  const modalOpen = () => !modalEl.hidden;

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) {
      if (!modalLocked) closeModal();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') return closeModal();
    if (modalActions[act]) modalActions[act](btn);
  });

  function showMenu() {
    if (busy) return;
    const items = DIFFS.map((d) =>
      `<button data-act="diff" data-diff="${d}" class="${game && d === game.diff ? 'current' : ''}">${NAMES[d]}</button>`).join('');
    openModal(`
      <div class="menu">
        ${items}
        <hr>
        <button data-act="restart">Restart ${ICON_RESTART}</button>
      </div>`, {
      diff: (b) => newGame(b.dataset.diff),
      restart,
    });
  }

  function showSettings() {
    const rows = SETTINGS.map(([k, label]) => `
      <label class="setting">
        <span>${label}</span>
        <input type="checkbox" data-key="${k}"${settings[k] ? ' checked' : ''}>
        <i class="switch"></i>
      </label>`).join('');
    openModal(`
      <div class="card-head">
        <h2>Settings</h2>
        <button class="icon-btn" data-act="close" aria-label="Close">${ICON_X}</button>
      </div>
      ${rows}`);
    cardEl.querySelectorAll('input[data-key]').forEach((inp) => {
      inp.addEventListener('change', () => {
        settings[inp.dataset.key] = inp.checked;
        store.set(KEY_SETTINGS, settings);
        applyTheme();
        if (game && game.status === 'lost' && !settings.mistakeLimit) game.status = 'playing';
        update();
      });
    });
  }

  function showWon() {
    if (!game || game.status !== 'won') return;
    openModal(`
      <div class="result">
        <div class="mark">${ICON_CHECK}</div>
        <h2>Solved</h2>
        <dl class="summary">
          <div><dt>Level</dt><dd>${NAMES[game.diff]}</dd></div>
          <div><dt>Time</dt><dd>${formatTime(game.time)}</dd></div>
          <div><dt>Score</dt><dd>${game.score.toLocaleString('en-US')}</dd></div>
        </dl>
        <button class="btn primary" data-act="again">New Game</button>
        <button class="btn" data-act="scores">High scores</button>
      </div>`, { again: () => newGame(game.diff), scores: () => showScores() });
    if (game.record) cardEl.querySelector('h2').insertAdjacentHTML('afterend', `<span class="chip">${game.record}</span>`);
  }

  let scoreRange = 'all';

  function showScores(range) {
    if (range) scoreRange = range;
    const list = loadScores();
    const r = RANGES.find((x) => x.key === scoreRange);
    const since = r.since(Date.now());
    const tabs = RANGES.map((x) =>
      `<button data-act="range" data-range="${x.key}" class="${x.key === scoreRange ? 'on' : ''}">${x.name}</button>`).join('');
    const rows = DIFFS.map((d) => {
      const best = bestScore(list, d, since);
      const cls = game && d === game.diff ? ' class="current"' : '';
      return best
        ? `<tr${cls}><th>${NAMES[d]}</th><td>${best.s.toLocaleString('en-US')}</td><td>${formatTime(best.t)}</td></tr>`
        : `<tr${cls}><th>${NAMES[d]}</th><td class="none">–</td><td class="none">–</td></tr>`;
    }).join('');
    openModal(`
      <div class="card-head">
        <h2>High scores</h2>
        <button class="icon-btn" data-act="close" aria-label="Close">${ICON_X}</button>
      </div>
      <div class="seg">${tabs}</div>
      <table class="scores"><tbody>${rows}</tbody></table>`, {
      range: (b) => showScores(b.dataset.range),
    });
    const on = cardEl.querySelector('.seg .on');
    if (on) on.focus({ preventScroll: true });
  }

  function showLost() {
    openModal(`
      <div class="result">
        <div class="mark bad">${ICON_X}</div>
        <h2>Game over</h2>
        <p>${MAX_MISTAKES} mistakes</p>
        <button class="btn primary" data-act="second">Second chance</button>
        <button class="btn" data-act="again">New Game</button>
      </div>`, { second: secondChance, again: () => newGame(game.diff) }, true);
  }

  /* ---------- Wiring ---------- */

  $('undoBtn').addEventListener('click', undo);
  $('eraseBtn').addEventListener('click', erase);
  $('notesBtn').addEventListener('click', toggleNotes);
  $('hintBtn').addEventListener('click', hint);
  $('pauseBtn').addEventListener('click', togglePause);
  $('resumeBtn').addEventListener('click', () => { if (paused) togglePause(); });
  $('newBtn').addEventListener('click', showMenu);
  $('settingsBtn').addEventListener('click', showSettings);
  $('scoresBtn').addEventListener('click', () => showScores());

  document.addEventListener('keydown', (e) => {
    if (modalOpen()) {
      if (e.key === 'Escape' && !modalLocked) closeModal();
      return;
    }
    if (e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      return;
    }
    const k = e.key;
    if (k >= '1' && k <= '9') input(+k);
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
    else if (k === 'ArrowDown') { e.preventDefault(); move(1, 0); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
    else if (k === 'ArrowRight') { e.preventDefault(); move(0, 1); }
    else if (k === 'Backspace' || k === 'Delete' || k === '0') erase();
    else if (k === 'n' || k === 'N' || e.code === 'KeyN') toggleNotes();
    else if (k === ' ' && e.target === document.body) { e.preventDefault(); togglePause(); }
  });

  setInterval(() => {
    if (!game || game.status !== 'playing' || paused || busy || modalOpen() || document.hidden) return;
    game.time++;
    renderTime();
    if (game.time % 5 === 0) save();
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && game.status === 'playing' && !busy) {
      paused = true;
      update();
    }
  });
  window.addEventListener('pagehide', save);

  /* ---------- Boot ---------- */

  applyTheme();
  const saved = store.get(KEY_GAME, null);
  if (validSaved(saved) && saved.status === 'playing') {
    game = saved;
    update();
    fillPool();
  } else {
    newGame(saved && DIFFS.includes(saved.diff) ? saved.diff : 'easy');
  }
})();
