import { button, text, rows, columns, rect, inset } from './layout.js';

// Stopwatch format: m:ss.t, or h:mm:ss.t past an hour.
export function formatStopwatch(ms) {
  const tenths = Math.floor(ms / 100) % 10;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mmss = `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${String(seconds).padStart(2, '0')}`;
  return `${mmss}.${tenths}`;
}

// Countdown format: m:ss, rounding up so the display reaches 0:00 exactly when time is up.
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function beep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContext();
    [0, 0.35, 0.7].forEach((offset) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, audio.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + offset + 0.25);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(audio.currentTime + offset);
      oscillator.stop(audio.currentTime + offset + 0.3);
    });
    setTimeout(() => audio.close(), 1500);
  } catch {
    // The visual alarm is enough if audio is blocked.
  }
}

const MAX_TIMER_MS = 10 * 3600 * 1000;

function create(ctx) {
  let mode = 'stopwatch';
  const stopwatch = { running: false, startedAt: 0, banked: 0, laps: [] };
  const timer = { running: false, endsAt: 0, remaining: 0, set: 0, done: false };

  const stopwatchElapsed = () => stopwatch.banked + (stopwatch.running ? performance.now() - stopwatch.startedAt : 0);
  const timerRemaining = () => (timer.running ? Math.max(0, timer.endsAt - performance.now()) : timer.remaining);

  ctx.every(100, () => {
    if (timer.running && timerRemaining() <= 0) {
      timer.running = false;
      timer.remaining = 0;
      timer.done = true;
      beep();
    }
    if (stopwatch.running || timer.running || timer.done) ctx.update();
  });

  function stopwatchWidgets(display, below, controls) {
    const elapsed = stopwatchElapsed();
    const widgets = [text('display', display, formatStopwatch(elapsed), ['huge', 'mono'])];
    const lapLines = stopwatch.laps.slice(-3).reverse().map((lap) => `Lap ${lap.number}    ${formatStopwatch(lap.split)}`);
    widgets.push(text('laps', below, lapLines.join('\n') || 'Laps appear here', ['mono', 'small', 'muted', 'pre']));
    const [main, second] = columns(controls, [1, 1], 0.03);
    widgets.push(
      button('sw-toggle', main, stopwatch.running ? 'Stop' : elapsed ? 'Resume' : 'Start',
        stopwatch.running ? ['danger', 'large'] : ['primary', 'large'], { icon: stopwatch.running ? 'pause' : 'play' }),
      stopwatch.running
        ? button('sw-lap', second, 'Lap', 'large', { icon: 'flag' })
        : button('sw-reset', second, 'Reset', 'large', { icon: 'reset', disabled: !elapsed }),
    );
    return widgets;
  }

  function timerWidgets(display, below, controls) {
    if (timer.done) {
      return [
        text('display', rect(display.x, display.y, display.width, below.y + below.height - display.y), "Time's up", ['huge', 'alarm']),
        button('tm-dismiss', controls, 'Dismiss', ['primary', 'large'], { icon: 'check' }),
      ];
    }
    const remaining = timerRemaining();
    const widgets = [text('display', display, formatCountdown(remaining), ['huge', 'mono'])];
    if (timer.running || (timer.set && remaining < timer.set)) {
      // Progress bar showing how much of the countdown is left.
      const bar = rect(below.x + below.width * 0.08, below.y + below.height * 0.42, below.width * 0.84, below.height * 0.16);
      widgets.push(text('track', bar, '', 'track'));
      const fraction = timer.set ? remaining / timer.set : 0;
      if (fraction > 0.002) widgets.push(text('fill', { ...bar, width: bar.width * fraction }, '', 'fill'));
    } else {
      const cells = columns(inset(below, 0, below.height * 0.12), [1, 1, 1, 1], 0.02);
      [['tm-add-10s', '+10 s'], ['tm-add-1m', '+1 min'], ['tm-add-5m', '+5 min']].forEach(([id, label], i) => {
        widgets.push(button(id, cells[i], label, 'subtle'));
      });
      widgets.push(button('tm-clear', cells[3], 'Clear', 'ghost', { disabled: !remaining }));
    }
    const [main, second] = columns(controls, [1, 1], 0.03);
    widgets.push(
      button('tm-toggle', main, timer.running ? 'Pause' : 'Start', timer.running ? ['danger', 'large'] : ['primary', 'large'],
        { icon: timer.running ? 'pause' : 'play', disabled: !timer.running && !remaining }),
      button('tm-reset', second, 'Reset', 'large', { icon: 'reset', disabled: !timer.set }),
    );
    return widgets;
  }

  return {
    widgets() {
      const [tabs, display, middle, controls] = rows(inset(rect(0, 0, 1, 1), 0.04), [1, 2.6, 1.2, 1.3], 0.03);
      const [swTab, tmTab] = columns(tabs, [1, 1], 0.02);
      // Shows a running countdown on the tab while the stopwatch is in view.
      const timerLabel = timer.running && mode === 'stopwatch' ? `Timer  ${formatCountdown(timerRemaining())}` : 'Timer';
      const widgets = [
        button('tab-stopwatch', swTab, 'Stopwatch', mode === 'stopwatch' && !timer.done ? 'selected' : 'ghost', { icon: 'stopwatch' }),
        button('tab-timer', tmTab, timerLabel, mode === 'timer' || timer.done ? 'selected' : 'ghost', { icon: 'hourglass' }),
      ];
      // A finished timer takes over the window so it is noticed.
      if (mode === 'timer' || timer.done) return [...widgets, ...timerWidgets(display, middle, controls)];
      return [...widgets, ...stopwatchWidgets(display, middle, controls)];
    },
    handleAction({ widget_id: id }) {
      const now = performance.now();
      switch (id) {
        case 'tab-stopwatch': mode = 'stopwatch'; break;
        case 'tab-timer': mode = 'timer'; break;
        case 'sw-toggle':
          if (stopwatch.running) stopwatch.banked += now - stopwatch.startedAt;
          else stopwatch.startedAt = now;
          stopwatch.running = !stopwatch.running;
          break;
        case 'sw-lap': {
          const elapsed = stopwatchElapsed();
          const previous = stopwatch.laps.at(-1)?.total ?? 0;
          stopwatch.laps.push({ number: stopwatch.laps.length + 1, total: elapsed, split: elapsed - previous });
          break;
        }
        case 'sw-reset': Object.assign(stopwatch, { running: false, banked: 0, laps: [] }); break;
        case 'tm-add-10s': case 'tm-add-1m': case 'tm-add-5m': {
          const add = { 'tm-add-10s': 10e3, 'tm-add-1m': 60e3, 'tm-add-5m': 300e3 }[id];
          timer.remaining = Math.min(MAX_TIMER_MS, timer.remaining + add);
          timer.set = timer.remaining;
          break;
        }
        case 'tm-clear': Object.assign(timer, { remaining: 0, set: 0 }); break;
        case 'tm-toggle':
          if (timer.running) {
            timer.remaining = timerRemaining();
            timer.running = false;
          } else if (timer.remaining > 0) {
            timer.endsAt = now + timer.remaining;
            timer.running = true;
          }
          break;
        case 'tm-reset': Object.assign(timer, { running: false, remaining: timer.set, done: false }); break;
        case 'tm-dismiss': Object.assign(timer, { done: false, remaining: timer.set }); mode = 'timer'; break;
        default: break;
      }
    },
  };
}

export default { title: 'Timer', create };
