import { button, text, rows, columns, rect, inset } from './layout.js';
import { createDictationControl } from './dictation.js';
import { sharedAIClient } from '../ai-client.js';

// Explore Object: the Python process watches a camera area, captures an object that is placed there,
// and asks Gemini what it is. Nothing is looked up on the web until the user chooses "Yes".

const SUGGESTIONS = ['What is it made of?', 'How do I use it?', 'Where can I buy one?'];
const MAX_TURNS = 6;
const IMAGE_PREFIX = 'data:image/jpeg;base64,';

const EXPLAIN_PROMPT = 'Tell me more about this object: what it is, what it is used for, and two or three useful facts. '
  + 'Look up current details on the web where they help, such as typical price or notable models.';
const EXPLAIN_UNSURE_PROMPT = 'The object in this photo could not be identified with confidence. Describe what it most likely is, '
  + 'what it could be used for, and what would help identify it.';

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function create(ctx) {
  const ai = ctx.services.ai ?? sharedAIClient();
  const windowId = ctx.windowId;

  let connection = ai.status;
  let watchState = 'watching'; // server state: watching | paused | holding | inactive
  let serviceProblem = '';
  let phase = 'watching'; // watching | identifying | identified | exploring | explored | error
  let capture = null; // { id, image, trigger }
  let identification = null;
  let identifyRequest = null;
  let details = null; // { text, sources, grounded, model }
  let turns = []; // { question, answer, sources, error }
  let askRequest = null;
  let draft = '';
  let error = '';
  let notice = '';
  let model = '';
  let provider = '';

  const dictation = createDictationControl(ctx, (spoken) => askFollowUp(spoken));

  function startWatching() {
    if (ai.control('explore.watch', windowId)) watchState = 'watching';
  }

  function resetResult() {
    capture = null;
    identification = null;
    identifyRequest = null;
    details = null;
    turns = [];
    if (askRequest) ai.forget(askRequest);
    askRequest = null;
    error = '';
    notice = '';
  }

  function onMessage(message) {
    if (message.type === 'explore.status') {
      watchState = message.state;
      serviceProblem = message.detail || '';
    } else if (message.type === 'explore.capture') {
      if (typeof message.image !== 'string' || !message.image.startsWith(IMAGE_PREFIX)) return;
      resetResult();
      capture = { id: message.capture_id, image: message.image, trigger: message.trigger };
      identifyRequest = message.request_id;
      phase = 'identifying';
    } else if (message.type === 'explore.object_left') {
      if (capture && message.capture_id === capture.id) notice = 'The object left the camera area. Its photo stays here.';
    } else if (message.type === 'ai.response' && message.task === 'identify' && message.request_id === identifyRequest) {
      identifyRequest = null;
      if (message.ok) {
        identification = message.identification;
        model = message.model || model;
        provider = message.provider || '';
        phase = 'identified';
      } else {
        error = message.error?.message || 'Identification failed.';
        phase = 'error';
      }
    }
    ctx.update();
  }

  function subject() {
    return identification && !identification.uncertain ? identification.label : undefined;
  }

  function context() {
    const history = [];
    if (details?.text) history.push({ role: 'model', text: details.text });
    for (const turn of turns.slice(-MAX_TURNS)) {
      if (!turn.answer) continue;
      history.push({ role: 'user', text: turn.question }, { role: 'model', text: turn.answer });
    }
    return history;
  }

  function ask(prompt, onDone) {
    if (askRequest) ai.forget(askRequest);
    const { requestId, promise } = ai.request(windowId, {
      task: 'ask', prompt, capture_id: capture?.id, subject: subject(), context: context(), grounding: true,
    });
    askRequest = requestId;
    promise.then((reply) => {
      if (ctx.destroyed || reply.request_id !== askRequest) return;
      askRequest = null;
      if (reply.ok) {
        model = reply.model || model;
        provider = reply.provider || '';
      }
      onDone(reply);
      ctx.update();
    });
  }

  function explain() {
    phase = 'exploring';
    error = '';
    ask(subject() ? EXPLAIN_PROMPT : EXPLAIN_UNSURE_PROMPT, (reply) => {
      if (reply.ok) {
        details = { text: reply.text, sources: reply.sources || [], grounded: reply.grounded, searchUnavailable: Boolean(reply.search_unavailable) };
        phase = 'explored';
      } else {
        error = reply.error?.message || 'The lookup failed.';
        phase = 'error';
      }
    });
  }

  function askFollowUp(question) {
    const clean = String(question || '').trim().slice(0, 500);
    if (!clean || phase !== 'explored' || askRequest) return;
    const turn = { question: clean, answer: '', sources: [], error: '' };
    turns = [...turns, turn].slice(-MAX_TURNS);
    draft = '';
    ask(clean, (reply) => {
      if (reply.ok) {
        turn.answer = reply.text;
        turn.sources = reply.sources || [];
      } else {
        turn.error = reply.error?.message || 'The question failed.';
      }
    });
  }

  function dismiss() {
    resetResult();
    phase = 'watching';
    ai.control('explore.dismiss', windowId);
  }

  function analyzeFrame() {
    const requestId = ai.newRequestId(windowId);
    if (!ai.control('explore.analyze_frame', windowId, { request_id: requestId })) return;
    resetResult();
    identifyRequest = requestId;
    phase = 'identifying';
  }

  const unsubscribe = ai.subscribe(windowId, onMessage);
  const unwatchStatus = ai.onStatus((next) => {
    connection = next;
    // A reconnected server has forgotten this window, so ask for the camera area again.
    if (next === 'open') startWatching();
    else if (identifyRequest || askRequest) {
      error = 'The AI service disconnected.';
      phase = capture ? 'error' : 'watching';
      identifyRequest = null;
    }
    ctx.update();
  });
  if (connection === 'open') startWatching();
  ctx.onDestroy(() => {
    ai.control('explore.release', windowId);
    if (askRequest) ai.forget(askRequest);
    unsubscribe();
    unwatchStatus();
  });

  // ---------- layout ----------

  function statusChip() {
    if (connection !== 'open') return { label: connection === 'connecting' ? 'Connecting' : 'Offline', variant: 'error' };
    if (watchState === 'inactive') return { label: 'Not watching', variant: 'muted' };
    if (watchState === 'paused') return { label: 'Paused', variant: 'muted' };
    if (phase === 'watching') return { label: 'Watching', variant: 'accent-text' };
    return { label: 'Holding photo', variant: 'accent-text' };
  }

  function topBar(area) {
    const [chipCell, pauseCell, analyzeCell] = columns(area, [1.4, 1, 1.6], 0.02);
    const chip = statusChip();
    const online = connection === 'open' && watchState !== 'inactive';
    return [
      text('status', chipCell, chip.label, ['chip', chip.variant]),
      button('pause', pauseCell, watchState === 'paused' ? 'Resume' : 'Pause', 'subtle',
        { icon: watchState === 'paused' ? 'play' : 'pause', disabled: !online }),
      button('analyze', analyzeCell, 'Analyze this frame', 'primary',
        { icon: 'camera', disabled: !online || phase === 'identifying' || phase === 'exploring' }),
    ];
  }

  function photo(area) {
    if (capture) return [{ id: 'photo', type: 'embed', ...area }];
    const message = phase === 'identifying' ? 'Capturing...' : 'The captured photo appears here.';
    return [text('photo-empty', area, message, ['card', 'muted', 'small'], { icon: 'camera' })];
  }

  function watchingPanel(area) {
    const [heading, body, action] = rows(area, [1, 2, 1], 0.04);
    const widgets = [];
    if (connection !== 'open') {
      widgets.push(
        text('heading', heading, 'AI service offline', ['title', 'left']),
        text('body', body, 'Start the camera service on the laptop:\n.venv\\Scripts\\python src\\main.py', ['pre', 'small', 'muted', 'left']),
      );
    } else if (watchState === 'inactive') {
      widgets.push(
        text('heading', heading, 'Another window is watching', ['title', 'left']),
        text('body', body, 'Only one Explore Object window uses the camera area at a time.', ['small', 'muted', 'left']),
        button('take-over', action, 'Watch here instead', 'primary'),
      );
    } else {
      widgets.push(
        text('heading', heading, watchState === 'paused' ? 'Watching is paused' : 'Place an object in the camera area', ['title', 'left']),
        text('body', body, serviceProblem || 'Hold it still for a moment. Or press "Analyze this frame".',
          ['small', 'left', serviceProblem ? 'error' : 'muted']),
      );
    }
    return widgets;
  }

  function identity() {
    if (!identification) return { title: '', note: '' };
    if (identification.uncertain) {
      const guess = identification.label ? `Maybe: ${identification.label}` : 'Not sure what this is';
      return { title: guess, note: identification.summary || 'Gemini could not identify it with confidence.' };
    }
    return { title: identification.label, note: identification.summary };
  }

  function resultPanel(area) {
    const widgets = [];
    const { title, note } = identity();
    if (phase === 'identifying') {
      widgets.push(text('heading', area, 'Identifying with Gemini...', ['title', 'left', 'muted']));
      return widgets;
    }
    if (phase === 'error') {
      const [heading, body, actions] = rows(area, [1, 2, 1], 0.04);
      const [retry, close] = columns(actions, [1, 1], 0.03);
      widgets.push(
        text('heading', heading, 'Something went wrong', ['title', 'left']),
        text('body', body, error, ['small', 'left', 'error']),
        button('retry', retry, 'Try again', 'primary', { icon: 'refresh', disabled: !capture }),
        button('dismiss', close, 'Watch again', 'ghost'),
      );
      return widgets;
    }
    if (phase === 'identified') {
      const [heading, body, question, actions] = rows(area, [1.1, 1.8, 0.7, 1.1], 0.03);
      const [yes, no] = columns(actions, [1, 1], 0.03);
      widgets.push(
        text('identity', heading, title, ['title', 'left', ...(identification.uncertain ? ['muted'] : [])]),
        text('summary', body, note, ['small', 'left', 'muted']),
        text('question', question, 'Analyze further?', ['label', 'left']),
        button('yes', yes, 'Yes', 'primary', { icon: 'globe' }),
        button('no', no, 'No', 'ghost', { icon: 'x' }),
      );
      return widgets;
    }
    // exploring / explored
    const [heading, body, sourceRow, askRow, extraRow] = rows(area, [0.8, 4, 0.8, 0.9, 0.9], 0.025);
    widgets.push(text('identity', heading, title, ['title', 'left', ...(identification?.uncertain ? ['muted'] : [])]));
    if (phase === 'exploring') {
      widgets.push(text('details', body, 'Looking it up with Gemini and Google Search...', ['left', 'top', 'muted', 'small']));
      return widgets;
    }
    const lines = [details?.text || ''];
    for (const turn of turns) {
      lines.push('', `You: ${turn.question}`, turn.error ? `Error: ${turn.error}` : turn.answer ? `Gemini: ${turn.answer}` : 'Gemini is answering...');
    }
    widgets.push(text('details', body, lines.join('\n'), ['scroll', 'small']));
    const sources = [...(details?.sources || []), ...turns.flatMap((turn) => turn.sources)]
      .filter((source, index, all) => all.findIndex((other) => other.url === source.url) === index).slice(0, 3);
    if (sources.length) {
      const cells = columns(sourceRow, sources.map(() => 1), 0.015);
      sources.forEach((source, i) => widgets.push(button(`source-${i}`, cells[i], domainOf(source.url) || source.title, 'subtle', { icon: 'globe' })));
    } else {
      let note = details?.grounded ? 'Searched the web; no links returned.' : 'Answered without a web search.';
      if (details?.searchUnavailable) note = 'Web search quota reached; answered by Gemini without a web search.';
      widgets.push(text('no-sources', sourceRow, note, ['small', 'faint', 'left']));
    }
    const [field, askCell, micCell] = columns(askRow, [4, 1, 1], 0.015);
    const busy = Boolean(askRequest);
    widgets.push(
      { id: 'follow-up', type: 'input', ...field, value: draft, placeholder: 'Ask a follow-up question, then press Enter' },
      button('ask', askCell, busy ? '...' : 'Ask', 'primary', { disabled: busy }),
      button('dictate', micCell, '', dictation.listening ? 'listening' : 'subtle', { icon: dictation.listening ? 'stop' : 'mic', disabled: busy }),
    );
    const extras = columns(extraRow, [1, 1, 1, 1.1], 0.015);
    SUGGESTIONS.forEach((suggestion, i) => widgets.push(button(`suggest-${i}`, extras[i], suggestion, ['ghost', 'small'], { disabled: busy })));
    widgets.push(button('new-object', extras[3], 'New object', ['subtle', 'small'], { icon: 'refresh' }));
    return widgets;
  }

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.03);
      const [bar, main, footer] = rows(area, [0.8, 6, 0.45], 0.025);
      const wide = ctx.aspect() >= 1.15;
      const [photoArea, panelArea] = wide ? columns(main, [1, 1.35], 0.03) : rows(main, [1, 1.6], 0.03);
      const widgets = [...topBar(bar), ...photo(photoArea)];
      widgets.push(...(phase === 'watching' ? watchingPanel(panelArea) : resultPanel(panelArea)));
      // Only answers the server marks as coming from Gemini are labelled as live Gemini output.
      let live = '';
      if (model && phase !== 'watching') live = provider === 'gemini' ? `Live answer from Gemini (${model})` : `Test answer, not from Gemini (${model})`;
      const status = dictation.status();
      widgets.push(text('footer', footer, notice || status || live, ['small', 'left', notice ? 'accent-text' : 'faint']));
      return widgets;
    },

    afterRender() {
      const holder = ctx.element('photo');
      if (!holder || !capture) return;
      let image = holder.querySelector('img');
      if (!image) {
        image = document.createElement('img');
        image.alt = 'Captured object';
        Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block' });
        holder.replaceChildren(image);
      }
      if (image.getAttribute('src') !== capture.image) image.src = capture.image;
    },

    handleAction(action) {
      const id = action.widget_id;
      if (id === 'follow-up') {
        if (typeof action.value === 'string') draft = action.value;
        if (action.event === 'submit') askFollowUp(draft);
        return;
      }
      if (id === 'pause') ai.control(watchState === 'paused' ? 'explore.resume' : 'explore.pause', windowId);
      else if (id === 'analyze') analyzeFrame();
      else if (id === 'take-over') startWatching();
      else if (id === 'yes') explain();
      else if (id === 'no' || id === 'dismiss' || id === 'new-object') dismiss();
      else if (id === 'retry' && capture) {
        const { requestId, promise } = ai.request(windowId, { task: 'identify', capture_id: capture.id });
        identifyRequest = requestId;
        phase = 'identifying';
        promise.then((reply) => onMessage({ ...reply, task: 'identify' }));
      } else if (id === 'ask') askFollowUp(draft);
      else if (id === 'dictate') dictation.toggle();
      else if (id.startsWith('suggest-')) askFollowUp(SUGGESTIONS[Number(id.slice(8))]);
      else if (id.startsWith('source-')) {
        const sources = [...(details?.sources || []), ...turns.flatMap((turn) => turn.sources)]
          .filter((source, index, all) => all.findIndex((other) => other.url === source.url) === index);
        const url = sources[Number(id.slice(7))]?.url;
        if (typeof url === 'string' && /^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      }
    },

    receiveText(value) {
      askFollowUp(value);
      return true;
    },
  };
}

export default { title: 'Explore Object', create };
