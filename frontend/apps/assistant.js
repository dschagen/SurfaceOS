import { button, text, rows, columns, rect, inset } from './layout.js';
import { sharedAIClient } from '../ai-client.js';
import { sharedVoice } from './voice.js';

// Ask AI: a hands-free voice chat with Gemini, optionally about a cropped photo of the desk.
//
// The shell opens it after a thumbs-up with ctx.launch = { mode: 'voice' } or
// { mode: 'screenshot', capture }. From the program picker it starts with a Voice / Screenshot choice.

const IMAGE_PREFIX = 'data:image/jpeg;base64,';
const MAX_CONTEXT_TURNS = 8;
// A selection smaller than this share of the photo is treated as a stray tap.
const MIN_SELECTION = 0.03;
// Steps where backing out closes the window and a new thumbs-up is ignored.
const FLOW_STAGES = new Set(['choose', 'capturing', 'crop', 'cropping']);

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const validImage = (capture) => typeof capture?.image === 'string' && capture.image.startsWith(IMAGE_PREFIX);

function create(ctx) {
  const ai = ctx.services.ai ?? sharedAIClient();
  const voice = ctx.services.voice ?? sharedVoice();
  const windowId = ctx.windowId;
  const captureDesk = ctx.services.captureDesk ?? ((id) => ai.snapshot(id).promise);
  const closeWindow = ctx.services.closeWindow ?? null;
  const launch = ctx.launch ?? {};

  let stage = 'choose'; // choose | capturing | crop | cropping | describing | chat
  let photo = null; // full desk photo { capture_id, image, width, height }
  let crop = null; // the part the chat is about
  let selection = null; // image-normalized { x0, y0, x1, y1 }
  let dragging = false;
  let turns = []; // { role: 'user' | 'model', text, error?, sources? }
  let interim = '';
  let draft = '';
  let waiting = false;
  let speaking = false;
  let notice = '';
  let model = '';
  let provider = '';
  let searchUnavailable = false;
  let session = null;
  let requestId = null;
  let flowToken = 0;

  // ---------- voice chat ----------

  // Opens the chat; listening starts now, or after a spoken description when listen is false.
  function startChat({ listen = true } = {}) {
    stage = 'chat';
    if (!session) {
      session = voice.open({
        onFinal: (spoken) => ask(spoken),
        onInterim: (words) => { interim = words; ctx.update(); },
        onChange: () => ctx.update(),
      });
    }
    if (listen) session.listen();
  }

  function contextTurns() {
    return turns.filter((turn) => turn.text && !turn.error).slice(-MAX_CONTEXT_TURNS)
      .map((turn) => ({ role: turn.role, text: turn.text }));
  }

  function remember(reply) {
    model = reply.model || model;
    provider = reply.provider || '';
    searchUnavailable = Boolean(reply.search_unavailable);
  }

  // Speaks an answer, then listens again (or runs `then` instead).
  async function say(words, then = () => session?.resumeAfterReply()) {
    speaking = true;
    ctx.update();
    await voice.speak(words);
    speaking = false;
    if (!ctx.destroyed) {
      then();
      ctx.update();
    }
  }

  function ask(question) {
    const clean = String(question || '').trim().slice(0, 1000);
    if (!clean || stage !== 'chat' || waiting) return;
    const history = contextTurns();
    turns = [...turns, { role: 'user', text: clean }];
    interim = '';
    draft = '';
    waiting = true;
    session?.hold();
    const call = ai.request(windowId, {
      task: 'ask', prompt: clean, capture_id: crop?.capture_id, context: history, grounding: true, style: 'spoken',
    });
    requestId = call.requestId;
    call.promise.then((reply) => {
      if (ctx.destroyed || reply.request_id !== requestId) return;
      requestId = null;
      waiting = false;
      if (reply.ok) {
        remember(reply);
        turns = [...turns, { role: 'model', text: reply.text, sources: reply.sources || [] }];
        say(reply.text);
      } else {
        turns = [...turns, { role: 'model', error: reply.error?.message || 'No answer.' }];
        session?.resumeAfterReply();
      }
      ctx.update();
    });
  }

  // ---------- photo and crop ----------

  function takePhoto() {
    const token = ++flowToken;
    stage = 'capturing';
    notice = '';
    selection = null;
    Promise.resolve(captureDesk(windowId)).then((reply) => {
      if (ctx.destroyed || token !== flowToken) return;
      if (reply?.ok && validImage(reply)) {
        photo = reply;
        stage = 'crop';
      } else {
        notice = reply?.error?.message || 'The photo could not be taken.';
        stage = photo ? 'crop' : 'choose';
      }
      ctx.update();
    });
  }

  function selectionBox() {
    if (!selection) return null;
    const x = Math.min(selection.x0, selection.x1);
    const y = Math.min(selection.y0, selection.y1);
    return { x, y, width: Math.abs(selection.x1 - selection.x0), height: Math.abs(selection.y1 - selection.y0) };
  }

  function useArea(whole) {
    if (!photo) return;
    const box = selectionBox();
    if (!whole && !box) return;
    if (whole) {
      describe(photo);
      return;
    }
    const token = ++flowToken;
    stage = 'cropping';
    notice = '';
    ai.crop(windowId, photo.capture_id, box).promise.then((reply) => {
      if (ctx.destroyed || token !== flowToken) return;
      if (reply.ok && validImage(reply)) {
        describe(reply);
      } else {
        notice = reply.error?.message || 'The area could not be cropped.';
        stage = 'crop';
      }
      ctx.update();
    });
  }

  function describe(capture) {
    crop = capture;
    stage = 'describing';
    const call = ai.request(windowId, { task: 'describe', capture_id: capture.capture_id, style: 'spoken' });
    requestId = call.requestId;
    call.promise.then((reply) => {
      if (ctx.destroyed || reply.request_id !== requestId) return;
      requestId = null;
      startChat({ listen: false });
      if (reply.ok) {
        remember(reply);
        turns = [...turns, { role: 'model', text: reply.text }];
        say(reply.text, () => session.listen());
      } else {
        turns = [...turns, { role: 'model', error: reply.error?.message || 'The photo could not be described.' }];
        session.listen();
      }
      ctx.update();
    });
  }

  function cancelFlow() {
    if (!FLOW_STAGES.has(stage)) return false;
    flowToken += 1;
    if (closeWindow) closeWindow(windowId);
    else {
      stage = 'choose';
      photo = null;
      selection = null;
    }
    return true;
  }

  // The photo is shown at its own aspect ratio, so window points map straight onto image points.
  function photoRect(area, capture) {
    const aspect = ctx.aspect();
    const imageAspect = capture.width / capture.height || 4 / 3;
    if ((area.width * aspect) / area.height > imageAspect) {
      const width = (area.height * imageAspect) / aspect;
      return rect(area.x + (area.width - width) / 2, area.y, width, area.height);
    }
    const height = (area.width * aspect) / imageAspect;
    return rect(area.x, area.y + (area.height - height) / 2, area.width, height);
  }

  let cropArea = null;

  // ---------- layout ----------

  function statusLabel() {
    if (waiting) return 'Thinking...';
    if (speaking) return 'Speaking...';
    switch (session?.state) {
      case 'listening': case 'holding': return 'Listening...';
      case 'muted': return 'Muted';
      case 'paused': return 'Paused: another chat is listening';
      case 'unavailable': return 'Voice unavailable';
      case 'blocked': return 'Microphone blocked';
      case 'error': return 'Voice error';
      default: return 'Starting...';
    }
  }

  function chooseWidgets(area) {
    const [title, body, choices, footer] = rows(area, [1, 1.1, 2.2, 0.8], 0.05);
    const [voiceCell, photoCell] = columns(choices, [1, 1], 0.04);
    return [
      text('title', title, 'Ask AI', ['title', 'huge']),
      text('body', body, notice || 'Talk with Gemini, or show it part of the desk.', [notice ? 'error' : 'muted']),
      button('voice', voiceCell, 'Voice', ['primary', 'large'], { icon: 'mic' }),
      button('screenshot', photoCell, 'Screenshot', 'large', { icon: 'camera' }),
      button('cancel', footer, 'Cancel', 'ghost', { icon: 'x' }),
    ];
  }

  function cropWidgets(area) {
    const [hint, main, actions] = rows(area, [0.6, 6, 1], 0.025);
    const widgets = [];
    const busy = stage === 'cropping';
    widgets.push(text('hint', hint, notice || (busy ? 'Cropping...' : 'Drag a box over the part to ask about.'),
      ['left', 'small', notice ? 'error' : 'muted']));
    if (photo) {
      cropArea = photoRect(main, photo);
      widgets.push({ id: 'photo', type: 'embed', ...cropArea });
      const box = selectionBox();
      if (box && box.width > 0 && box.height > 0) {
        widgets.push(text('selection', rect(cropArea.x + box.x * cropArea.width, cropArea.y + box.y * cropArea.height,
          Math.max(box.width * cropArea.width, 0.002), Math.max(box.height * cropArea.height, 0.002)), '', 'crop-box'));
      }
    }
    const [useCell, wholeCell, retakeCell, cancelCell] = columns(actions, [1.6, 1.1, 1, 1], 0.02);
    const box = selectionBox();
    widgets.push(
      button('use-selection', useCell, 'Use this area', ['primary', 'small'],
        { icon: 'check', disabled: busy || dragging || !box || box.width < MIN_SELECTION || box.height < MIN_SELECTION }),
      button('use-whole', wholeCell, 'Whole photo', 'small', { disabled: busy }),
      button('retake', retakeCell, 'Retake', ['ghost', 'small'], { disabled: busy }),
      button('cancel', cancelCell, 'Cancel', ['ghost', 'small'], { disabled: busy }),
    );
    return widgets;
  }

  function transcript() {
    const lines = [];
    for (const turn of turns) {
      if (turn.role === 'user') lines.push(`You: ${turn.text}`);
      else if (turn.error) lines.push(`Gemini could not answer: ${turn.error}`);
      else lines.push(`Gemini: ${turn.text}`);
    }
    if (interim) lines.push(`You: ${interim}...`);
    if (!lines.length) return crop ? 'Looking at the photo...' : 'Say something. Gemini answers out loud.';
    return lines.join('\n\n');
  }

  function chatWidgets(area) {
    const [bar, main, askRow] = rows(area, [0.85, 6, 0.95], 0.025);
    const listening = session && ['listening', 'holding'].includes(session.state);
    const [chip, micCell, stopCell] = columns(bar, [2.2, 1, 1], 0.02);
    const widgets = [
      text('status', chip, statusLabel(), ['chip', ...(listening ? ['accent-text'] : ['muted'])], { icon: listening ? 'mic' : undefined }),
      button('mic', micCell, listening ? 'Mute' : 'Listen', [listening ? 'ghost' : 'primary', 'small'], { icon: listening ? 'mute' : 'mic' }),
      button('stop-speaking', stopCell, 'Stop', ['ghost', 'small'], { icon: 'stop', disabled: !speaking }),
    ];
    let transcriptArea = main;
    if (crop) {
      const [thumbArea, rest] = ctx.aspect() >= 1.1 ? columns(main, [1, 2.2], 0.025) : rows(main, [1, 2], 0.025);
      widgets.push({ id: 'thumb', type: 'embed', ...photoRect(thumbArea, crop) });
      transcriptArea = rest;
    }
    widgets.push(text('transcript', transcriptArea, transcript(), ['scroll', 'small']));
    const [field, askCell] = columns(askRow, [4, 1], 0.015);
    widgets.push(
      { id: 'question', type: 'input', ...field, value: draft, placeholder: 'Or type a question and press Enter' },
      button('ask', askCell, waiting ? '...' : 'Ask', 'primary', { disabled: waiting }),
    );
    return widgets;
  }

  function footerText() {
    if (session?.message) return { value: session.message, variant: 'error' };
    if (notice && stage === 'chat') return { value: notice, variant: 'error' };
    if (!model) return { value: '', variant: 'faint' };
    const live = provider === 'gemini' ? `Live answers from Gemini (${model})` : `Test answers, not from Gemini (${model})`;
    return { value: searchUnavailable ? `${live}. Web search quota reached; answered without it.` : live, variant: 'faint' };
  }

  function setImage(widgetId, capture) {
    const holder = ctx.element(widgetId);
    if (!holder || !validImage(capture)) return;
    let image = holder.querySelector('img');
    if (!image) {
      image = document.createElement('img');
      image.alt = widgetId === 'photo' ? 'Photo of the desk' : 'Selected part of the desk';
      image.draggable = false;
      Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'fill', display: 'block', pointerEvents: 'none' });
      holder.replaceChildren(image);
    }
    if (image.getAttribute('src') !== capture.image) image.src = capture.image;
  }

  // Launch state from the shell.
  if (launch.mode === 'voice') {
    startChat();
  } else if (launch.mode === 'screenshot') {
    if (validImage(launch.capture)) {
      photo = launch.capture;
      stage = 'crop';
    } else {
      takePhoto();
    }
  }

  ctx.onDestroy(() => {
    flowToken += 1;
    if (requestId) ai.forget(requestId);
    session?.close();
    if (speaking) voice.stopSpeaking();
  });

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.03);
      if (stage === 'choose') return chooseWidgets(area);
      if (stage === 'capturing') {
        return [text('capturing', area, 'Taking a photo of the desk...', ['title', 'muted'], { icon: 'camera' })];
      }
      if (stage === 'crop' || stage === 'cropping') return cropWidgets(area);
      const [main, footer] = rows(area, [12, 0.7], 0.015);
      if (stage === 'describing') {
        const [thumbArea, message] = rows(main, [3, 1], 0.03);
        return [
          { id: 'thumb', type: 'embed', ...photoRect(thumbArea, crop) },
          text('describing', message, 'Asking Gemini what this is...', ['muted']),
        ];
      }
      const widgets = chatWidgets(main);
      const { value, variant } = footerText();
      if (value) widgets.push(text('footer', footer, value, ['small', 'left', variant]));
      return widgets;
    },

    afterRender() {
      if (stage === 'crop' || stage === 'cropping') setImage('photo', photo);
      if (crop) setImage('thumb', crop);
      // Keeps the newest line of the conversation in view.
      const log = ctx.element('transcript');
      if (log) log.scrollTop = log.scrollHeight;
    },

    handleAction(action) {
      const id = action.widget_id;
      if (id === 'question') {
        if (typeof action.value === 'string') draft = action.value;
        if (action.event === 'submit') ask(draft);
        return;
      }
      if (id === 'voice') { startChat(); return; }
      if (id === 'screenshot' || id === 'retake') { takePhoto(); return; }
      if (id === 'cancel') { cancelFlow(); return; }
      if (id === 'use-selection') { useArea(false); return; }
      if (id === 'use-whole') { useArea(true); return; }
      if (id === 'ask') { ask(draft); return; }
      if (id === 'stop-speaking') { voice.stopSpeaking(); return; }
      if (id === 'mic' && session) {
        if (['listening', 'holding'].includes(session.state)) {
          session.mute();
          if (speaking) voice.stopSpeaking();
        } else {
          session.listen();
        }
      }
    },

    // Dragging a box over the photo selects the part to ask about.
    handlePointer(event) {
      if (stage !== 'crop' || !photo || !cropArea) return false;
      if (event.type === 'pointer_cancel') {
        if (dragging) { dragging = false; selection = null; ctx.update(); }
        return false;
      }
      if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return false;
      const nx = (event.x - cropArea.x) / cropArea.width;
      const ny = (event.y - cropArea.y) / cropArea.height;
      if (event.type === 'pointer_down') {
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;
        dragging = true;
        notice = '';
        selection = { x0: nx, y0: ny, x1: nx, y1: ny };
        ctx.update();
        return true;
      }
      if (!dragging) return false;
      selection = { ...selection, x1: clamp01(nx), y1: clamp01(ny) };
      if (event.type === 'pointer_up') {
        dragging = false;
        const box = selectionBox();
        if (box.width < MIN_SELECTION || box.height < MIN_SELECTION) {
          selection = null;
          notice = 'That box is too small. Drag across the part you want.';
        }
      }
      ctx.update();
      return true;
    },

    receiveText(value) {
      ask(value);
      return true;
    },

    // Shell hooks: backing out of a step, and whether a step is open.
    cancelFlow,
    flowActive: () => FLOW_STAGES.has(stage),
  };
}

export default { title: 'Ask AI', create };
