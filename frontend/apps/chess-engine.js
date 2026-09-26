// Chess rules and computer opponent, with no DOM access so it can also run in a Web Worker.
//
// Board squares are indexed 0..63 with 0 = a8 and 63 = h1. Pieces use FEN letters:
// uppercase for white, lowercase for black, null for empty.

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export const colorOf = (piece) => (piece === piece.toUpperCase() ? 'w' : 'b');
export const rowOf = (sq) => sq >> 3;
export const colOf = (sq) => sq & 7;
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
  for (const [dirs, slider] of [[ROOK_DIRS, 'r'], [BISHOP_DIRS, 'b']]) {
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

export function inCheck(state, color = state.turn) {
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

// ---------- Computer opponent ----------

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from white's side, rank 8 first (the widely used "simplified evaluation").
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

// Score in centipawns from the side to move's point of view.
function evaluate(state) {
  let score = 0;
  const { board } = state;
  for (let sq = 0; sq < 64; sq += 1) {
    const piece = board[sq];
    if (!piece) continue;
    const type = piece.toLowerCase();
    if (colorOf(piece) === 'w') score += VALUE[type] + PST[type][sq];
    else score -= VALUE[type] + PST[type][(7 - rowOf(sq)) * 8 + colOf(sq)];
  }
  return state.turn === 'w' ? score : -score;
}

function capturedValue(state, move) {
  const target = state.board[move.to];
  if (target) return VALUE[target.toLowerCase()];
  return state.board[move.from].toLowerCase() === 'p' && move.to === state.ep ? VALUE.p : 0;
}

// Captures and promotions first, most valuable victim by least valuable attacker.
function orderMoves(state, moves, first) {
  const score = (move) => {
    if (first && move.from === first.from && move.to === first.to && move.promo === first.promo) return 1e6;
    const victim = capturedValue(state, move);
    const attacker = VALUE[state.board[move.from].toLowerCase()];
    return (victim ? 10 * victim - attacker + 1000 : 0) + (move.promo === 'q' ? 800 : move.promo ? -500 : 0);
  };
  return moves.map((move) => [score(move), move]).sort((a, b) => b[0] - a[0]).map(([, move]) => move);
}

const MATE = 100000;
const TIMEOUT = Symbol('timeout');

function quiesce(state, alpha, beta, ply, search, depthLeft) {
  search.tick();
  const moves = legalMoves(state);
  if (!moves.length) return inCheck(state) ? -MATE + ply : 0;
  const standPat = evaluate(state);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (depthLeft <= 0) return alpha;
  const captures = orderMoves(state, moves.filter((move) => capturedValue(state, move) || move.promo === 'q'));
  for (const move of captures) {
    const score = -quiesce(applyMove(state, move), -beta, -alpha, ply + 1, search, depthLeft - 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(state, depth, alpha, beta, ply, search) {
  search.tick();
  if (depth <= 0) return search.quiescence ? quiesce(state, alpha, beta, ply, search, 4) : evaluate(state);
  const moves = legalMoves(state);
  if (!moves.length) return inCheck(state) ? -MATE + ply : 0;
  if (state.halfmove >= 100) return 0;
  for (const move of orderMoves(state, moves)) {
    const score = -negamax(applyMove(state, move), depth - 1, -beta, -alpha, ply + 1, search);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

export const AI_LEVELS = {
  easy: { label: 'Easy', maxDepth: 1, quiescence: false, noise: 160, randomMoveChance: 0.2, timeMs: 400 },
  medium: { label: 'Medium', maxDepth: 2, quiescence: true, noise: 25, randomMoveChance: 0, timeMs: 1000 },
  hard: { label: 'Hard', maxDepth: 5, quiescence: true, noise: 4, randomMoveChance: 0, timeMs: 1800 },
};

// Picks a move for the side to move. Deeper levels search longer; easier levels add randomness.
export function chooseAiMove(state, { level = 'medium', random = Math.random, timeMs } = {}) {
  const settings = AI_LEVELS[level] ?? AI_LEVELS.medium;
  const moves = legalMoves(state).filter((move) => !move.promo || move.promo === 'q');
  if (!moves.length) return null;
  if (random() < settings.randomMoveChance) return moves[Math.floor(random() * moves.length)];

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const deadline = now() + (timeMs ?? settings.timeMs);
  let nodes = 0;
  const search = {
    quiescence: settings.quiescence,
    tick() {
      nodes += 1;
      if ((nodes & 255) === 0 && now() > deadline) throw TIMEOUT;
    },
  };
  // Noise is fixed per move for this decision, so deeper iterations stay consistent.
  const noise = new Map(moves.map((move) => [move, (random() * 2 - 1) * settings.noise]));

  let best = moves[0];
  for (let depth = 1; depth <= settings.maxDepth; depth += 1) {
    let depthBest = null;
    let depthBestScore = -Infinity;
    try {
      for (const move of orderMoves(state, moves, best)) {
        const score = -negamax(applyMove(state, move), depth - 1, -Infinity, Infinity, 1, search) + noise.get(move);
        if (score > depthBestScore) {
          depthBestScore = score;
          depthBest = move;
        }
      }
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      // An unfinished depth is discarded; the last completed depth's choice stands.
      break;
    }
    best = depthBest;
    if (depthBestScore > MATE / 2) break;
  }
  return best;
}
