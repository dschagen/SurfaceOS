import { button, text, rows, columns, rect, inset } from './layout.js';
import { createDictationControl, capitalize } from './dictation.js';

const PAGE_SIZE = 5;

function create(ctx) {
  let items = [];
  let nextId = 1;
  let page = 0;
  let draft = '';
  const dictation = createDictationControl(ctx, (spoken) => addItem(spoken));

  function addItem(value) {
    const clean = capitalize(value.trim()).slice(0, 120);
    if (!clean) return;
    items.push({ id: nextId++, text: clean, done: false });
    page = Math.floor((items.length - 1) / PAGE_SIZE);
  }

  function pageCount() {
    return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  }

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.035);
      const [header, list, status, footer] = rows(area, [1.2, 5.6, 0.7, 1], 0.025);
      const remaining = items.filter((item) => !item.done).length;
      const [titleCell, countCell, dictate] = columns(header, [1.4, 1, 1.5], 0.025);
      const widgets = [
        text('title', titleCell, 'Tasks', ['title', 'left']),
        text('count', countCell, items.length ? `${remaining} left` : 'Empty', 'chip'),
        button('dictate', dictate, dictation.listening ? 'Stop' : 'Add task', dictation.listening ? 'listening' : 'primary', { icon: dictation.listening ? 'stop' : 'mic' }),
      ];

      page = Math.min(page, pageCount() - 1);
      const visible = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (!visible.length) {
        widgets.push(text('empty', list, 'Nothing to do yet. Tap "Add task" and say it out loud.', ['muted', 'card'], { icon: 'list' }));
      }
      const slots = rows(list, Array(PAGE_SIZE).fill(1), 0.02);
      const aspect = ctx.aspect();
      visible.forEach((item, i) => {
        const [rowArea, remove] = columns(slots[i], [8, 1], 0.015);
        // Round check button at the left of the row, square on screen.
        const checkSize = Math.min(rowArea.height * 0.72, (rowArea.width * aspect) / 4);
        const check = rect(rowArea.x + 0.012, rowArea.y + (rowArea.height - checkSize) / 2, checkSize / aspect, checkSize);
        const labelX = check.x + check.width + 0.02;
        widgets.push(
          text(`row-${item.id}`, rowArea, '', 'row'),
          button(`check-${item.id}`, check, '', item.done ? ['check', 'checked'] : 'check', item.done ? { icon: 'check' } : {}),
          text(`item-${item.id}`, rect(labelX, rowArea.y, rowArea.x + rowArea.width - labelX, rowArea.height), item.text, ['left', ...(item.done ? ['done'] : [])]),
          button(`delete-${item.id}`, remove, '', 'ghost', { icon: 'trash' }),
        );
      });

      const statusText = draft ? `Typing: ${draft}` : dictation.status();
      if (statusText) widgets.push(text('status', status, statusText, ['left', 'small', dictation.error && !draft ? 'error' : 'muted']));

      const [prev, pageLabel, next, clearDone] = columns(footer, [1, 1, 1, 2.2], 0.02);
      widgets.push(
        button('prev', prev, '', 'subtle', { icon: 'chevron-left', disabled: page === 0 }),
        text('page', pageLabel, `${page + 1} / ${pageCount()}`, ['small', 'muted']),
        button('next', next, '', 'subtle', { icon: 'chevron-right', disabled: page >= pageCount() - 1 }),
        button('clear-done', clearDone, 'Clear done', 'ghost', { icon: 'check', disabled: !items.some((item) => item.done) }),
      );
      return widgets;
    },
    handleAction({ widget_id: id }) {
      if (id === 'dictate') dictation.toggle();
      else if (id === 'prev') page = Math.max(0, page - 1);
      else if (id === 'next') page = Math.min(pageCount() - 1, page + 1);
      else if (id === 'clear-done') items = items.filter((item) => !item.done);
      else if (id.startsWith('check-')) {
        const item = items.find((entry) => `check-${entry.id}` === id);
        if (item) item.done = !item.done;
      } else if (id.startsWith('delete-')) {
        items = items.filter((entry) => `delete-${entry.id}` !== id);
      }
    },
    handleKey(event) {
      if (event.type !== 'keydown') return false;
      if (event.key === 'Enter') { addItem(draft); draft = ''; return true; }
      if (event.key === 'Backspace') { draft = draft.slice(0, -1); return true; }
      if (event.key === 'Escape') { draft = ''; return true; }
      if (event.key.length === 1 && draft.length < 120) { draft += event.key; return true; }
      return false;
    },
    receiveText(value) {
      addItem(value);
      return true;
    },
  };
}

export default { title: 'Todo list', create };
