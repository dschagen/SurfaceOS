// Runs the chess search off the main thread so the projected UI stays responsive.
import { chooseAiMove } from './chess-engine.js';

self.onmessage = (event) => {
  const { id, state, level } = event.data;
  let move = null;
  try {
    move = chooseAiMove(state, { level });
  } catch (error) {
    console.error('Chess worker failed', error);
  }
  self.postMessage({ id, move });
};
