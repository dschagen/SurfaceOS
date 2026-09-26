import assert from 'node:assert/strict';
import test from 'node:test';
import { rectangleBetween, moveWithinCanvas, resizeWithinCanvas, contains } from '../frontend/scripts/geometry.js';

test('drawing in reverse gives the same positive window rectangle', () => {
  const result = rectangleBetween({ x: .8, y: .7 }, { x: .2, y: .1 });
  assert.equal(result.x, .2);
  assert.equal(result.y, .1);
  assert.ok(Math.abs(result.width - .6) < 1e-12);
  assert.ok(Math.abs(result.height - .6) < 1e-12);
});

test('moving and resizing stay in projector canvas', () => {
  const rect = { x: .4, y: .3, width: .3, height: .4 };
  assert.deepEqual(moveWithinCanvas(rect, 2, -2), { x: .7, y: 0, width: .3, height: .4 });
  assert.deepEqual(resizeWithinCanvas(rect, 2, -2), { x: .4, y: .3, width: .6, height: .1 });
  assert.equal(contains(rect, { x: .5, y: .5 }), true);
  assert.equal(contains(rect, { x: .9, y: .5 }), false);
});
