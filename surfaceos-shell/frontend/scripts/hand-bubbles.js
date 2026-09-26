// Optional raw camera debugging overlay. The projected cursor is calibrated separately.
// Enable with ?bubbles=on only while diagnosing hand tracking.
// Bubbles sit above the UI and never take pointer events.

const COLORS = ['cyan', 'amber', 'pink', 'lime'];
// Hides everything if the tracker stops sending snapshots, for example when the camera freezes.
const STALE_MS = 600;

const stage = document.querySelector('#stage');
const layer = document.createElement('div');
layer.id = 'hand-bubbles';
layer.setAttribute('aria-hidden', 'true');
stage.append(layer);

const bubbles = new Map();
let staleTimer = null;

function bubbleFor(id) {
  let bubble = bubbles.get(id);
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'hand-bubble';
    bubble.dataset.hand = String(id);
    bubble.dataset.color = COLORS[bubbles.size % COLORS.length];
    const label = document.createElement('span');
    bubble.append(label);
    layer.append(bubble);
    bubbles.set(id, bubble);
  }
  return bubble;
}

function hideAll() {
  for (const bubble of bubbles.values()) bubble.hidden = true;
}

function update(hands) {
  const seen = new Set();
  for (const hand of hands) {
    if (!Number.isFinite(hand?.x) || !Number.isFinite(hand?.y)) continue;
    const bubble = bubbleFor(hand.id);
    seen.add(hand.id);
    bubble.hidden = false;
    // Same percentages of the stage as the shell's hand cursor and hit testing.
    bubble.style.left = `${hand.x * 100}%`;
    bubble.style.top = `${hand.y * 100}%`;
    bubble.classList.toggle('pinching', !!hand.pinching);
    bubble.classList.toggle('primary', !!hand.primary);
    bubble.firstChild.textContent = `H${hand.id}${hand.primary ? ' · primary' : ''}`;
  }
  for (const [id, bubble] of bubbles) if (!seen.has(id)) bubble.hidden = true;
  clearTimeout(staleTimer);
  if (seen.size) staleTimer = setTimeout(hideAll, STALE_MS);
}

if (new URLSearchParams(location.search).get('bubbles') === 'on') {
  window.addEventListener('surfaceos:hand-debug', (e) => update(Array.isArray(e.detail) ? e.detail : []));
}
