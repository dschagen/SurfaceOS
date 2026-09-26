import { button, text, rows, columns, squareIn, grid, rect, inset } from './layout.js';

// Board squares are indexed 0..63 with 0 = a8 and 63 = h1. Pieces use FEN letters:
// uppercase for white, lowercase for black, null for empty.

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const VALUES = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };

const colorOf = (piece) => (piece === piece.toUpperCase() ? 'w' : 'b');
const rowOf = (sq) => sq >> 3;
const colOf = (sq) => sq & 7;
const at = (row, col) => (row >= 0 && row < 8 && col >= 0 && col < 8 ? row * 8 + col : -1);
export const squareName = (sq) => `${FILES[colOf(sq)]}${8 - rowOf(sq)}`;
export const squareIndex = (name) => at(8 - Number(name[1]), FILES.indexOf(name[0]));

export function fromFEN(fen) {
  const [placement, turn, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/);
  const board = [];
  for (const char of placement.replace(/\//g, '')) {
    if (/\d/.test(char)) board.push(...Array(Number(char)).fill(null));
    else board.push(char);
  }
  if (board.length !== 64) throw new Error('Bad FEN');
  return {
    board,
    turn,
    castling: castling === '-' ? '' : castling,
    ep: ep === '-' ? -1 : squareIndex(ep),
    halfmove: Number(halfmove) || 0,
    fullmove: Number(fullmove) || 1,
  };
}

export function newGame() {
  return fromFEN(START_FEN);
}

function isAttacked(board, sq, by) {
  const row = rowOf(sq);
  const col = colOf(sq);
  // A white pawn attacks upward (toward row 0), so it sits one row below the target.
  const pawnRow = by === 'w' ? row + 1 : row - 1;
  const pawn = by === 'w' ? 'P' : 'p';
  for (const dc of [-1, 1]) {
    const from = at(pawnRow, col + dc);
    if (from >= 0 && board[from] === pawn) return true;
  }
  const own = (piece, letter) => piece && colorOf(piece) === by && piece.toLowerCase() === letter;
  for (const [dr, dc] of KNIGHT) {
    const from = at(row + dr, col + dc);
    if (from >= 0 && own(board[from], 'n')) return true;
  }
  for (const [dr, dc] of KING) {
    const from = at(row + dr, col + dc);
    if (from >= 0 && own(board[from], 'k')) return true;
  }
  const rays = [[ROOK_DIRS, 'r'], [BISHOP_DIRS, 'b']];
  for (const [dirs, slider] of rays) {
    for (const [dr, dc] of dirs) {
      let r = row + dr;
      let c = col + dc;
      while (at(r, c) >= 0) {
        const piece = board[at(r, c)];
        if (piece) {
          if (own(piece, slider) || own(piece, 'q')) return true;
          break;
        }
        r += dr;
        c += dc;
      }
    }
  }
  return false;
}

function inCheck(state, color = state.turn) {
  const king = state.board.indexOf(color === 'w' ? 'K' : 'k');
  return king >= 0 && isAttacked(state.board, king, color === 'w' ? 'b' : 'w');
}

function pseudoMoves(state, from) {
  const { board } = state;
  const piece = board[from];
  const color = colorOf(piece);
  const enemy = color === 'w' ? 'b' : 'w';
  const row = rowOf(from);
  const col = colOf(from);
  const moves = [];
  const add = (to) => {
    const promotes = piece.toLowerCase() === 'p' && (rowOf(to) === 0 || rowOf(to) === 7);
    if (promotes) for (const promo of ['q', 'r', 'b', 'n']) moves.push({ from, to, promo });
    else moves.push({ from, to });
  };
  const type = piece.toLowerCase();

  if (type === 'p') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    const one = at(row + dir, col);
    if (one >= 0 && !board[one]) {
      add(one);
      const two = at(row + 2 * dir, col);
      if (row === startRow && !board[two]) add(two);
    }
    for (const dc of [-1, 1]) {
      const to = at(row + dir, col + dc);
      if (to < 0) continue;
      if ((board[to] && colorOf(board[to]) === enemy) || to === state.ep) add(to);
    }
    return moves;
  }
  if (type === 'n' || type === 'k') {
    for (const [dr, dc] of type === 'n' ? KNIGHT : KING) {
      const to = at(row + dr, col + dc);
      if (to >= 0 && (!board[to] || colorOf(board[to]) === enemy)) add(to);
    }
    if (type === 'k') addCastling(state, from, color, enemy, moves);
    return moves;
  }
  const dirs = type === 'r' ? ROOK_DIRS : type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
  for (const [dr, dc] of dirs) {
    let r = row + dr;
    let c = col + dc;
    while (at(r, c) >= 0) {
      const to = at(r, c);
      if (board[to]) {
        if (colorOf(board[to]) === enemy) add(to);
        break;
      }
      add(to);
      r += dr;
      c += dc;
    }
  }
  return moves;
}

