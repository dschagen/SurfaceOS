import { button, text, rows, columns, rect, inset } from './layout.js';

// Plays one YouTube video per window with YouTube's IFrame Player API. SurfaceOS buttons drive the
// player, so mouse and hand input both go through the normal widget pointer path; the embedded
// player itself ignores pointer input (see widgets.css).

export const DEMO_VIDEOS = [
  { id: 'VN5K8zFwaPI', title: '11:57PM ASMR Golf in Norway' },
  { id: 'jNQXAC9IVRw', title: 'Me at the zoo' },
  { id: 'M7lc1UVf-VE', title: 'Embedded Web Player Customization' },
];

const API_URL = 'https://www.youtube.com/iframe_api';
const API_TIMEOUT_MS = 12000;
// If playback has not started this long after Play, the browser most likely blocked sound.
const SOUND_BLOCK_CHECK_MS = 2500;
const VOLUME_STEP = 10;
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// YT.PlayerState values.
const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

const PLAYER_ERRORS = {
  2: 'YouTube did not accept that video ID.',
  5: 'This video cannot play in the embedded player.',
  100: 'Video not found. It may be private or removed.',
  // YouTube also uses 101 and 150 for videos that are missing or private, not only embed-disabled ones.
  101: 'This video cannot play here. It may be unavailable, private, or not allowed outside YouTube.',
  150: 'This video cannot play here. It may be unavailable, private, or not allowed outside YouTube.',
  153: 'YouTube refused the embed request. Open SurfaceOS from http://localhost.',
};

// "90", "90s", "1m30s", "1h2m3s" -> seconds.
export function parseStartTime(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

// Accepts an 11-character video ID or a youtube.com / youtu.be link. Returns { id, start } or null.
export function parseYouTubeInput(input) {
  const value = String(input ?? '').trim();
  if (!value) return null;
  if (ID_PATTERN.test(value)) return { id: value, start: 0 };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const [, kind, value2] = url.pathname.split('/');
      if (['embed', 'shorts', 'live', 'v'].includes(kind)) id = value2;
    }
  }
  if (!id || !ID_PATTERN.test(id)) return null;
  return { id, start: parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// One shared script load for every YouTube window on the page.
let apiPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const fail = (message) => {
      clearTimeout(timer);
      apiPromise = null;
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('YouTube did not respond. Check the internet connection.'), API_TIMEOUT_MS);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => fail('Could not load the YouTube player. Check the internet connection or network filters.');
    document.head.append(script);
  });
  return apiPromise;
}

