// Connects the widget renderer and apps to Carter's shell (surfaceos-shell/frontend).
//
// The shell calls the renderer interface registered with window.SurfaceOS.mountWidgetRenderer:
//   renderLayout(layout, host, onAction)   contract v1 layout drawn by the widget renderer
//   mountApp(windowRecord, host, onAction) optional: runs a widget app chosen from `apps`
//   sync(windowRecords)                    optional: after each shell render, drops content of closed windows
//   handleKey(windowId, event)             optional: keyboard fallback for the focused window
//   cancelFlow(windowId)                   optional: backs out of an app step; true means close the window
//   flowActive()                           optional: true while any app is in a step a thumbs-up must not interrupt
//   snapshot()                             optional: asks the AI service for one camera photo of the desk
//
// The shell rebuilds window frames on every render, so each window's content lives in a persistent
// root element that is moved into the new host. That keeps app state, canvases, and videos alive.
//
// Pointers reach the content two ways, both as contract v1 events in window-local coordinates:
// hand input arrives as the shell's `surfaceos:window-pointer` event on the host, and mouse input is
// read here from native pointer events, because the renderer has no DOM click handlers.

import { createWidgetRenderer } from './widget-renderer.js';
import { mountApp, APPS } from './apps/app-host.js';
import { sharedAIClient } from './ai-client.js';

const HAND_EVENT = 'surfaceos:window-pointer';

export function createShellAdapter() {
  // window_id -> { kind: 'layout' | 'app', content, root, handler, app?, renderer?, onAction }
  const entries = new Map();
  const listeningHosts = new WeakSet();

  function destroy(id) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    entry.app?.destroy();
    entry.renderer?.clear();
    entry.root.remove();
  }

  function createRoot(id) {
    const root = document.createElement('div');
    root.dataset.surfaceosWindow = id;
    // Fills the shell's content host; inline so the shell stylesheet is untouched.
    root.style.position = 'absolute';
    root.style.inset = '0';
    attachMouse(root, id);
    return root;
  }

  function deliver(id, event) {
    const entry = entries.get(id);
    return entry ? entry.handler(event) : false;
  }

  // Mouse fallback: the same event shape the hand tracker produces, local to this window.
  function attachMouse(root, id) {
    let pressed = false;
    const local = (type, e) => {
      const box = root.getBoundingClientRect();
      return { version: 1, type, x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height, source: 'mouse' };
    };
    root.addEventListener('pointerdown', (e) => {
      // Text fields keep native mouse behavior (focus, caret, selection, paste menu).
      if (e.button !== 0 || e.target.closest('input, textarea')) return;
      pressed = true;
      root.setPointerCapture(e.pointerId);
      deliver(id, local('pointer_down', e));
    });
    root.addEventListener('pointermove', (e) => deliver(id, local('pointer_move', e)));
    root.addEventListener('pointerup', (e) => {
      if (!pressed) return;
      pressed = false;
      // Delivered inside the real pointerup, so apps can use APIs that need a user gesture.
      deliver(id, local('pointer_up', e));
    });
    const cancel = () => {
      if (!pressed) return;
      pressed = false;
      deliver(id, { version: 1, type: 'pointer_cancel', source: 'mouse' });
    };
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('lostpointercapture', cancel);
    // Clears hover when the mouse leaves the window without a press.
    root.addEventListener('pointerleave', () => {
      if (!pressed) deliver(id, { version: 1, type: 'pointer_move', x: -1, y: -1, source: 'mouse' });
    });
  }

  function attach(host, entry, id) {
    if (entry.root.parentElement !== host) host.append(entry.root);
    if (!listeningHosts.has(host)) {
      listeningHosts.add(host);
      host.addEventListener(HAND_EVENT, (e) => {
        const detail = e.detail;
        if (detail?.window_id === id) deliver(id, detail);
      });
    }
  }

  return {
    apps: Object.entries(APPS).map(([type, definition]) => ({ type, title: definition.title })),

    renderLayout(layout, host, onAction) {
      const id = layout?.window_id;
      if (typeof id !== 'string' || !id) {
        console.warn('SurfaceOS layout without window_id', layout);
        return;
      }
      let entry = entries.get(id);
      if (!entry || entry.kind !== 'layout') {
        destroy(id);
        const root = createRoot(id);
        entry = { kind: 'layout', root, onAction };
        entry.renderer = createWidgetRenderer(root, { onAction: (action) => entry.onAction?.(action) });
        entry.handler = (event) => entry.renderer.handlePointer(event);
        entries.set(id, entry);
      }
      entry.onAction = onAction;
      entry.renderer.renderLayout(layout);
      attach(host, entry, id);
    },

    mountApp(windowRecord, host, onAction) {
      const { id, content, launch } = windowRecord;
      let entry = entries.get(id);
      if (!entry || entry.kind !== 'app' || entry.content !== content) {
        destroy(id);
        const root = createRoot(id);
        entry = { kind: 'app', content, root, onAction };
        // Attach before mounting so the app lays out against the real window size.
        host.append(root);
        // The shell blanks the projection for desk photos and closes windows; apps reach both through services.
        const services = {
          captureDesk: (windowId) => window.SurfaceOS?.captureDesk?.(windowId) ?? sharedAIClient().snapshot(windowId).promise,
          closeWindow: (windowId) => window.SurfaceOS?.closeWindow?.(windowId),
        };
        entry.app = mountApp(root, { type: content, windowId: id, launch, services, onAction: (action) => entry.onAction?.(action) });
        entry.handler = (event) => entry.app.handlePointer(event);
        entries.set(id, entry);
      }
      entry.onAction = onAction;
      attach(host, entry, id);
    },

    sync(windowRecords) {
      const current = new Map(windowRecords.map((record) => [record.id, record.content]));
      for (const [id, entry] of entries) {
        const content = current.get(id);
        const stale = content === undefined
          || (entry.kind === 'app' && content !== entry.content)
          || (entry.kind === 'layout' && (content === 'notes' || Object.hasOwn(APPS, content)));
        if (stale) destroy(id);
      }
    },

    handleKey(windowId, event) {
      return entries.get(windowId)?.app?.handleKey(event) ?? false;
    },

    cancelFlow(windowId) {
      return entries.get(windowId)?.app?.cancelFlow() ?? false;
    },

    flowActive() {
      return [...entries.values()].some((entry) => entry.app?.flowActive());
    },

    snapshot(windowId) {
      return sharedAIClient().snapshot(windowId).promise;
    },
  };
}

// Registers with the shell once it has loaded.
if (window.SurfaceOS?.mountWidgetRenderer) {
  window.SurfaceOS.mountWidgetRenderer(createShellAdapter());
} else {
  console.error('SurfaceOS shell not found; load surfaceos-shell/frontend/scripts/app.js first.');
}