function addCastling(state, from, color, enemy, moves) {
  const { board, castling } = state;
  const home = color === 'w' ? 60 : 4;
  if (from !== home || isAttacked(board, home, enemy)) return;
  const [kingSide, queenSide, rook] = color === 'w' ? ['K', 'Q', 'R'] : ['k', 'q', 'r'];
  if (castling.includes(kingSide) && board[home + 3] === rook && !board[home + 1] && !board[home + 2]
      && !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)) {
    moves.push({ from, to: home + 2, castle: 'king' });
  }
  if (castling.includes(queenSide) && board[home - 4] === rook && !board[home - 1] && !board[home - 2] && !board[home - 3]
      && !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)) {
    moves.push({ from, to: home - 2, castle: 'queen' });
  }
}

export function applyMove(state, move) {
  const board = state.board.slice();
  const piece = board[move.from];
  const color = colorOf(piece);
  const type = piece.toLowerCase();
  const captured = board[move.to];
  board[move.to] = move.promo ? (color === 'w' ? move.promo.toUpperCase() : move.promo) : piece;
  board[move.from] = null;

  let enPassantCapture = false;
  if (type === 'p' && move.to === state.ep && colOf(move.from) !== colOf(move.to)) {
    board[at(rowOf(move.from), colOf(move.to))] = null;
    enPassantCapture = true;
  }
  if (type === 'k' && Math.abs(move.to - move.from) === 2) {
    const kingSide = move.to > move.from;
    const rookFrom = kingSide ? move.from + 3 : move.from - 4;
    const rookTo = kingSide ? move.from + 1 : move.from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }

  let { castling } = state;
  const strip = (letters) => { castling = [...castling].filter((c) => !letters.includes(c)).join(''); };
  if (piece === 'K') strip('KQ');
  if (piece === 'k') strip('kq');
  const cornerRights = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };
  if (cornerRights[move.from]) strip(cornerRights[move.from]);
  if (cornerRights[move.to]) strip(cornerRights[move.to]);

  return {
    board,
    turn: color === 'w' ? 'b' : 'w',
    castling,
    ep: type === 'p' && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : -1,
    halfmove: type === 'p' || captured || enPassantCapture ? 0 : state.halfmove + 1,
    fullmove: state.fullmove + (color === 'b' ? 1 : 0),
  };
}

export function legalMoves(state) {
  const moves = [];
  state.board.forEach((piece, sq) => {
    if (!piece || colorOf(piece) !== state.turn) return;
    for (const move of pseudoMoves(state, sq)) {
      if (!inCheck(applyMove(state, move), state.turn)) moves.push(move);
    }
  });
  return moves;
}

export function perft(state, depth) {
  if (depth === 0) return 1;
  let total = 0;
  for (const move of legalMoves(state)) total += perft(applyMove(state, move), depth - 1);
  return total;
}

// Returns { over, result, text } for the side to move.
export function gameStatus(state, moves = legalMoves(state)) {
  const side = state.turn === 'w' ? 'White' : 'Black';
  if (!moves.length) {
    if (inCheck(state)) return { over: true, result: 'checkmate', text: `Checkmate. ${state.turn === 'w' ? 'Black' : 'White'} wins` };
    return { over: true, result: 'stalemate', text: 'Stalemate. Draw' };
  }
  if (state.board.every((piece) => !piece || piece.toLowerCase() === 'k')) return { over: true, result: 'draw', text: 'Only kings left. Draw' };
  if (state.halfmove >= 100) return { over: true, result: 'draw', text: 'Fifty-move rule. Draw' };
  return { over: false, result: null, text: inCheck(state) ? `${side} to move, in check` : `${side} to move` };
}

function material(board, color) {
  let score = 0;
  board.forEach((piece, sq) => {
    if (!piece) return;
    // A small pull toward the center keeps the AI from shuffling pieces aimlessly.
    const center = 0.03 * (3.5 - Math.abs(3.5 - colOf(sq))) + 0.02 * (3.5 - Math.abs(3.5 - rowOf(sq)));
    const value = VALUES[piece.toLowerCase()] + center;
    score += colorOf(piece) === color ? value : -value;
  });
  return score;
}

