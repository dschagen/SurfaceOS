// Runs one widget app inside one shell window.
//
// The shell creates the window frame and a content element, then calls mountApp. The app keeps its
// own state, describes its content as a contract v1 layout, and handles its own button actions.
// The shell still routes pointers (window-local coordinates) and keyboard input to the right window.

import { createWidgetRenderer } from '../widget-renderer.js';
import { createBrowserDictation } from './dictation.js';
import { APPS } from './index.js';

const DEFAULT_SERVICES = {
  mediaBridgeUrl: 'http://127.0.0.1:8766',
  // Florida International University, the ShellHacks venue.
  weather: { name: 'Miami, FL', latitude: 25.7574, longitude: -80.3733 },
};

let sharedDictation = null;

export function mountApp(container, { type, windowId, onAction, dictation, services, warn } = {}) {
  const definition = APPS[type];
  if (!definition) throw new Error(`Unknown SurfaceOS app type: ${type}`);
  if (typeof windowId !== 'string' || !windowId) throw new Error('mountApp needs a windowId');

  let destroyed = false;
  let renderQueued = false;
  // Selects the app's accent color in widgets.css.
  const appClass = `surfaceos-app-${type}`;
  container.classList.add(appClass);
  const cleanups = [];

  const renderer = createWidgetRenderer(container, {
    warn,
    onAction(action) {
      if (destroyed || action.window_id !== windowId) return;
      app.handleAction?.(action);
      update();
      try {
        onAction?.(action);
      } catch (error) {
        console.error('SurfaceOS shell onAction handler failed', error);
      }
    },
  });

  function render() {
    if (destroyed) return;
    renderer.renderLayout({ version: 1, window_id: windowId, widgets: app.widgets() });
    app.afterRender?.();
  }

  // Batches state changes into one render.
  function update() {
    if (renderQueued || destroyed) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      render();
    });
  }

  const ctx = {
    windowId,
    update,
    // Content size in pixels, for apps that need square cells or pixel-accurate drawing.
    size() {
      return { width: container.clientWidth, height: container.clientHeight };
    },
    aspect() {
      const { width, height } = ctx.size();
      return width > 0 && height > 0 ? width / height : 1;
    },
    element(widgetId) {
      return renderer.getElement(widgetId);
    },
    every(ms, fn) {
      const id = setInterval(() => { if (!destroyed) fn(); }, ms);
      const cancel = () => clearInterval(id);
      cleanups.push(cancel);
      return cancel;
    },
    after(ms, fn) {
      const id = setTimeout(() => { if (!destroyed) fn(); }, ms);
      const cancel = () => clearTimeout(id);
      cleanups.push(cancel);
      return cancel;
    },
    onDestroy(fn) {
      cleanups.push(fn);
    },
    get destroyed() {
      return destroyed;
    },
    dictation: dictation || (sharedDictation ??= createBrowserDictation()),
    services: { ...DEFAULT_SERVICES, ...services },
  };

  const app = definition.create(ctx);

  const resizeObserver = new ResizeObserver(() => update());
  resizeObserver.observe(container);
  render();

  return {
    type,
    title: definition.title,
    windowId,
    // Pointer event in window-local coordinates, as for renderer.handlePointer.
    handlePointer(event) {
      if (destroyed) return false;
      const usedByWidget = renderer.handlePointer(event);
      const usedByApp = app.handlePointer?.(event) ?? false;
      return usedByWidget || usedByApp;
    },
    // Keyboard fallback for the focused window: { type: 'keydown' | 'keyup', key }.
    handleKey(event) {
      if (destroyed || !event || typeof event.key !== 'string') return false;
      const used = app.handleKey?.(event) ?? false;
      if (used) update();
      return used;
    },
    // Text from an external speech-to-text engine.
    receiveText(text) {
      if (destroyed || typeof text !== 'string') return false;
      const used = app.receiveText?.(text) ?? false;
      if (used) update();
      return used;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      for (const cleanup of cleanups) {
        try { cleanup(); } catch (error) { console.error(error); }
      }
      try { app.destroy?.(); } catch (error) { console.error(error); }
      renderer.clear();
      container.classList.remove(appClass);
    },
  };
}

export { APPS };
