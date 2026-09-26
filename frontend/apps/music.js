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
      const [info, transport, volume] = rows(inset(rect(0, 0, 1, 1), 0.04), [3, 1.5, 1.1], 0.04);
      const widgets = [];
      if (connection === 'offline') {
        widgets.push(text('info', info, 'Media helper is not running.\nStart it with: python tools/media_bridge.py', ['pre', 'small', 'error']));
      } else if (connection === 'connecting') {
        widgets.push(text('info', info, 'Connecting to media helper...', ['muted']));
      } else if (nowPlaying?.title) {
        const [title, artist, source] = rows(info, [1.6, 1, 0.7], 0.02);
        widgets.push(
          text('title', title, nowPlaying.title, ['large', 'bare']),
          text('artist', artist, [nowPlaying.artist, nowPlaying.album].filter(Boolean).join(' - ') || ' ', ['muted', 'bare']),
          text('source', source, [nowPlaying.status, nowPlaying.app].filter(Boolean).join(' in '), ['small', 'muted', 'bare']),
        );
      } else {
        widgets.push(text('info', info, nowPlayingSupported
          ? 'Nothing playing. Start music on the laptop, then use these controls.'
          : 'Track info is unavailable on this system. The controls still work.', ['muted']));
      }

      const offline = connection !== 'online';
      const playing = nowPlaying?.status === 'Playing';
      const labels = {
        previous: 'Prev', play_pause: playing ? 'Pause' : 'Play', next: 'Next',
        volume_down: 'Vol -', mute: 'Mute', volume_up: 'Vol +',
      };
      const transportCells = columns(transport, [1, 1.3, 1], 0.03);
      const volumeCells = columns(volume, [1, 1, 1], 0.03);
      COMMANDS.forEach((command, i) => {
        const cell = i < 3 ? transportCells[i] : volumeCells[i - 3];
        const variant = i < 3 ? ['large'] : [];
        if (command === 'play_pause') variant.push('primary');
        if (command === lastCommand) variant.push('selected');
        widgets.push(button(command, cell, labels[command], variant, { disabled: offline }));
      });
      return widgets;
    },
    handleAction({ widget_id: id }) {
      if (COMMANDS.includes(id)) send(id);
    },
  };
}

export default { title: 'Music', create };
