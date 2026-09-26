import { button, text, rows, columns, rect, inset } from './layout.js';

// Shows a live capture of a real browser window from the laptop screen (for example Chrome with
// Google or YouTube open) inside a projected window. Sites like these refuse to load in an iframe,
// so the page is mirrored instead. The mirror is view-only: pointer input is not sent to the window.
//
// Browsers only allow screen capture right after a real click or key press, so "Choose window"
// must be clicked with the mouse. A pinch arrives over WebSocket and does not count.

function create(ctx) {
  let stream = null;
  let label = '';
  let message = '';
  let requesting = false;

  function stop() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    label = '';
  }

  async function choose() {
    if (requesting) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      message = 'Screen capture is not available here. Open the page from http://localhost in Chrome or Edge.';
      return;
    }
    requesting = true;
    message = '';
    // getDisplayMedia must be called synchronously inside the click that triggered it.
    const request = navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window', frameRate: 30 },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
    try {
      const newStream = await request;
      stop();
      stream = newStream;
      const [track] = stream.getVideoTracks();
      label = track?.label || 'Shared window';
      track?.addEventListener('ended', () => {
        if (stream === newStream) {
          stop();
          message = 'Sharing stopped.';
          ctx.update();
        }
      });
    } catch (error) {
      message = error.name === 'NotAllowedError'
        ? 'Capture was canceled or blocked. Click "Choose window" with the mouse (a pinch cannot open the picker).'
        : `Could not capture a window: ${error.message}`;
    } finally {
      requesting = false;
      ctx.update();
    }
  }

  ctx.onDestroy(stop);

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.035);
      if (!stream) {
        const [hero, status, action] = rows(area, [3.4, 0.7, 1.2], 0.035);
        const [iconCell, copy] = columns(hero, [1, 2.6], 0.03);
        const [heading, steps] = rows(copy, [1, 2], 0.03);
        return [
          text('hero', hero, '', 'hero'),
          text('hero-icon', iconCell, '', 'glyph', { icon: 'monitor' }),
          text('heading', heading, 'Mirror a browser window', ['title', 'left']),
          text('steps', steps, '1. Open Google, YouTube, or any site in Chrome on the laptop screen.\n2. Click "Choose window" with the mouse and pick it.', ['pre', 'small', 'muted', 'left']),
          text('status', status, message || (requesting ? 'Pick a window on the laptop screen...' : 'The picker needs a real mouse click; a pinch cannot open it.'), ['small', message ? 'error' : 'faint']),
          button('choose', action, requesting ? 'Waiting for picker...' : 'Choose window', ['primary', 'large'], { icon: 'monitor', disabled: requesting }),
        ];
      }
      const [bar, view] = rows(inset(rect(0, 0, 1, 1), 0.02), [0.9, 8], 0.015);
      const [name, change, end] = columns(bar, [4, 1.5, 1.1], 0.015);
      return [
        text('label', name, label, ['left', 'small', 'muted'], { icon: 'globe' }),
        button('choose', change, 'Change', 'subtle', { icon: 'monitor' }),
        button('stop', end, 'Stop', 'danger', { icon: 'stop' }),
        { id: 'view', type: 'video', ...view },
      ];
    },
    afterRender() {
      const video = ctx.element('view');
      if (video && video.srcObject !== stream) {
        video.srcObject = stream;
        video.play?.().catch(() => {});
      }
    },
    handleAction({ widget_id: id }) {
      if (id === 'choose') choose();
      else if (id === 'stop') { stop(); message = ''; }
    },
  };
}

export default { title: 'Web browser', create };