function create(ctx) {
  let videoId = DEMO_VIDEOS[0].id;
  let startSeconds = 0;
  let demoIndex = 0;
  let api = 'loading'; // 'loading' | 'ready' | 'failed'
  let apiError = '';
  let player = null;
  let playerReady = false;
  let playerState = STATE.UNSTARTED;
  let loadingVideo = true;
  // A player error is about the current video; an input error only about the typed text.
  let error = '';
  let inputError = '';
  let notice = '';
  let volume = 70;
  let muted = false;
  let draft = '';
  let title = DEMO_VIDEOS[0].title;
  let currentTime = 0;
  let duration = 0;
  let cancelSoundCheck = null;

  function requestApi() {
    api = 'loading';
    apiError = '';
    loadYouTubeApi().then(() => {
      if (ctx.destroyed) return;
      api = 'ready';
      ctx.update();
    }, (failure) => {
      if (ctx.destroyed) return;
      api = 'failed';
      apiError = failure.message;
      ctx.update();
    });
  }

  function refreshTimes() {
    if (!playerReady) return;
    currentTime = player.getCurrentTime?.() ?? 0;
    duration = player.getDuration?.() ?? 0;
  }

  function createPlayer(container) {
    const mount = document.createElement('div');
    container.replaceChildren(mount);
    player = new window.YT.Player(mount, {
      width: '100%',
      height: '100%',
      videoId,
      playerVars: {
        controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0,
        start: startSeconds, origin: window.location.origin,
      },
      events: {
        onReady() {
          if (ctx.destroyed) return;
          playerReady = true;
          player.setVolume(volume);
          if (muted) player.mute();
          ctx.update();
        },
        onStateChange(event) {
          if (ctx.destroyed) return;
          playerState = event.data;
          if (playerState !== STATE.UNSTARTED) loadingVideo = false;
          if (playerState === STATE.PLAYING) {
            error = '';
            cancelSoundCheck?.();
            const data = player.getVideoData?.();
            if (data?.title) title = data.title;
          }
          refreshTimes();
          ctx.update();
        },
        onError(event) {
          if (ctx.destroyed) return;
          loadingVideo = false;
          cancelSoundCheck?.();
          error = PLAYER_ERRORS[event.data] ?? `YouTube player error ${event.data}.`;
          ctx.update();
        },
      },
    });
  }

  function play() {
    if (!playerReady || error) return;
    if (playerState === STATE.ENDED) player.seekTo(0, true);
    player.playVideo();
    cancelSoundCheck?.();
    // Browsers refuse to start video with sound until the page has had a real click or key press.
    // A pinch does not count, so fall back to muted playback instead of silently doing nothing.
    cancelSoundCheck = ctx.after(SOUND_BLOCK_CHECK_MS, () => {
      cancelSoundCheck = null;
      if (playerState === STATE.PLAYING || playerState === STATE.BUFFERING || muted || error) return;
      muted = true;
      player.mute();
      player.playVideo();
      notice = 'The browser blocked sound until the page gets a mouse click. Playing muted.';
      ctx.update();
    });
  }

  function load(parsed, label) {
    videoId = parsed.id;
    startSeconds = parsed.start;
    title = label ?? '';
    error = '';
    inputError = '';
    notice = '';
    loadingVideo = true;
    currentTime = 0;
    duration = 0;
    if (playerReady) {
      player.loadVideoById({ videoId, startSeconds });
      play();
    }
  }

  function submitDraft() {
    const parsed = parseYouTubeInput(draft);
    if (!parsed) {
      inputError = draft.trim() ? 'That is not a YouTube link or video ID.' : 'Paste a YouTube link or video ID first.';
      return;
    }
    draft = '';
    load(parsed);
  }

  requestApi();
  // Keeps the time display moving while a video plays.
  ctx.every(500, () => {
    if (playerReady && playerState === STATE.PLAYING) {
      refreshTimes();
      ctx.update();
    }
  });
  ctx.onDestroy(() => {
    cancelSoundCheck?.();
    player?.destroy?.();
    player = null;
  });

  function videoArea(area) {
    // The largest 16:9 rectangle that fits, centered.
    const aspect = ctx.aspect();
    const areaRatio = (area.width * aspect) / area.height;
    if (areaRatio > 16 / 9) {
      const width = (area.height * 16) / 9 / aspect;
      return rect(area.x + (area.width - width) / 2, area.y, width, area.height);
    }
    const height = (area.width * aspect * 9) / 16;
    return rect(area.x, area.y + (area.height - height) / 2, area.width, height);
  }

  function statusLine() {
    if (inputError) return { message: inputError, variant: 'error' };
    if (error) return { message: error, variant: 'error' };
    if (api === 'loading') return { message: 'Loading YouTube player...', variant: 'muted' };
    if (!playerReady) return { message: 'Starting player...', variant: 'muted' };
    if (loadingVideo) return { message: 'Loading video...', variant: 'muted' };
    if (notice) return { message: notice, variant: 'accent-text' };
    return { message: title || 'YouTube', variant: 'muted' };
  }

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.025);
      const [bar, stage, status, controls] = rows(area, [0.85, 6, 0.6, 1.15], 0.022);
      const [urlCell, loadCell, demoCell] = columns(bar, [5, 1.3, 1.7], 0.015);
      const video = videoArea(stage);
      const ready = playerReady && !error;
      // Narrow windows show icons only on the secondary controls so labels never wrap.
      const compact = ctx.size().width < 640;
      const label = (full) => (compact ? '' : full);
      const playing = playerState === STATE.PLAYING || playerState === STATE.BUFFERING;
      const widgets = [
        { id: 'url', type: 'input', ...urlCell, value: draft, placeholder: 'Paste a YouTube link or video ID, then press Enter' },
        button('load', loadCell, 'Load', 'primary', { disabled: !playerReady }),
        button('demo', demoCell, label('Next demo'), 'subtle', { icon: 'refresh', disabled: !playerReady }),
        { id: 'player', type: 'embed', ...video },
      ];

      if (api === 'failed') {
        const [message, retry] = rows(inset(video, video.width * 0.1, video.height * 0.18), [2, 1], 0.04);
        widgets.push(
          text('overlay', message, apiError, ['overlay', 'error']),
          button('retry', retry, 'Try again', 'primary', { icon: 'refresh' }),
        );
      } else if (error) {
        widgets.push(text('overlay', inset(video, video.width * 0.08, video.height * 0.3), `${error}\nLoad another video or press Next demo.`, ['overlay', 'error']));
      } else if (api === 'loading' || !playerReady) {
        widgets.push(text('overlay', inset(video, video.width * 0.2, video.height * 0.38), 'Loading YouTube...', ['overlay', 'muted']));
      } else {
        widgets.push(button('video', video, '', 'video-hit'));
      }

      const { message, variant } = statusLine();
      const [statusCell, timeCell] = columns(status, [3, 1.4], 0.02);
      widgets.push(
        text('status', statusCell, message, ['left', 'small', variant]),
        text('time', timeCell, `${formatTime(currentTime)} / ${formatTime(duration)} · ${muted ? 'Muted' : `Vol ${volume}%`}`, ['right', 'small', 'muted', 'mono']),
      );

      const [restartCell, playCell, downCell, muteCell, upCell] = columns(controls, [1, 1.5, 1, 1, 1], 0.02);
      widgets.push(
        button('restart', restartCell, label('Restart'), undefined, { icon: 'reset', disabled: !ready }),
        button('play', playCell, playing ? 'Pause' : 'Play', compact ? 'primary' : ['primary', 'large'], { icon: playing ? 'pause' : 'play', disabled: !ready }),
        button('volume-down', downCell, label('Vol −'), undefined, { icon: 'volume-down', disabled: !playerReady }),
        button('mute', muteCell, label(muted ? 'Unmute' : 'Mute'), muted ? 'selected' : undefined, { icon: muted ? 'volume-up' : 'mute', disabled: !playerReady }),
        button('volume-up', upCell, label('Vol +'), undefined, { icon: 'volume-up', disabled: !playerReady }),
      );
      return widgets;
    },

    afterRender() {
      const container = ctx.element('player');
      if (api === 'ready' && container && !player) createPlayer(container);
    },

    handleAction(action) {
      const id = action.widget_id;
      if (id === 'url') {
        if (typeof action.value === 'string') draft = action.value;
        if (action.event === 'change') inputError = '';
        if (action.event === 'submit' && playerReady) submitDraft();
        return;
      }
      if (id === 'retry') { requestApi(); return; }
      if (!playerReady) return;
      switch (id) {
        case 'load': submitDraft(); break;
        case 'demo': {
          demoIndex = (demoIndex + 1) % DEMO_VIDEOS.length;
          const demo = DEMO_VIDEOS[demoIndex];
          load({ id: demo.id, start: 0 }, demo.title);
          break;
        }
        case 'play': case 'video':
          if (playerState === STATE.PLAYING || playerState === STATE.BUFFERING) player.pauseVideo();
          else play();
          break;
        case 'restart':
          player.seekTo(0, true);
          play();
          break;
        case 'volume-down': case 'volume-up':
          volume = Math.max(0, Math.min(100, volume + (id === 'volume-up' ? VOLUME_STEP : -VOLUME_STEP)));
          player.setVolume(volume);
          if (id === 'volume-up' && muted) { muted = false; player.unMute(); notice = ''; }
          break;
        case 'mute':
          muted = !muted;
          if (muted) player.mute();
          else { player.unMute(); notice = ''; }
          break;
        default: break;
      }
    },
  };
}

export default { title: 'YouTube', create };
