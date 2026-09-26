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
      const [header, list, status, footer] = rows(inset(rect(0, 0, 1, 1), 0.03), [1.1, 5.4, 0.8, 1.1], 0.02);
      const remaining = items.filter((item) => !item.done).length;
      const [title, dictate] = columns(header, [2, 1]);
      const widgets = [
        text('title', title, items.length ? `Tasks: ${remaining} left` : 'Tasks', ['left', 'bare', 'title']),
        button('dictate', dictate, dictation.buttonText('Add by voice'), dictation.buttonVariant()),
      ];

      page = Math.min(page, pageCount() - 1);
      const visible = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (!visible.length) {
        widgets.push(text('empty', list, 'No tasks yet. Tap "Add by voice" and say a task.', ['muted', 'bare']));
      }
      const slots = rows(list, Array(PAGE_SIZE).fill(1), 0.015);
      visible.forEach((item, i) => {
        const [check, label, remove] = columns(slots[i], [1, 7, 1], 0.015);
        widgets.push(
          button(`check-${item.id}`, check, item.done ? '✓' : '', 'check'),
          text(`item-${item.id}`, label, item.text, ['left', ...(item.done ? ['done'] : [])]),
          button(`delete-${item.id}`, remove, '×', 'ghost'),
        );
      });

      const statusText = draft ? `Typing: ${draft}` : dictation.status();
      if (statusText) widgets.push(text('status', status, statusText, ['left', 'bare', 'small', dictation.error && !draft ? 'error' : 'muted']));

      const [prev, pageLabel, next, clearDone] = columns(footer, [1, 1, 1, 2]);
      widgets.push(
        button('prev', prev, '‹', 'large', { disabled: page === 0 }),
        text('page', pageLabel, `${page + 1} / ${pageCount()}`, ['bare', 'small', 'muted']),
        button('next', next, '›', 'large', { disabled: page >= pageCount() - 1 }),
        button('clear-done', clearDone, 'Clear done', 'ghost', { disabled: !items.some((item) => item.done) }),
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
