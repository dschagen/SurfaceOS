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

function serverUrl() {
  const params = new URLSearchParams(location.search);
  const ai = params.get('ai');
  if (ai && /^wss?:\/\//.test(ai)) return ai;
  const hand = params.get('hand');
  if (hand && /^wss?:\/\//.test(hand)) return hand;
  return DEFAULT_URL;
}

export function createAIClient({ url = serverUrl(), WebSocketImpl = window.WebSocket, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let socket = null;
  let status = 'connecting'; // 'connecting' | 'open' | 'closed'
  let counter = 0;
  const pending = new Map(); // request_id -> { windowId, resolve, timer }
  const listeners = new Map(); // window_id -> Set(fn)
  const statusListeners = new Set();

  function setStatus(next) {
    if (status === next) return;
    status = next;
    for (const fn of statusListeners) fn(status);
  }

  function finish(requestId, reply) {
    const entry = pending.get(requestId);
    if (!entry) return false;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(reply);
    return true;
  }

  function failAll(code, message) {
    for (const [requestId, entry] of [...pending]) {
      finish(requestId, { version: 1, type: 'ai.response', window_id: entry.windowId, request_id: requestId, ok: false, error: { code, message } });
    }
  }

  function deliver(message) {
    if (message.type === 'ai.response' && finish(message.request_id, message)) return;
    for (const fn of listeners.get(message.window_id) ?? []) {
      try { fn(message); } catch (error) { console.error('AI listener failed', error); }
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
      // The same server also broadcasts hand input; only AI and Explore messages are for this client.
      if (message?.version !== 1 || typeof message.type !== 'string') return;
      if (!message.type.startsWith('ai.') && !message.type.startsWith('explore.')) return;
      deliver(message);
    });
    socket.addEventListener('close', () => {
      socket = null;
      failAll('offline', 'The AI service disconnected. Is src/main.py running?');
      setStatus('closed');
      setTimeout(connect, RETRY_MS);
    });
  }

  function send(message) {
    if (status !== 'open' || !socket) return false;
    socket.send(JSON.stringify({ version: 1, ...message }));
    return true;
  }

  connect();

  return {
    get status() { return status; },
    onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    subscribe(windowId, fn) {
      if (!listeners.has(windowId)) listeners.set(windowId, new Set());
      listeners.get(windowId).add(fn);
      return () => listeners.get(windowId)?.delete(fn);
    },
    newRequestId(windowId) {
      counter += 1;
      return `${windowId}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
    },
    // Sends an explore.* control message; returns false when offline.
    control(type, windowId, fields = {}) {
      return send({ type, window_id: windowId, ...fields });
    },
    // Sends an ai.request and resolves with its ai.response (ok or not); never rejects.
    request(windowId, fields, requestId = this.newRequestId(windowId)) {
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => finish(requestId, {
          version: 1, type: 'ai.response', window_id: windowId, request_id: requestId, ok: false,
          error: { code: 'timeout', message: 'No answer from the AI service in time.' },
        }), timeoutMs);
        pending.set(requestId, { windowId, resolve, timer });
      });
      if (!send({ type: 'ai.request', window_id: windowId, request_id: requestId, ...fields })) {
        finish(requestId, { version: 1, type: 'ai.response', window_id: windowId, request_id: requestId, ok: false,
          error: { code: 'offline', message: 'The AI service is not connected. Start src/main.py.' } });
      }
      return { requestId, promise };
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
