import { button, text, rows, columns, rect, inset } from './layout.js';
import { createDictationControl, capitalize } from './dictation.js';

const MAX_LENGTH = 5000;

function create(ctx) {
  let content = '';
  const history = [];
  let confirmClear = false;
  let cancelConfirm = null;
  let lastRenderedContent = null;
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
      const { width, height } = ctx.size();
      if (width < 280 || height < 180) {
        return [text('page', rect(0.04, 0.04, 0.92, 0.92), content || 'Expand window to edit note.', ['paper', 'scroll', 'pre', ...(content ? [] : ['muted'])])];
      }
      const marginX = Math.min(12, width * 0.035);
      const marginY = Math.min(12, height * 0.035);
      const gap = height < 240 ? 6 : 8;
      const area = inset(rect(0, 0, 1, 1), marginX / width, marginY / height);
      const statusText = dictation.status();
      const stacked = width < 320 || (width < 420 && height >= 260);
      const controlsHeight = stacked ? (height < 240 ? 94 : 104) : 48;
      const statusHeight = statusText ? 24 : 0;
      const pageHeight = height * area.height - controlsHeight - statusHeight - gap * (statusText ? 2 : 1);
      const page = rect(area.x, area.y, area.width, pageHeight / height);
      const status = rect(area.x, page.y + page.height + gap / height, area.width, statusHeight / height);
      const controls = rect(area.x, area.y + area.height - controlsHeight / height, area.width, controlsHeight / height);
      const widgets = [
        text('page', page, content || 'Tap Dictate and start talking.', ['paper', 'scroll', 'pre', ...(content ? [] : ['muted'])]),
      ];
      if (statusText) widgets.push(text('status', status, statusText, ['left', 'small', dictation.error ? 'error' : 'muted']));
      let dictate, newline, undo, clear;
      if (stacked) {
        const [firstRow, secondRow] = rows(controls, [1, 1], gap / height);
        [dictate, newline] = columns(firstRow, [1.5, 1], gap / width);
        [undo, clear] = columns(secondRow, [1, 1], gap / width);
      } else {
        [dictate, newline, undo, clear] = columns(controls, [1.5, 1, 1, 1], gap / width);
      }
      widgets.push(
        button('dictate', dictate, dictation.buttonText(), dictation.listening ? 'listening' : 'primary', { icon: dictation.listening ? 'stop' : 'mic' }),
        button('newline', newline, 'Line', undefined, { icon: 'new-line', disabled: !content }),
        button('undo', undo, 'Undo', undefined, { icon: 'undo', disabled: !history.length }),
        button('clear', clear, confirmClear ? 'Sure?' : 'Clear', 'danger', { icon: 'trash', disabled: !content }),
      );
      return widgets;
    },
    afterRender() {
      const page = ctx.element('page');
      if (page && content !== lastRenderedContent) {
        page.scrollTop = page.scrollHeight;
        lastRenderedContent = content;
      }
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
