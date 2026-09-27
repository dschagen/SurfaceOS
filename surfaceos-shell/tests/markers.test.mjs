import assert from 'node:assert/strict';
import test from 'node:test';
import {ARUCO_4X4_50,markerLayout,drawMarkers} from '../frontend/scripts/markers.js';

test('layout gives twelve square, separated markers inside the surface',()=>{
  const width=1600,height=900,markers=markerLayout(width,height);
  assert.equal(markers.length,12);
  assert.deepEqual(markers.map(m=>m.id),[...Array(12).keys()]);
  for(const {corners} of markers){
    for(const [u,v] of corners){assert.ok(u>0&&u<1&&v>0&&v<1);}
    const [x0,y0]=corners[0],[x1,y1]=corners[2];
    assert.ok(Math.abs((x1-x0)*width-(y1-y0)*height)<1e-6,'square at the given surface size');
    assert.deepEqual(corners[1],[x1,y0]);assert.deepEqual(corners[3],[x0,y1]);
  }
  for(let i=0;i<markers.length;i++)for(let j=i+1;j<markers.length;j++){
    const a=markers[i].corners,b=markers[j].corners;
    const apart=a[2][0]<b[0][0]||b[2][0]<a[0][0]||a[2][1]<b[0][1]||b[2][1]<a[0][1];
    assert.ok(apart,`markers ${i} and ${j} overlap`);
  }
});

test('layout refuses more markers than known patterns',()=>{
  assert.throws(()=>markerLayout(100,100,{columns:5,rows:3}),RangeError);
});

test('drawing paints each marker border and its white bits',()=>{
  const calls=[];let fill='';
  const context={set fillStyle(value){fill=value;},get fillStyle(){return fill;},fillRect:(...args)=>calls.push([fill,...args])};
  drawMarkers(context,markerLayout(600,600,{columns:1,rows:1}),600,600);
  const white=ARUCO_4X4_50[0].split('').filter(bit=>bit==='1').length;
  assert.equal(calls.filter(([color])=>color==='#000').length,1);
  assert.equal(calls.filter(([color])=>color==='#fff').length,1+white);
});
