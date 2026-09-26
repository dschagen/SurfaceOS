// Transport only: forwards the hand tracker's WebSocket messages (docs/input.md) to the shell's
// input handler, which already takes the same v1 events from the mouse.
// ?hand=off disables it; ?hand=ws://host:port connects somewhere other than the default.

const DEFAULT_URL = 'ws://localhost:8765';
const RETRY_MS = 2000;
const setting = new URLSearchParams(location.search).get('hand');
const indicator = document.querySelector('#hand-status');

function showHands(hands) {
  window.dispatchEvent(new CustomEvent('surfaceos:hand-debug', { detail: hands }));
}

function show(text, live) {
  if (!indicator) return;
  indicator.textContent = text;
  indicator.classList.toggle('live', live);
}

function connect(url) {
  let opened = false;
  let socket;
  try {
    socket = new WebSocket(url);
  } catch (error) {
    show('Hand · bad URL', false);
    console.error('Hand input URL is invalid', url, error);
    return;
  }
  socket.addEventListener('open', () => {
    opened = true;
    show('Hand · connected', true);
  });
  socket.addEventListener('message', (e) => {
    let message;
    try {
      message = JSON.parse(e.data);
    } catch {
      console.warn('Ignoring hand message that is not JSON', e.data);
      return;
    }
    if (!message || typeof message !== 'object' || message.version !== 1 || typeof message.type !== 'string') {
      console.warn('Ignoring malformed hand message', message);
      return;
    }
    // The debug snapshot of all tracked hands goes to the bubble overlay, not the shell.
    if (message.type === 'hand_debug') {
      if (Array.isArray(message.hands)) showHands(message.hands);
      return;
    }
    window.SurfaceOS?.dispatchInput(message);
  });
  socket.addEventListener('close', () => {
    showHands([]);
    // A dropped tracker releases any hand press; failed reconnects must not cancel mouse work.
    if (opened) window.SurfaceOS?.dispatchInput({ version: 1, type: 'pointer_cancel', source: 'hand' });
    show('Hand · offline (mouse works)', false);
    setTimeout(() => connect(url), RETRY_MS);
  });
}

if (setting === 'off') show('Hand · off', false);
else connect(setting || DEFAULT_URL);
