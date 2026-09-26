import { button, text, grid, rows, columns, rect, inset } from './layout.js';
import { createDictationControl, capitalize } from './dictation.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_EVENT_ROWS = 4;

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The 42 dates shown for a month view, starting on the Sunday on or before the 1st.
export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

function create(ctx) {
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selected = dateKey(today);
  // Events live in memory only, so each demo run starts clean.
  const events = new Map();
  let nextId = 1;
  const dictation = createDictationControl(ctx, (spoken) => addEvent(spoken));

  function addEvent(value) {
    const clean = capitalize(value.trim()).slice(0, 100);
    if (!clean) return;
    if (!events.has(selected)) events.set(selected, []);
    events.get(selected).push({ id: nextId++, text: clean });
  }

  function shiftMonth(delta) {
    const date = new Date(viewYear, viewMonth + delta, 1);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
  }

  function selectedLabel() {
    const [y, m, d] = selected.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function monthWidgets(area) {
    const [header, weekdays, days] = rows(area, [1, 0.55, 6], 0.015);
    const [title, prev, next, todayButton] = columns(header, [3.4, 0.9, 0.9, 1.5], 0.02);
    const widgets = [
      text('month', title, `${MONTHS[viewMonth]} ${viewYear}`, ['title', 'left']),
      button('prev', prev, '', 'subtle', { icon: 'chevron-left' }),
      button('next', next, '', 'subtle', { icon: 'chevron-right' }),
      button('today', todayButton, 'Today', 'ghost'),
    ];
    const weekdayCell = grid(weekdays, 1, 7, 0.008);
    WEEKDAYS.forEach((name, i) => widgets.push(text(`wd-${i}`, weekdayCell(0, i), name, 'label')));
    const dayCell = grid(days, 6, 7, 0.008, 0.012);
    const todayKey = dateKey(today);
    monthCells(viewYear, viewMonth).forEach((date, i) => {
      const key = dateKey(date);
      const variant = ['day'];
      if (date.getMonth() !== viewMonth) variant.push('outside');
      if (key === todayKey) variant.push('today');
      if (key === selected) variant.push('selected');
      if (events.get(key)?.length) variant.push('has-event');
      widgets.push(button(`day-${key}`, dayCell(Math.floor(i / 7), i % 7), String(date.getDate()), variant));
    });
    return widgets;
  }

  function eventWidgets(area) {
    const [title, list, status, dictate] = rows(area, [0.9, 4, 0.6, 1], 0.02);
    const widgets = [text('selected-date', title, selectedLabel(), ['left', 'accent-text', 'title'])];
    const dayEvents = events.get(selected) ?? [];
    if (!dayEvents.length) widgets.push(text('no-events', list, 'No events', ['muted', 'card'], { icon: 'calendar' }));
    const slots = rows(list, Array(MAX_EVENT_ROWS).fill(1), 0.02);
    dayEvents.slice(-MAX_EVENT_ROWS).forEach((event, i) => {
      const [label, remove] = columns(slots[i], [5, 1], 0.015);
      widgets.push(
        text(`event-${event.id}`, label, event.text, ['left', 'small', 'event']),
        button(`delete-${event.id}`, remove, '', 'ghost', { icon: 'x' }),
      );
    });
    const statusText = dictation.status();
    if (statusText) widgets.push(text('status', status, statusText, ['left', 'small', dictation.error ? 'error' : 'muted']));
    widgets.push(button('dictate', dictate, dictation.listening ? 'Stop' : 'Add event', dictation.listening ? 'listening' : 'primary', { icon: dictation.listening ? 'stop' : 'mic' }));
    return widgets;
  }

  return {
    widgets() {
      const area = inset(rect(0, 0, 1, 1), 0.025);
      // Wide windows put events beside the month; tall ones put them below.
      const [month, side] = ctx.aspect() >= 1.25 ? columns(area, [2.2, 1], 0.03) : rows(area, [2.2, 1.3], 0.03);
      return [...monthWidgets(month), ...eventWidgets(side)];
    },
    handleAction({ widget_id: id }) {
      if (id === 'prev') shiftMonth(-1);
      else if (id === 'next') shiftMonth(1);
      else if (id === 'today') {
        viewYear = today.getFullYear();
        viewMonth = today.getMonth();
        selected = dateKey(today);
      } else if (id === 'dictate') dictation.toggle();
      else if (id.startsWith('day-')) {
        selected = id.slice(4);
        const [y, m] = selected.split('-').map(Number);
        viewYear = y;
        viewMonth = m - 1;
      } else if (id.startsWith('delete-')) {
        const list = events.get(selected) ?? [];
        events.set(selected, list.filter((event) => `delete-${event.id}` !== id));
      }
    },
    receiveText(value) {
      addEvent(value);
      return true;
    },
  };
}

export default { title: 'Calendar', create };
