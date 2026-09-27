// Hands-free voice for Ask AI chats: continuous speech recognition and spoken replies.
//
// There is one microphone, and a browser runs one recognition at a time, so only one chat session
// listens. When a session starts or resumes listening, the session that had the microphone is paused.
// Recognition and synthesis are the browser's built-in engines (Chrome and Edge); tests pass fakes.

const RESTART_DELAY_MS = 250;
// Some browsers never fire the end event for long utterances; stop waiting after this long.
const SPEECH_MS_PER_CHAR = 90;
const MIN_SPEECH_WAIT_MS = 4000;

const ERROR_TEXT = {
  'not-allowed': 'The microphone is blocked for this page. Click the page, then allow the microphone.',
  'service-not-allowed': 'Speech recognition is blocked in this browser. Use Chrome or Edge.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
};

export function createVoice({
  Recognition = window.SpeechRecognition || window.webkitSpeechRecognition,
  synth = window.speechSynthesis,
  Utterance = window.SpeechSynthesisUtterance,
  lang = 'en-US',
} = {}) {
  let owner = null; // the session using the microphone
  let recognition = null;
  let running = false;
  let restartTimer = null;

  function ensureRecognition() {
    if (recognition || !Recognition) return recognition;
    recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (!owner || owner.state !== 'listening') return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) {
          if (text) owner.handleFinal(text);
        } else {
          interim += `${text} `;
        }
      }
      if (owner?.state === 'listening') owner.handleInterim(interim.trim());
    };
    recognition.onerror = (event) => {
      const message = ERROR_TEXT[event.error];
      if (message && owner) owner.fail(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'blocked' : 'error', message);
    };
    recognition.onend = () => {
      running = false;
      // Recognition stops by itself after silence; keep listening while a session wants it.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { if (owner?.state === 'listening') start(); }, RESTART_DELAY_MS);
    };
    return recognition;
  }

  function start() {
    if (running || !ensureRecognition()) return;
    running = true;
    try {
      recognition.start();
    } catch {
      // start() only fails when recognition is already running, which is what was wanted.
    }
  }

  // Always aborts, even if an end event is still on its way, so nothing is heard while an answer plays.
  function stop() {
    clearTimeout(restartTimer);
    running = false;
    if (recognition) {
      try { recognition.abort(); } catch { /* already stopped */ }
    }
  }

  function claim(session) {
    if (owner && owner !== session) owner.setState('paused');
    owner = session;
  }

  function open({ onFinal = () => {}, onInterim = () => {}, onChange = () => {} } = {}) {
    const session = {
      state: 'idle', // listening | holding | muted | paused | unavailable | blocked | error | closed
      message: '',
      setState(state, message = '') {
        if (session.state === 'closed') return;
        session.state = state;
        session.message = message;
        onChange(state, message);
      },
      handleFinal(text) { onFinal(text); },
      handleInterim(text) { onInterim(text); },
      fail(state, message) {
        stop();
        if (owner === session) owner = null;
        session.setState(state, message);
      },
      // Starts (or resumes) listening, taking the microphone from any other session.
      listen() {
        if (session.state === 'closed') return;
        if (!Recognition) {
          session.setState('unavailable', 'Voice input needs Chrome or Edge. Type your question instead.');
          return;
        }
        claim(session);
        session.setState('listening');
        start();
      },
      // Stops listening while an answer is prepared or spoken; the microphone stays with this session.
      hold() {
        if (owner !== session || session.state !== 'listening') return;
        stop();
        session.setState('holding');
      },
      // Listens again after an answer, unless the user muted or another chat took the microphone.
      resumeAfterReply() {
        if (owner === session && session.state === 'holding') session.listen();
      },
      mute() {
        if (owner === session) {
          stop();
          owner = null;
        }
        session.setState('muted');
      },
      close() {
        if (owner === session) {
          stop();
          owner = null;
        }
        session.state = 'closed';
      },
    };
    return session;
  }

  function speak(text) {
    if (!synth || !Utterance || !text) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
      const guard = setTimeout(finish, Math.max(MIN_SPEECH_WAIT_MS, text.length * SPEECH_MS_PER_CHAR));
      try {
        synth.cancel();
        const utterance = new Utterance(text);
        utterance.lang = lang;
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
      } catch {
        finish();
      }
    });
  }

  function stopSpeaking() {
    try { synth?.cancel(); } catch { /* nothing to stop */ }
  }

  return { available: Boolean(Recognition), canSpeak: Boolean(synth && Utterance), open, speak, stopSpeaking };
}

let shared = null;
export function sharedVoice() {
  shared ??= createVoice();
  return shared;
}
