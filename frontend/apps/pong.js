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

const LEFT_COLOR = '#a78bfa';
const RIGHT_COLOR = '#ffb547';

function roundedRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
  g.fill();
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
  const scale = width / game.width;

  const background = g.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.7);
  background.addColorStop(0, '#141a33');
  background.addColorStop(1, '#070a16');
  g.fillStyle = background;
  g.fillRect(0, 0, width, height);

  g.strokeStyle = 'rgba(167, 139, 250, 0.28)';
  g.lineWidth = Math.max(2, unit * 0.006);
  g.setLineDash([unit * 0.025, unit * 0.035]);
  g.beginPath();
  g.moveTo(width / 2, unit * 0.03);
  g.lineTo(width / 2, height - unit * 0.03);
  g.stroke();
  g.setLineDash([]);

  g.font = `200 ${Math.max(28 * dpr, Math.min(96 * dpr, Math.round(unit * 0.2)))}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillStyle = 'rgba(167, 139, 250, 0.55)';
  g.fillText(String(game.left.score), width * 0.36, unit * 0.04);
  g.fillStyle = 'rgba(255, 181, 71, 0.55)';
  g.fillText(String(game.right.score), width * 0.64, unit * 0.04);

  const paddleRadius = PADDLE_WIDTH * scale / 2;
  g.shadowBlur = unit * 0.04;
  g.shadowColor = LEFT_COLOR;
  g.fillStyle = LEFT_COLOR;
  roundedRect(g, PADDLE_MARGIN * scale, (game.left.y - PADDLE_HEIGHT / 2) * unit, PADDLE_WIDTH * scale, PADDLE_HEIGHT * unit, paddleRadius);
  g.shadowColor = RIGHT_COLOR;
  g.fillStyle = RIGHT_COLOR;
  roundedRect(g, (game.width - PADDLE_MARGIN - PADDLE_WIDTH) * scale, (game.right.y - PADDLE_HEIGHT / 2) * unit, PADDLE_WIDTH * scale, PADDLE_HEIGHT * unit, paddleRadius);
  g.shadowColor = '#ffffff';
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(game.ball.x * scale, game.ball.y * unit, (BALL_SIZE * unit) / 2, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;

  let banner = '';
  if (game.winner) {
    banner = mode === 'ai'
      ? (game.winner === 'left' ? 'You win!' : 'Computer wins')
      : `Player ${game.winner === 'left' ? 1 : 2} wins!`;
  } else if (paused) {
    banner = 'Paused';
  }
  if (banner) {
    g.fillStyle = 'rgba(7, 10, 22, 0.72)';
    g.fillRect(0, 0, width, height);
    g.fillStyle = '#ffffff';
    const bannerFont = Math.max(28 * dpr, Math.min(64 * dpr, Math.round(unit * 0.12)));
    g.font = `700 ${bannerFont}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
    g.textBaseline = 'middle';
    const lines = g.measureText(banner).width > width - 24 * dpr ? banner.split(' ') : [banner];
    const lineHeight = Math.max(bannerFont * 1.1, Math.min(unit * 0.25, 44 * dpr));
    lines.forEach((line, index) => {
      g.fillText(line, width / 2, unit * 0.5 + (index - (lines.length - 1) / 2) * lineHeight, width - 20 * dpr);
    });
  }
}

function create(ctx) {
  let mode = null; // null = menu, 'ai' or 'two'
  let game = null;
  let paused = false;
  let frame = 0;
  let lastTime = 0;
  const p2Keys = { up: false, down: false };

  function gameLayout() {
    const { width, height } = ctx.size();
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w < 280 || h < 180) return null;
    const compact = w < 720;
    const margin = 8;
    const gap = 8;
    const barWidth = w - 2 * margin;
    if (compact) {
      const status = rect(margin / w, margin / h, barWidth / w, 38 / h);
      const controls = rect(margin / w, 54 / h, barWidth / w, 48 / h);
      const [pause, restart, menu] = columns(controls, [1, 1, 1], gap / w);
      const field = rect(margin / w, 110 / h, barWidth / w, (h - 118) / h);
      return { status, pause, restart, menu, field };
    }
    const bar = rect(margin / w, margin / h, barWidth / w, 48 / h);
    const [status, pause, restart, menu] = columns(bar, [3, 1.2, 1.3, 1.1], gap / w);
    const field = rect(margin / w, 64 / h, barWidth / w, (h - 72) / h);
    return { status, pause, restart, menu, field };
  }

  function fieldAspect() {
    const { width, height } = ctx.size();
    const field = gameLayout()?.field;
    const w = width * (field?.width ?? 0.96);
    const h = height * (field?.height ?? 0.75);
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
        const { width, height } = ctx.size();
        if (width < 280 || height < 180) {
          return [text('hint', rect(0.06, 0.1, 0.88, 0.8), 'Expand window to play Pong', ['title', 'muted'])];
        }
        const stacked = width < 460 && height >= 230;
        const [title, hint, choices] = rows(inset(rect(0, 0, 1, 1), 0.04), [1.2, 1, stacked ? 2.2 : 1.2], 0.025);
        const [solo, duo] = stacked ? rows(choices, [1, 1], 8 / height) : columns(choices, [1, 1], 8 / width);
        return [
          text('title', title, 'PONG', ['huge', 'accent-text']),
          text('hint', hint, width < 500 ? 'Pointer: left paddle. Up / Down: right.' : 'Player 1 moves the left paddle with the pointer. Player 2 uses the Up and Down arrow keys.', ['small', 'muted']),
          button('play-ai', solo, '1 player', 'primary', { icon: 'cpu' }),
          button('play-two', duo, '2 players', undefined, { icon: 'users' }),
        ];
      }
      const layout = gameLayout();
      if (!layout) {
        return [
          text('expand', rect(0.06, 0.04, 0.88, 0.46), 'Expand window to play Pong', ['title', 'muted']),
          button('menu', rect(0.08, 0.54, 0.84, 0.4), 'Menu', 'subtle'),
        ];
      }
      const { status, pause, restart, menu, field } = layout;
      return [
        text('status', status, mode === 'ai' ? 'You vs Computer' : 'Pointer vs Arrow keys', 'chip', { icon: mode === 'ai' ? 'cpu' : 'users' }),
        button('pause', pause, paused ? 'Resume' : 'Pause', 'subtle', { icon: paused ? 'play' : 'pause', disabled: !!game?.winner }),
        button('restart', restart, game?.winner ? 'Again' : 'Restart', game?.winner ? 'primary' : 'subtle', { icon: 'reset' }),
        button('menu', menu, 'Menu', 'ghost', { icon: 'home' }),
        { id: 'field', type: 'canvas', ...field },
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
      const field = gameLayout()?.field;
      if (!field) return false;
      const inside = event.x >= field.x && event.x <= field.x + field.width && event.y >= field.y && event.y <= field.y + field.height;
      if (!inside) return false;
      game.left.target = clampPaddle((event.y - field.y) / field.height);
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
