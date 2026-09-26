import { button, text, rows, columns, rect, inset } from './layout.js';
import { createDictationControl, capitalize } from './dictation.js';

const MAX_LENGTH = 5000;

function create(ctx) {
  let content = '';
  const history = [];
  let confirmClear = false;
  let cancelConfirm = null;
  const dictation = createDictationControl(ctx, (spoken) => append(spoken));

  function remember() {
    history.push(content);
    if (history.length > 50) history.shift();
  }

  // Dictated phrases become sentences separated by spaces.
  function append(phrase) {
    remember();
    const startsLine = !content || content.endsWith('\n');
    const piece = startsLine || /[.!?]\s*$/.test(content) ? capitalize(phrase) : phrase;
    content = (content + (startsLine ? '' : ' ') + piece).slice(0, MAX_LENGTH);
  }

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.035);
      const [page, status, controls] = rows(area, [6, 0.6, 1.15], 0.025);
      const widgets = [
        text('page', page, content || 'Tap Dictate and start talking.', ['paper', 'tail', 'pre', ...(content ? [] : ['muted'])]),
      ];
      const statusText = dictation.status();
      if (statusText) widgets.push(text('status', status, statusText, ['left', 'small', dictation.error ? 'error' : 'muted']));
      const [dictate, newline, undo, clear] = columns(controls, [1.5, 1, 1, 1], 0.025);
      widgets.push(
        button('dictate', dictate, dictation.buttonText(), dictation.listening ? 'listening' : 'primary', { icon: dictation.listening ? 'stop' : 'mic' }),
        button('newline', newline, 'Line', undefined, { icon: 'new-line', disabled: !content }),
        button('undo', undo, 'Undo', undefined, { icon: 'undo', disabled: !history.length }),
        button('clear', clear, confirmClear ? 'Sure?' : 'Clear', 'danger', { icon: 'trash', disabled: !content }),
      );
      return widgets;
    },
    handleAction({ widget_id: id }) {
      if (id === 'dictate') dictation.toggle();
      else if (id === 'newline') { remember(); content += '\n'; }
      else if (id === 'undo' && history.length) content = history.pop();
      else if (id === 'clear') {
        // Clearing takes two presses so a stray pinch cannot wipe the note.
        if (confirmClear) {
          remember();
          content = '';
          confirmClear = false;
          cancelConfirm?.();
        } else {
          confirmClear = true;
          cancelConfirm = ctx.after(3000, () => { confirmClear = false; ctx.update(); });
        }
      }
    },
    handleKey(event) {
      if (event.type !== 'keydown') return false;
      if (event.key === 'Backspace') { if (content) { remember(); content = content.slice(0, -1); } return true; }
      if (event.key === 'Enter') { remember(); content += '\n'; return true; }
      if (event.key.length === 1 && content.length < MAX_LENGTH) {
        // Group consecutive typing into one undo step per word.
        if (event.key === ' ' || !history.length) remember();
        content += event.key;
        return true;
      }
      return false;
    },
    receiveText(value) {
      if (!value.trim()) return false;
      append(value.trim());
      return true;
    },
  };
}

export default { title: 'Notepad', create };
