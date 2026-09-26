// Speech-to-text for apps that need text entry (notepad, todo, calendar).
//
// A dictation provider has the shape { supported, start({ onInterim, onFinal, onError, onEnd }) -> stop }.
// The default uses the browser's Web Speech API (Chrome and Edge; needs a network connection and
// microphone permission for the page). A different STT engine can be passed to mountApp instead.

export function createBrowserDictation({ lang = 'en-US' } = {}) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let activeRecognition = null;

  function start({ onInterim, onFinal, onError, onEnd } = {}) {
    if (!Recognition) {
      onError?.('Speech recognition is not available in this browser. Use Chrome or Edge.');
      onEnd?.();
      return () => {};
    }
    // Only one recognition can use the microphone at a time.
    activeRecognition?.abort();
    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) onFinal?.(transcript.trim());
        else interim += transcript;
      }
      if (interim) onInterim?.(interim.trim());
    };
    recognition.onerror = (event) => {
      const messages = {
        'not-allowed': 'Microphone permission was denied for this page.',
        'no-speech': 'No speech heard. Try again.',
        network: 'Speech recognition needs an internet connection.',
        'audio-capture': 'No microphone found.',
      };
      if (event.error !== 'aborted') onError?.(messages[event.error] || `Speech recognition error: ${event.error}`);
    };
    recognition.onend = () => {
      if (activeRecognition === recognition) activeRecognition = null;
      onEnd?.();
    };
    activeRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      activeRecognition = null;
      onError?.(`Could not start speech recognition: ${error.message}`);
      onEnd?.();
    }
    return () => recognition.stop();
  }

  return { supported: Boolean(Recognition), start };
}

// Shared dictation state for an app: a toggle button, interim transcript, and errors.
export function createDictationControl(ctx, onFinal) {
  const control = {
    listening: false,
    interim: '',
    error: '',
    stop: null,
    toggle() {
      if (control.listening) {
        control.stop?.();
        return;
      }
      control.error = '';
      control.interim = '';
      control.listening = true;
      control.stop = ctx.dictation.start({
        onInterim(text) { control.interim = text; ctx.update(); },
        onFinal(text) { control.interim = ''; if (text) onFinal(text); ctx.update(); },
        onError(message) { control.error = message; ctx.update(); },
        onEnd() { control.listening = false; control.interim = ''; control.stop = null; ctx.update(); },
      });
    },
    // One-line status for the app to display, or '' when idle.
    status() {
      if (control.listening) return control.interim ? `"${control.interim}"` : 'Listening...';
      return control.error;
    },
    buttonText(idleText = 'Dictate') {
      return control.listening ? 'Stop' : idleText;
    },
  };
  ctx.onDestroy(() => control.stop?.());
  return control;
}

export function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
