import { button, text, rows, columns, rect, inset } from './layout.js';

// Field units: height is 1, width follows the canvas aspect ratio. Speeds are field heights per second.
const WIN_SCORE = 7;
const PADDLE_HEIGHT = 0.2;
const PADDLE_WIDTH = 0.022;
const PADDLE_MARGIN = 0.04;
const BALL_SIZE = 0.022;
const SERVE_SPEED = 0.75;
const MAX_SPEED = 2.2;
const KEY_PADDLE_SPEED = 1.3;
const AI_SPEED = 0.95;

const TOP_BAR = rect(0.02, 0.02, 0.96, 0.1);
const FIELD = rect(0.02, 0.14, 0.96, 0.84);

export function createPongGame(aspect = 1.6) {
  const game = {
    width: aspect,
    left: { y: 0.5, target: 0.5, score: 0 },
    right: { y: 0.5, target: 0.5, score: 0 },
    ball: { x: aspect / 2, y: 0.5, vx: 0, vy: 0 },
    serveIn: 1,
    winner: null,
  };
  serve(game, Math.random() < 0.5 ? -1 : 1);
  return game;
}

function serve(game, direction) {
  const angle = (Math.random() * 0.8 - 0.4);
  game.ball = { x: game.width / 2, y: 0.5, vx: direction * SERVE_SPEED * Math.cos(angle), vy: SERVE_SPEED * Math.sin(angle) };
  game.serveIn = 0.8;
}

const clampPaddle = (y) => Math.min(1 - PADDLE_HEIGHT / 2, Math.max(PADDLE_HEIGHT / 2, y));

function bounceOffPaddle(ball, paddleY, direction) {
  // Hitting near the paddle's edge sends the ball off at a steeper angle.
  const offset = Math.max(-1, Math.min(1, (ball.y - paddleY) / (PADDLE_HEIGHT / 2)));
  const speed = Math.min(MAX_SPEED, Math.hypot(ball.vx, ball.vy) * 1.06);
  const angle = offset * 1.0;
  ball.vx = direction * speed * Math.cos(angle);
  ball.vy = speed * Math.sin(angle);
}

// Advances the game by dt seconds. p2Keys is { up, down } for keyboard control of the right paddle.
export function stepPong(game, dt, { ai = false, p2Keys = { up: false, down: false } } = {}) {
  if (game.winner) return;
  const { ball, left, right } = game;

  left.y = clampPaddle(left.y + (left.target - left.y) * Math.min(1, dt * 18));
  if (ai) {
    // The AI tracks the ball only while it approaches, with a capped speed so it can be beaten.
    const goal = ball.vx > 0 ? ball.y : 0.5;
    const move = Math.max(-AI_SPEED * dt, Math.min(AI_SPEED * dt, goal - right.y));
    right.y = clampPaddle(right.y + move);
  } else {
    right.y = clampPaddle(right.y + ((p2Keys.down ? 1 : 0) - (p2Keys.up ? 1 : 0)) * KEY_PADDLE_SPEED * dt);
  }

  if (game.serveIn > 0) {
    game.serveIn -= dt;
    return;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  const half = BALL_SIZE / 2;
  if (ball.y < half) { ball.y = half; ball.vy = Math.abs(ball.vy); }
  if (ball.y > 1 - half) { ball.y = 1 - half; ball.vy = -Math.abs(ball.vy); }

  const leftFace = PADDLE_MARGIN + PADDLE_WIDTH;
  const rightFace = game.width - PADDLE_MARGIN - PADDLE_WIDTH;
  if (ball.vx < 0 && ball.x - half <= leftFace && ball.x - half >= PADDLE_MARGIN - BALL_SIZE
      && Math.abs(ball.y - left.y) <= PADDLE_HEIGHT / 2 + half) {
    ball.x = leftFace + half;
    bounceOffPaddle(ball, left.y, 1);
  }
  if (ball.vx > 0 && ball.x + half >= rightFace && ball.x + half <= game.width - PADDLE_MARGIN + BALL_SIZE
      && Math.abs(ball.y - right.y) <= PADDLE_HEIGHT / 2 + half) {
    ball.x = rightFace - half;
    bounceOffPaddle(ball, right.y, -1);
  }

  if (ball.x < -BALL_SIZE) {
    right.score += 1;
    serve(game, -1);
  } else if (ball.x > game.width + BALL_SIZE) {
    left.score += 1;
    serve(game, 1);
  }
  if (left.score >= WIN_SCORE) game.winner = 'left';
  if (right.score >= WIN_SCORE) game.winner = 'right';
}

function draw(canvas, game, { paused, mode }) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const g = canvas.getContext('2d');
  const unit = height;
  g.fillStyle = '#0c1120';
  g.fillRect(0, 0, width, height);

  g.strokeStyle = 'rgba(145, 164, 255, 0.35)';
  g.lineWidth = Math.max(2, unit * 0.006);
  g.setLineDash([unit * 0.03, unit * 0.03]);
  g.beginPath();
  g.moveTo(width / 2, 0);
  g.lineTo(width / 2, height);
  g.stroke();
  g.setLineDash([]);

  g.fillStyle = 'rgba(243, 246, 255, 0.85)';
  g.font = `600 ${Math.round(unit * 0.16)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillText(String(game.left.score), width * 0.35, unit * 0.05);
  g.fillText(String(game.right.score), width * 0.65, unit * 0.05);

  const scale = width / game.width;
  g.fillStyle = '#91a4ff';
  g.fillRect(PADDLE_MARGIN * scale, (game.left.y - PADDLE_HEIGHT / 2) * unit, PADDLE_WIDTH * scale, PADDLE_HEIGHT * unit);
  g.fillStyle = '#ffb347';
  g.fillRect((game.width - PADDLE_MARGIN - PADDLE_WIDTH) * scale, (game.right.y - PADDLE_HEIGHT / 2) * unit, PADDLE_WIDTH * scale, PADDLE_HEIGHT * unit);
  g.fillStyle = '#ffffff';
  g.fillRect((game.ball.x - BALL_SIZE / 2) * scale, (game.ball.y - BALL_SIZE / 2) * unit, BALL_SIZE * unit, BALL_SIZE * unit);

  let banner = '';
  if (game.winner) {
    banner = mode === 'ai'
      ? (game.winner === 'left' ? 'You win!' : 'Computer wins')
      : `Player ${game.winner === 'left' ? 1 : 2} wins!`;
  } else if (paused) {
    banner = 'Paused';
  }
  if (banner) {
    g.fillStyle = 'rgba(12, 17, 32, 0.7)';
    g.fillRect(0, unit * 0.38, width, unit * 0.24);
    g.fillStyle = '#ffffff';
    g.font = `700 ${Math.round(unit * 0.11)}px system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(banner, width / 2, unit * 0.5);
  }
}

