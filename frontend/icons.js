// Built-in line icons for widgets, drawn on a 24x24 grid with round strokes.
// A widget names one with its optional "icon" field; layout data never carries SVG markup.
// Each icon is a list of [tag, attributes]. A "fill" attribute makes that shape solid.

const speaker = ['path', { d: 'M11 5 6 9H3v6h3l5 4z', fill: true }];
const cloudHigh = ['path', { d: 'M7 15.5a4 4 0 0 1-.4-8 6 6 0 0 1 11.3 1.6A3.3 3.3 0 0 1 17.5 15.5z' }];

export const ICONS = {
  play: [['path', { d: 'M7 4.5v15l12.5-7.5z', fill: true }]],
  pause: [['rect', { x: 6, y: 4.5, width: 4, height: 15, rx: 1, fill: true }], ['rect', { x: 14, y: 4.5, width: 4, height: 15, rx: 1, fill: true }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5, fill: true }]],
  previous: [['path', { d: 'M18.5 5v14L9 12z', fill: true }], ['path', { d: 'M6 5v14' }]],
  next: [['path', { d: 'M5.5 5v14L15 12z', fill: true }], ['path', { d: 'M18 5v14' }]],
  'volume-down': [speaker, ['path', { d: 'M15.5 9.5a3.5 3.5 0 0 1 0 5' }]],
  'volume-up': [speaker, ['path', { d: 'M15.5 9.5a3.5 3.5 0 0 1 0 5' }], ['path', { d: 'M18.5 6.5a7.5 7.5 0 0 1 0 11' }]],
  mute: [speaker, ['path', { d: 'm16 9.5 5 5m0-5-5 5' }]],
  mic: [['rect', { x: 9, y: 2.5, width: 6, height: 11.5, rx: 3 }], ['path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4' }]],
  check: [['path', { d: 'm4.5 12.5 5 5 10-11' }]],
  x: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  trash: [['path', { d: 'M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5M10.5 10.5v6M13.5 10.5v6' }]],
  'chevron-left': [['path', { d: 'm15 5-7 7 7 7' }]],
  'chevron-right': [['path', { d: 'm9 5 7 7-7 7' }]],
  undo: [['path', { d: 'M9 14 4 9l5-5' }], ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }]],
  refresh: [['path', { d: 'M20 12a8 8 0 1 1-2.3-5.7L20 8.5' }], ['path', { d: 'M20 3.5v5h-5' }]],
  reset: [['path', { d: 'M4 12a8 8 0 1 0 2.3-5.7L4 8.5' }], ['path', { d: 'M4 3.5v5h5' }]],
  backspace: [['path', { d: 'M21 5H8.5L2.5 12l6 7H21a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z' }], ['path', { d: 'm17.5 9-5.5 6m0-6 5.5 6' }]],
  'new-line': [['path', { d: 'M20 5v6a4 4 0 0 1-4 4H5' }], ['path', { d: 'm9 11-4 4 4 4' }]],
  flag: [['path', { d: 'M5 21V4M5 4.5c4-2 7 2 14 0v9c-7 2-10-2-14 0' }]],
  home: [['path', { d: 'm3 11.5 9-8 9 8M5.5 9.5V20h13V9.5' }]],
  monitor: [['rect', { x: 2.5, y: 3.5, width: 19, height: 13, rx: 2 }], ['path', { d: 'M8 21h8M12 16.5V21' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9.5 }], ['path', { d: 'M2.5 12h19M12 2.5c3 3.2 3 15.8 0 19M12 2.5c-3 3.2-3 15.8 0 19' }]],
  music: [['path', { d: 'M9 18V5.5l11-2V16' }], ['circle', { cx: 6.5, cy: 18, r: 2.5 }], ['circle', { cx: 17.5, cy: 16, r: 2.5 }]],
  users: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6' }], ['path', { d: 'M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.3c2.4.7 4 2.8 4 5.7' }]],
  cpu: [['rect', { x: 5, y: 5, width: 14, height: 14, rx: 2 }], ['rect', { x: 9, y: 9, width: 6, height: 6, rx: 1 }], ['path', { d: 'M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3' }]],
  stopwatch: [['circle', { cx: 12, cy: 13.5, r: 7.5 }], ['path', { d: 'M12 13.5V9.5M10 2.5h4M18.5 6.5l1.5-1.5' }]],
  hourglass: [['path', { d: 'M6.5 3h11M6.5 21h11M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9' }]],
  calendar: [['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2 }], ['path', { d: 'M3.5 10h17M8 3v4M16 3v4' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8' }]],
  'cloud-sun': [['circle', { cx: 8.5, cy: 8.5, r: 3 }], ['path', { d: 'M8.5 2.5v1.3M2.5 8.5h1.3M4.3 4.3l1 1M12.7 4.3l-1 1' }], ['path', { d: 'M9.5 20a3.8 3.8 0 0 1-.3-7.6 5.5 5.5 0 0 1 10.4 1.6A3 3 0 0 1 19 20z' }]],
  cloud: [['path', { d: 'M7 19a4.5 4.5 0 0 1-.5-9 6.5 6.5 0 0 1 12.4 1.8A3.7 3.7 0 0 1 18.3 19z' }]],
  rain: [cloudHigh, ['path', { d: 'M8.5 18.5 7.5 21M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5' }]],
  storm: [cloudHigh, ['path', { d: 'M12.5 15.5 10 19.5h4L11.5 23' }]],
  snow: [cloudHigh, ['path', { d: 'M8 19h.01M12 21h.01M16 19h.01M10 23h.01M14 23h.01' }]],
  fog: [['path', { d: 'M3.5 8h17M5.5 12h13M3.5 16h17M7.5 20h9' }]],
  pen: [['path', { d: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z' }], ['path', { d: 'm13.5 6.5 4 4' }]],
  list: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['path', { d: 'm3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2' }]],
  calculator: [['rect', { x: 4.5, y: 2.5, width: 15, height: 19, rx: 2 }], ['path', { d: 'M8 6.5h8M8 11h.01M12 11h.01M16 11h.01M8 14.5h.01M12 14.5h.01M16 14.5h.01M8 18h.01M12 18h.01M16 18h.01' }]],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createIcon(name) {
  const shapes = ICONS[name];
  if (!shapes) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'surfaceos-icon');
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'fill') shape.setAttribute('class', 'surfaceos-icon-fill');
      else shape.setAttribute(key, String(value));
    }
    svg.append(shape);
  }
  return svg;
}
