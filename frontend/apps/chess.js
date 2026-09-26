import { button, text, rows, columns, squareIn, grid, rect, inset } from './layout.js';
import {
  newGame, applyMove, legalMoves, gameStatus, inCheck, chooseAiMove,
  colorOf, rowOf, colOf, squareName, squareIndex, AI_LEVELS,
} from './chess-engine.js';

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
// U+FE0E asks for the text form so pieces do not render as color emoji.
const glyph = (piece) => (piece ? `${GLYPHS[piece.toLowerCase()]}︎` : '');
const START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const LEVEL_NOTES = { easy: 'Makes mistakes', medium: 'Looks two moves ahead', hard: 'Thinks deeper' };
// The computer always plays black.
const AI_COLOR = 'b';
// Keeps the computer's reply from appearing instantly, so the player sees their own move land.
const MIN_THINK_MS = 450;

// Pieces each side has taken, and the material balance from white's point of view.
function capturedPieces(board) {
  const present = { w: {}, b: {} };
  for (const piece of board) {
    if (!piece) continue;
    const bucket = present[colorOf(piece)];
    const type = piece.toLowerCase();
    bucket[type] = (bucket[type] ?? 0) + 1;
  }
  const takenFrom = (color) => Object.entries(START_COUNTS)
    .flatMap(([type, count]) => Array(Math.max(0, count - (present[color][type] ?? 0))).fill(type));
  const byWhite = takenFrom('b');
  const byBlack = takenFrom('w');
  const worth = (list) => list.reduce((sum, type) => sum + PIECE_VALUE[type], 0);
  return { byWhite, byBlack, balance: worth(byWhite) - worth(byBlack) };
}

