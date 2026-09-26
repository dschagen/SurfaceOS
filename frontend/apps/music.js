import { button, text, rows, columns, rect, inset } from './layout.js';

// Controls whatever is playing on the laptop (Spotify, a YouTube tab, etc.) through
// tools/media_bridge.py, which presses the system media keys and reports the current track.

const POLL_MS = 2000;
const COMMANDS = ['previous', 'play_pause', 'next', 'volume_down', 'mute', 'volume_up'];

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'X-SurfaceOS': '1' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function create(ctx) {
  const base = ctx.services.mediaBridgeUrl.replace(/\/$/, '');
  let connection = 'connecting'; // 'connecting' | 'online' | 'offline'
  let nowPlaying = null;
  let nowPlayingSupported = true;
  let lastCommand = '';
  let polling = false;

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const status = await request(`${base}/media/status`);
      connection = 'online';
      nowPlaying = status.now_playing ?? null;
      nowPlayingSupported = status.now_playing_supported !== false;
    } catch {
      connection = 'offline';
      nowPlaying = null;
    } finally {
      polling = false;
      ctx.update();
    }
  }

  async function send(command) {
    lastCommand = command;
    try {
      await request(`${base}/media/${command}`, { method: 'POST' });
      connection = 'online';
    } catch {
      connection = 'offline';
    }
    ctx.update();
    // Players take a moment to publish the new track or state.
    ctx.after(500, poll);
    ctx.after(1500, () => { lastCommand = ''; ctx.update(); });
  }

  poll();
  ctx.every(POLL_MS, poll);

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.04);
      const aspect = ctx.aspect();
      const [info, transport, volume] = rows(area, [3.2, 1.6, 0.9], 0.04);
      const widgets = [];
      // Square cover area on the left, track details beside it.
      const artSize = Math.min(info.height, (info.width * aspect) * 0.42);
      const art = rect(info.x, info.y + (info.height - artSize) / 2, artSize / aspect, artSize);
      const details = rect(art.x + art.width + 0.04, info.y, info.x + info.width - art.x - art.width - 0.04, info.height);
      widgets.push(text('art', art, '', 'art', { icon: 'music' }));

      if (connection === 'offline') {
        const [heading, body, retry] = rows(details, [1, 1.6, 1], 0.05);
        widgets.push(
          text('heading', heading, 'Media helper offline', ['title', 'left']),
          text('info', body, 'Start it on the laptop:\npython tools/media_bridge.py', ['pre', 'small', 'muted', 'left']),
          button('retry', retry, 'Retry', 'subtle', { icon: 'refresh' }),
        );
      } else if (connection === 'connecting') {
        widgets.push(text('info', details, 'Connecting...', ['muted', 'left']));
      } else if (nowPlaying?.title) {
        const [source, title, artist] = rows(details, [0.8, 1.6, 1.1], 0.03);
        const status = [nowPlaying.status, nowPlaying.app].filter(Boolean).join(' · ');
        widgets.push(
          text('source', rect(source.x, source.y, Math.min(source.width, 0.3), source.height), status || 'Now playing', 'chip'),
          text('title', title, nowPlaying.title, ['large', 'left']),
          text('artist', artist, [nowPlaying.artist, nowPlaying.album].filter(Boolean).join(' - ') || ' ', ['muted', 'left']),
        );
      } else {
        const [heading, body] = rows(details, [1, 1.4], 0.04);
        widgets.push(
          text('heading', heading, 'Nothing playing', ['title', 'left']),
          text('info', body, nowPlayingSupported ? 'Start music on the laptop, then control it here.' : 'Track info is unavailable. The controls still work.', ['small', 'muted', 'left']),
        );
      }

      const offline = connection !== 'online';
      const playing = nowPlaying?.status === 'Playing';
      const round = (cell, scale = 1) => {
        const size = Math.min(cell.height, cell.width * aspect) * scale;
        return rect(cell.x + (cell.width - size / aspect) / 2, cell.y + (cell.height - size) / 2, size / aspect, size);
      };
      const [prevCell, playCell, nextCell] = columns(transport, [1, 1.2, 1], 0.03);
      widgets.push(
        button('previous', round(prevCell, 0.72), '', ['round', 'subtle', 'large'], { icon: 'previous', disabled: offline }),
        button('play_pause', round(playCell), '', ['round', 'primary', 'large', ...(lastCommand === 'play_pause' ? ['selected'] : [])], { icon: playing ? 'pause' : 'play', disabled: offline }),
        button('next', round(nextCell, 0.72), '', ['round', 'subtle', 'large'], { icon: 'next', disabled: offline }),
      );
      const volumeCells = columns(volume, [1, 1, 1], 0.03);
      [['volume_down', 'volume-down', 'Vol −'], ['mute', 'mute', 'Mute'], ['volume_up', 'volume-up', 'Vol +']].forEach(([command, icon, label], i) => {
        widgets.push(button(command, volumeCells[i], label, lastCommand === command ? 'selected' : 'ghost', { icon, disabled: offline }));
      });
      return widgets;
    },
    handleAction({ widget_id: id }) {
      if (COMMANDS.includes(id)) send(id);
      else if (id === 'retry') { connection = 'connecting'; poll(); }
    },
  };
}

export default { title: 'Music', create };
