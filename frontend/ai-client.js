// Browser side of the AI service contract (src/ai/contract.py, docs/ai.md).
//
// Any app can ask the Python process for Gemini work through this client. The API key stays in
// Python; the browser only sends requests and receives answers. Every request carries the asking
// window's id and a request id, and only replies to this connection's requests arrive here.
//
// ?ai=ws://host:port picks the server; otherwise it follows ?hand=, then ws://localhost:8765.

const DEFAULT_URL = 'ws://localhost:8765';
const RETRY_MS = 2000;
export const REQUEST_TIMEOUT_MS = 45000;
// A desk photo arrives within a second when the tracker is running.
export const SNAPSHOT_TIMEOUT_MS = 6000;

const REPLY_TYPES = { 'ai.request': 'ai.response', 'ai.snapshot': 'ai.capture', 'ai.crop': 'ai.capture' };

function serverUrl() {
  const params = new URLSearchParams(location.search);
  const ai = params.get('ai');
  if (ai && /^wss?:\/\//.test(ai)) return ai;
  const hand = params.get('hand');
  if (hand && /^wss?:\/\//.test(hand)) return hand;
  return DEFAULT_URL;
}

function failure(type, windowId, requestId, code, message) {
  return { version: 1, type, window_id: windowId, request_id: requestId, ok: false, error: { code, message } };
}

export function createAIClient({ url = serverUrl(), WebSocketImpl = window.WebSocket, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let socket = null;
  let status = 'connecting'; // 'connecting' | 'open' | 'closed'
  let counter = 0;
  const pending = new Map(); // request_id -> { windowId, replyType, resolve, timer }
  const statusListeners = new Set();

  function setStatus(next) {
    if (status === next) return;
    status = next;
    for (const fn of statusListeners) fn(status);
  }

  function finish(requestId, reply) {
    const entry = pending.get(requestId);
    if (!entry || reply.type !== entry.replyType) return false;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(reply);
    return true;
  }

  function failAll(code, message) {
    for (const [requestId, entry] of [...pending]) {
      finish(requestId, failure(entry.replyType, entry.windowId, requestId, code, message));
    }
  }

  function connect() {
    setStatus('connecting');
    try {
      socket = new WebSocketImpl(url);
    } catch (error) {
      console.error('AI service URL is invalid', url, error);
      setStatus('closed');
      return;
    }
    socket.addEventListener('open', () => setStatus('open'));
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      // The same server also broadcasts hand input; only replies to this client's requests matter here.
      if (message?.version !== 1 || typeof message.request_id !== 'string') return;
      finish(message.request_id, message);
    });
    socket.addEventListener('close', () => {
      socket = null;
      failAll('offline', 'The AI service disconnected. Is src/main.py running?');
      setStatus('closed');
      setTimeout(connect, RETRY_MS);
    });
  }

  function newRequestId(windowId) {
    counter += 1;
    return `${windowId}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // Sends one request and resolves with its reply (ok or not); never rejects.
  function call(type, windowId, fields, { requestId = newRequestId(windowId), timeout = timeoutMs } = {}) {
    const replyType = REPLY_TYPES[type];
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => finish(requestId, failure(replyType, windowId, requestId, 'timeout',
        'No answer from the AI service in time.')), timeout);
      pending.set(requestId, { windowId, replyType, resolve, timer });
    });
    const sent = status === 'open' && socket
      && (socket.send(JSON.stringify({ version: 1, type, window_id: windowId, request_id: requestId, ...fields })), true);
    if (!sent) {
      finish(requestId, failure(replyType, windowId, requestId, 'offline', 'The AI service is not connected. Start src/main.py.'));
    }
    return { requestId, promise };
  }

  connect();

  return {
    get status() { return status; },
    onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    newRequestId,
    // Gemini request: task 'ask' or 'describe'. Resolves with the ai.response.
    request(windowId, fields, requestId) {
      return call('ai.request', windowId, fields, { requestId });
    },
    // One full camera photo of the desk. Resolves with an ai.capture.
    snapshot(windowId) {
      return call('ai.snapshot', windowId, {}, { timeout: SNAPSHOT_TIMEOUT_MS });
    },
    // Part of a stored photo, box in image-normalized coordinates. Resolves with an ai.capture.
    crop(windowId, captureId, box) {
      return call('ai.crop', windowId, { capture_id: captureId, box });
    },
    // Stops waiting for a request, for example when its window closes or a newer one replaces it.
    forget(requestId) {
      const entry = pending.get(requestId);
      if (entry) { clearTimeout(entry.timer); pending.delete(requestId); }
    },
  };
}

let shared = null;
export function sharedAIClient() {
  shared ??= createAIClient();
  return shared;
}