function create(ctx) {
  let phase = 'setup'; // 'setup' | 'playing'
  let mode = { type: 'ai', level: 'medium' };
  let state = newGame();
  let history = [];
  let selected = -1;
  let lastMove = null;
  let aiPending = false;
  let requestId = 0;
  let thinkStarted = 0;
  let worker;

  const aiTurn = () => phase === 'playing' && mode.type === 'ai' && state.turn === AI_COLOR;

  function getWorker() {
    if (worker !== undefined) return worker;
    try {
      worker = new Worker(new URL('./chess-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (event) => deliverAiMove(event.data.id, event.data.move);
      worker.onerror = (event) => {
        event.preventDefault?.();
        worker.terminate();
        worker = null;
        // Finish the current request on the main thread instead.
        if (aiPending) computeOnMainThread(requestId);
      };
    } catch {
      worker = null;
    }
    return worker;
  }

  function computeOnMainThread(id) {
    ctx.after(30, () => deliverAiMove(id, chooseAiMove(state, { level: mode.level })));
  }

  function requestAiMove() {
    const id = ++requestId;
    aiPending = true;
    thinkStarted = performance.now();
    const w = getWorker();
    if (w) w.postMessage({ id, state, level: mode.level });
    else computeOnMainThread(id);
  }

  function deliverAiMove(id, move) {
    if (id !== requestId || ctx.destroyed) return;
    const wait = Math.max(0, MIN_THINK_MS - (performance.now() - thinkStarted));
    ctx.after(wait, () => {
      if (id !== requestId) return;
      aiPending = false;
      if (move && aiTurn()) play(move);
      ctx.update();
    });
  }

  function cancelAi() {
    requestId += 1;
    aiPending = false;
  }

  function play(move) {
    history.push({ state, lastMove });
    state = applyMove(state, move);
    lastMove = move;
    selected = -1;
    if (aiTurn() && !gameStatus(state).over) requestAiMove();
  }

  function start(newMode) {
    cancelAi();
    mode = newMode;
    state = newGame();
    history = [];
    selected = -1;
    lastMove = null;
    phase = 'playing';
  }

  ctx.onDestroy(() => {
    cancelAi();
    worker?.terminate();
  });

  // ---------- Layout ----------

  function boardWidgets(board, interactive) {
    const aspect = ctx.aspect();
    const pad = 0.012;
    const frame = rect(board.x - pad / aspect, board.y - pad, board.width + (2 * pad) / aspect, board.height + 2 * pad);
    const cell = grid(board, 8, 8, 0, 0);
    const moves = interactive ? legalMoves(state) : [];
    const targets = selected >= 0 ? moves.filter((move) => move.from === selected) : [];
    const checkedKing = interactive && inCheck(state) ? state.board.indexOf(state.turn === 'w' ? 'K' : 'k') : -1;
    const isLight = (sq) => (rowOf(sq) + colOf(sq)) % 2 === 0;
    const widgets = [text('board-frame', frame, '', 'board')];

    state.board.forEach((piece, sq) => {
      const variant = ['sq', isLight(sq) ? 'light' : 'dark'];
      if (piece) variant.push(colorOf(piece) === 'w' ? 'pw' : 'pb');
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) variant.push('last');
      if (sq === selected) variant.push('sel');
      if (sq === checkedKing) variant.push('check-sq');
      const enPassant = sq === state.ep && state.board[selected]?.toLowerCase() === 'p';
      if (targets.some((move) => move.to === sq)) variant.push(piece || enPassant ? 'cap' : 'move');
      const make = interactive ? button : text;
      widgets.push(make(`sq-${squareName(sq)}`, cell(rowOf(sq), colOf(sq)), glyph(piece), variant));
    });

    // File letters along the bottom rank and rank numbers down the a-file, drawn over the squares.
    const coordColor = (sq) => (isLight(sq) ? 'coord-light' : 'coord-dark');
    for (let i = 0; i < 8; i += 1) {
      widgets.push(
        text(`file-${i}`, cell(7, i), 'abcdefgh'[i], ['coord', 'corner-br', coordColor(56 + i)]),
        text(`rank-${i}`, cell(i, 0), String(8 - i), ['coord', 'corner-tl', coordColor(i * 8)]),
      );
    }
    return widgets;
  }

  function setupWidgets() {
    const area = inset(rect(0, 0, 1, 1), 0.035);
    const wide = ctx.aspect() >= 1.3;
    const widgets = [];
    let panel = area;
    if (wide) {
      // A preview of the starting position beside the options.
      const [boardArea, side] = columns(area, [1.1, 1], 0.05);
      widgets.push(...boardWidgets(squareIn(inset(boardArea, 0.015), ctx.aspect(), 'left'), false));
      panel = side;
    }
    const [title, subtitle, levelLabel, levelButtons, levelNotes, , twoLabel, twoButton] =
      rows(panel, [1.3, 0.6, 0.5, 1.4, 0.9, 0.2, 0.5, 1.3], 0.02);
    widgets.push(
      text('title', title, 'Chess', ['huge', 'left']),
      text('subtitle', subtitle, 'You play white. Choose an opponent.', ['left', 'muted', 'small']),
      text('level-label', levelLabel, 'Play the computer', ['label', 'left']),
    );
    const buttonCells = columns(levelButtons, [1, 1, 1], 0.025);
    const noteCells = columns(levelNotes, [1, 1, 1], 0.025);
    Object.entries(AI_LEVELS).forEach(([level, settings], i) => {
      widgets.push(
        button(`level-${level}`, buttonCells[i], settings.label, level === 'medium' ? 'primary' : undefined),
        text(`level-note-${level}`, noteCells[i], LEVEL_NOTES[level], ['small', 'faint']),
      );
    });
    widgets.push(
      text('two-label', twoLabel, 'Or pass and play', ['label', 'left']),
      button('two-players', twoButton, '2 players', undefined, { icon: 'users' }),
    );
    return widgets;
  }

  function statusText(status) {
    if (aiPending) return 'Computer is thinking...';
    if (status.over) return status.text;
    if (mode.type === 'ai') return inCheck(state) ? 'Your move. You are in check!' : 'Your move';
    return status.text;
  }

  const capturedLine = (list) => list.map((type) => `${GLYPHS[type]}︎`).join('') || '-';

  function playingWidgets() {
    const area = inset(rect(0, 0, 1, 1), 0.03);
    const aspect = ctx.aspect();
    const wide = aspect >= 1.15;
    const [boardArea, panel] = wide ? columns(area, [1.55, 1], 0.045) : rows(area, [3.4, 1], 0.03);
    const board = squareIn(inset(boardArea, 0.015), aspect, wide ? 'left' : 'center');
    const widgets = boardWidgets(board, true);

    const status = gameStatus(state);
    const modeLabel = mode.type === 'ai' ? `vs Computer · ${AI_LEVELS[mode.level].label}` : '2 players';
    const newButton = (cell, label) => button('new', cell, label, status.over ? 'primary' : undefined, { icon: 'plus' });
    const undoButton = (cell) => button('undo', cell, 'Undo', undefined, { icon: 'undo', disabled: !history.length || aiPending });

    if (!wide) {
      const [statusCell, controls] = rows(panel, [1, 1], 0.03);
      const [undoCell, newCell] = columns(controls, [1, 1], 0.03);
      widgets.push(
        text('status', statusCell, `${statusText(status)}  ·  ${modeLabel}`, ['hero', 'small']),
        undoButton(undoCell),
        newButton(newCell, 'New game'),
      );
      return widgets;
    }

    const [chip, statusCell, captured, last, controls] = rows(panel, [0.7, 1.6, 1.6, 0.6, 1], 0.035);
    const [takenLabel, byWhiteCell, byBlackCell] = rows(captured, [0.6, 1, 1], 0.02);
    const [undoCell, newCell] = columns(controls, [1, 1], 0.03);
    const { byWhite, byBlack, balance } = capturedPieces(state.board);
    const whiteName = mode.type === 'ai' ? 'You' : 'White';
    const blackName = mode.type === 'ai' ? 'Computer' : 'Black';
    const lead = balance === 0 ? '' : `  ·  ${balance > 0 ? whiteName : blackName} +${Math.abs(balance)}`;
    widgets.push(
      text('mode', chip, modeLabel, 'chip', { icon: mode.type === 'ai' ? 'cpu' : 'users' }),
      text('status', statusCell, statusText(status), status.over ? ['hero', 'title'] : 'hero'),
      text('taken-label', takenLabel, `Captured${lead}`, ['label', 'left']),
      text('taken-white', byWhiteCell, `${whiteName}  ${capturedLine(byWhite)}`, ['left', 'small', 'pieces']),
      text('taken-black', byBlackCell, `${blackName}  ${capturedLine(byBlack)}`, ['left', 'small', 'pieces']),
      text('last', last, lastMove ? `Last move  ${squareName(lastMove.from)} → ${squareName(lastMove.to)}` : 'No moves yet', ['left', 'small', 'muted']),
      undoButton(undoCell),
      newButton(newCell, status.over ? 'New game' : 'New'),
    );
    return widgets;
  }

  return {
    widgets() {
      return phase === 'setup' ? setupWidgets() : playingWidgets();
    },
    handleAction({ widget_id: id }) {
      if (phase === 'setup') {
        if (id.startsWith('level-') && AI_LEVELS[id.slice(6)]) start({ type: 'ai', level: id.slice(6) });
        else if (id === 'two-players') start({ type: 'two' });
        return;
      }
      if (id === 'new') { cancelAi(); phase = 'setup'; return; }
      if (id === 'undo') {
        if (aiPending) return;
        // Against the computer, undo takes back the computer's reply and your move.
        let steps = mode.type === 'ai' && state.turn !== AI_COLOR ? 2 : 1;
        while (steps-- > 0 && history.length) ({ state, lastMove } = history.pop());
        selected = -1;
        if (aiTurn()) requestAiMove();
        return;
      }
      if (!id.startsWith('sq-') || aiTurn() || gameStatus(state).over) return;
      const sq = squareIndex(id.slice(3));
      const piece = state.board[sq];
      if (selected >= 0) {
        const options = legalMoves(state).filter((move) => move.from === selected && move.to === sq);
        if (options.length) {
          // Promotion always picks a queen; there is no piece chooser yet.
          play(options.find((move) => move.promo === 'q') ?? options[0]);
          return;
        }
      }
      selected = piece && colorOf(piece) === state.turn && sq !== selected ? sq : -1;
    },
  };
}

export default { title: 'Chess', create };
