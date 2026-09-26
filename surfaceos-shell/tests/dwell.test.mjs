import assert from 'node:assert/strict';
import test from 'node:test';
import {createDwellTracker} from '../frontend/scripts/dwell.js';

test('three-second hold records a median point without a pinch',()=>{
  const tracker=createDwellTracker();let result;
  for(let i=0;i<=30;i++)result=tracker.update({x:.4+(i%3-1)*.002,y:.5},i*100);
  assert.equal(result.phase,'complete');
  assert.ok(Math.abs(result.sample[0]-.4)<.003);
  assert.equal(result.sample[1],.5);
});

test('motion and tracking loss restart the countdown',()=>{
  const tracker=createDwellTracker();
  tracker.update({x:.3,y:.4},0);
  assert.equal(tracker.update({x:.3,y:.4},2000).progress,0);
  assert.equal(tracker.update({x:.36,y:.4},2500).progress,0);
  tracker.cancel();
  assert.equal(tracker.update({x:.36,y:.4},4000).progress,0);
});

test('next target waits until the fingertip leaves the last location',()=>{
  const tracker=createDwellTracker({durationMs:300,minSamples:3});
  tracker.update({x:.2,y:.2},0);tracker.update({x:.2,y:.2},150);
  assert.equal(tracker.update({x:.2,y:.2},300).phase,'complete');
  assert.equal(tracker.update({x:.2,y:.2},400).phase,'move');
  assert.equal(tracker.update({x:.5,y:.2},500).phase,'holding');
});