function create(ctx) {
  let mode = null; // null = menu, 'ai' or 'two'
  let game = null;
  let paused = false;
  let frame = 0;
  let lastTime = 0;
  const p2Keys = { up: false, down: false };

  function fieldAspect() {
    const { width, height } = ctx.size();
    const w = width * FIELD.width;
    const h = height * FIELD.height;
    return w > 0 && h > 0 ? w / h : 1.6;
  }

  function start(newMode) {
    mode = newMode;
    game = createPongGame(fieldAspect());
    paused = false;
    lastTime = performance.now();
    if (!frame) frame = requestAnimationFrame(loop);
  }

  function loop(now) {
    frame = 0;
    if (ctx.destroyed || !game) return;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    // Keep the field matched to the window if it is resized mid game.
    const aspect = fieldAspect();
    if (Math.abs(aspect - game.width) > 0.01) {
      game.ball.x *= aspect / game.width;
      game.width = aspect;
    }
    const wasWinner = game.winner;
    if (!paused) stepPong(game, dt, { ai: mode === 'ai', p2Keys });
    const canvas = ctx.element('field');
    if (canvas) draw(canvas, game, { paused, mode });
    if (game.winner && !wasWinner) ctx.update();
    frame = requestAnimationFrame(loop);
  }

  ctx.onDestroy(() => cancelAnimationFrame(frame));

  return {
    widgets() {
      if (!mode) {
        const [title, hint, choices] = rows(inset(rect(0, 0, 1, 1), 0.06), [1.2, 1, 1.4], 0.05);
        const [solo, duo] = columns(choices, [1, 1], 0.04);
        return [
          text('title', title, 'Pong', ['bare', 'huge']),
          text('hint', hint, 'Player 1 moves the left paddle with the pointer. Player 2 uses the Up and Down arrow keys.', ['bare', 'small', 'muted']),
          button('play-ai', solo, '1 player vs AI', ['primary', 'large']),
          button('play-two', duo, '2 players', ['large']),
        ];
      }
      const [status, pause, restart, menu] = columns(TOP_BAR, [3, 1, 1, 1], 0.015);
      return [
        text('status', status, mode === 'ai' ? 'You (left) vs AI' : 'P1 pointer vs P2 arrow keys', ['left', 'bare', 'small', 'muted']),
        button('pause', pause, paused ? 'Resume' : 'Pause', undefined, { disabled: !!game?.winner }),
        button('restart', restart, game?.winner ? 'Play again' : 'Restart', game?.winner ? 'accent' : undefined),
        button('menu', menu, 'Menu', 'ghost'),
        { id: 'field', type: 'canvas', ...FIELD },
      ];
    },
    afterRender() {
      // Draws once after layout changes so a paused or finished game stays visible.
      const canvas = ctx.element('field');
      if (canvas && game) draw(canvas, game, { paused, mode });
    },
    handleAction({ widget_id: id }) {
      if (id === 'play-ai') start('ai');
      else if (id === 'play-two') start('two');
      else if (id === 'pause') paused = !paused;
      else if (id === 'restart') start(mode);
      else if (id === 'menu') { mode = null; game = null; cancelAnimationFrame(frame); frame = 0; }
    },
    // The left paddle follows the pointer's height anywhere over the field.
    handlePointer(event) {
      if (!game || event.type !== 'pointer_move' && event.type !== 'pointer_down') return false;
      const inside = event.x >= FIELD.x && event.x <= FIELD.x + FIELD.width && event.y >= FIELD.y && event.y <= FIELD.y + FIELD.height;
      if (!inside) return false;
      game.left.target = clampPaddle((event.y - FIELD.y) / FIELD.height);
      return true;
    },
    handleKey(event) {
      const down = event.type === 'keydown';
      if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') { p2Keys.up = down; return true; }
      if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') { p2Keys.down = down; return true; }
      if (event.key === ' ' && down && game && !game.winner) { paused = !paused; return true; }
      return false;
    },
  };
}

export default { title: 'Pong', create };