// Two-ply material search: picks the move whose worst-case reply leaves the most material.
export function chooseAiMove(state, random = Math.random) {
  const me = state.turn;
  let best = null;
  let bestScore = -Infinity;
  for (const move of legalMoves(state)) {
    if (move.promo && move.promo !== 'q') continue;
    const after = applyMove(state, move);
    const replies = legalMoves(after);
    let score;
    if (!replies.length) {
      score = inCheck(after) ? 1000 : 0;
    } else {
      score = Infinity;
      for (const reply of replies) score = Math.min(score, material(applyMove(after, reply).board, me));
    }
    score += random() * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
// U+FE0E asks for the text form so pieces do not render as color emoji.
const glyph = (piece) => (piece ? `${GLYPHS[piece.toLowerCase()]}︎` : '');

function create(ctx) {
  let state = newGame();
  let history = [];
  let selected = -1;
  let lastMove = null;
  let mode = 'ai';
  let aiPending = false;

  const aiColor = 'b';
  const aiTurn = () => mode === 'ai' && state.turn === aiColor;

  function play(move) {
    history.push({ state, lastMove });
    state = applyMove(state, move);
    lastMove = move;
    selected = -1;
    if (aiTurn() && !gameStatus(state).over) scheduleAi();
  }

  function scheduleAi() {
    aiPending = true;
    // A short pause so the player's move is visible before the reply appears.
    ctx.after(450, () => {
      aiPending = false;
      if (!aiTurn() || gameStatus(state).over) return;
      const move = chooseAiMove(state);
      if (move) play(move);
      ctx.update();
    });
  }

  function reset() {
    state = newGame();
    history = [];
    selected = -1;
    lastMove = null;
    aiPending = false;
  }

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.025);
      const aspect = ctx.aspect();
      const wide = aspect >= 1.15;
      const [boardArea, panelArea] = wide ? columns(area, [1.6, 1], 0.03) : rows(area, [3.2, 1], 0.03);
      const board = squareIn(boardArea, aspect, wide ? 'left' : 'center');
      const cell = grid(board, 8, 8, 0, 0);
      const moves = legalMoves(state);
      const status = gameStatus(state, moves);
      const targets = selected >= 0 ? moves.filter((move) => move.from === selected) : [];
      const checkedKing = inCheck(state) ? state.board.indexOf(state.turn === 'w' ? 'K' : 'k') : -1;

      const widgets = state.board.map((piece, sq) => {
        const variant = ['sq', (rowOf(sq) + colOf(sq)) % 2 ? 'dark' : 'light'];
        if (piece) variant.push(colorOf(piece) === 'w' ? 'pw' : 'pb');
        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) variant.push('last');
        if (sq === selected) variant.push('sel');
        if (sq === checkedKing) variant.push('check-sq');
        const enPassant = sq === state.ep && state.board[selected]?.toLowerCase() === 'p';
        if (targets.some((move) => move.to === sq)) variant.push(piece || enPassant ? 'cap' : 'move');
        return button(`sq-${squareName(sq)}`, cell(rowOf(sq), colOf(sq)), glyph(piece), variant);
      });

      let statusText = status.text;
      if (aiPending) statusText = 'Computer is thinking...';
      else if (mode === 'ai' && !status.over && state.turn === 'w') statusText = inCheck(state) ? 'Your move, in check' : 'Your move (white)';
      const modeText = mode === 'ai' ? 'Mode: vs computer' : 'Mode: 2 players';

      let statusCell, modeCell, undoCell, newCell;
      if (wide) {
        let controls;
        [statusCell, modeCell, controls] = rows(panelArea, [2.2, 1, 1], 0.04);
        [undoCell, newCell] = columns(controls, [1, 1], 0.03);
      } else {
        let controls;
        [statusCell, controls] = rows(panelArea, [1, 1], 0.04);
        [modeCell, undoCell, newCell] = columns(controls, [1.4, 1, 1], 0.02);
      }
      widgets.push(
        text('status', statusCell, statusText, status.over ? 'accent' : undefined),
        button('mode', modeCell, modeText, 'ghost'),
        button('undo', undoCell, 'Undo', undefined, { disabled: !history.length || aiPending }),
        button('new', newCell, 'New game', 'danger'),
      );
      return widgets;
    },
    handleAction({ widget_id: id }) {
      if (id === 'new') { reset(); return; }
      if (id === 'mode') {
        mode = mode === 'ai' ? 'two' : 'ai';
        selected = -1;
        if (aiTurn() && !aiPending && !gameStatus(state).over) scheduleAi();
        return;
      }
      if (id === 'undo') {
        if (aiPending) return;
        // Against the computer, undo takes back the computer's reply and your move.
        let steps = mode === 'ai' && state.turn === 'w' ? 2 : 1;
        while (steps-- > 0 && history.length) ({ state, lastMove } = history.pop());
        selected = -1;
        if (aiTurn()) scheduleAi();
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
