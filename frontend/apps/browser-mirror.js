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
      const area = inset(rect(0, 0, 1, 1), 0.02);
      if (!stream) {
        const [intro, status, action] = rows(inset(area, 0.04), [3, 1, 1.2], 0.04);
        return [
          text('intro', intro, 'Open Google, YouTube, or any site in Chrome on the laptop screen, then choose that window to show it here.', ['pre']),
          text('status', status, message || (requesting ? 'Pick a window on the laptop screen...' : 'Needs a mouse click on this button.'), ['small', 'bare', message ? 'error' : 'muted']),
          button('choose', action, requesting ? 'Waiting...' : 'Choose window', ['primary', 'large'], { disabled: requesting }),
        ];
      }
      const [bar, view] = rows(area, [0.9, 8], 0.015);
      const [name, change, end] = columns(bar, [4, 1.4, 1], 0.015);
      return [
        text('label', name, label, ['left', 'bare', 'small', 'muted']),
        button('choose', change, 'Change window', 'small'),
        button('stop', end, 'Stop', ['danger', 'small']),
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
