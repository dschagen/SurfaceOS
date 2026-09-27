import assert from 'node:assert/strict';
import test from 'node:test';
import {rectBetween,validRect,homography,project,unproject,cssMatrix,surfacePixelSize,quadValid,polygonsOverlap} from '../frontend/scripts/geometry.js';

test('reverse drag creates positive bounds and windows cannot overlap',()=>{
  const drawn=rectBetween({x:.7,y:.6},{x:.2,y:.1});
  assert.equal(drawn.x,.2);assert.equal(drawn.y,.1);
  assert.ok(Math.abs(drawn.width-.5)<1e-12);assert.equal(drawn.height,.5);
  const others=[{id:'one',x:.2,y:.2,width:.3,height:.3}];
  assert.equal(validRect({x:.4,y:.4,width:.2,height:.2},others),false);
  assert.equal(validRect({x:.5,y:.2,width:.2,height:.2},others),true);
  assert.equal(validRect({x:.9,y:.4,width:.2,height:.2},others),false);
  assert.equal(validRect({x:.4,y:.4,width:.2,height:.2},others,'one'),true);
});

test('perspective mapping preserves four corners and round trips an interior point',()=>{
  const quad=[[.16,.18],[.84,.10],[.73,.84],[.24,.76]];
  assert.equal(quadValid(quad),true);
  const h=homography(quad);
  for(const [i,[u,v]] of [[0,0],[1,0],[1,1],[0,1]].entries()){
    const point=project(h,u,v);
    assert.ok(Math.abs(point.x-quad[i][0])<1e-9);
    assert.ok(Math.abs(point.y-quad[i][1])<1e-9);
  }
  const physical=project(h,.42,.65),logical=unproject(h,physical.x,physical.y);
  assert.ok(Math.abs(logical.x-.42)<1e-9);
  assert.ok(Math.abs(logical.y-.65)<1e-9);
});

test('CSS matrix maps a surface point to the same projector pixel',()=>{
  const width=1600,height=900,h=homography([[.1,.2],[.82,.16],[.76,.85],[.14,.79]]);
  const m=cssMatrix(h,width,height),x=.31*width,y=.47*height;
  const d=m[3]*x+m[7]*y+m[15];
  const css={x:(m[0]*x+m[4]*y+m[12])/d,y:(m[1]*x+m[5]*y+m[13])/d};
  const expected=project(h,.31,.47);
  assert.ok(Math.abs(css.x-width*expected.x)<1e-7);
  assert.ok(Math.abs(css.y-height*expected.y)<1e-7);
  assert.equal(quadValid([[.1,.1],[.8,.1],[.4,.4],[.2,.7]]),false);
});

test('surface plane uses projected pixel size without changing its four mapped corners',()=>{
  const stageWidth=1600,stageHeight=900;
  const corners=[[.1,.2],[.8,.2],[.8,.8],[.1,.8]];
  const size=surfacePixelSize(corners,stageWidth,stageHeight);
  assert.ok(Math.abs(size.width-1120)<1e-9);
  assert.ok(Math.abs(size.height-540)<1e-9);
  const h=homography(corners),m=cssMatrix(h,size.width,size.height,stageWidth,stageHeight);
  for(const [u,v] of [[0,0],[1,0],[1,1],[0,1],[.4,.6]]){
    const x=u*size.width,y=v*size.height,d=m[3]*x+m[7]*y+m[15];
    const mapped={x:(m[0]*x+m[4]*y+m[12])/d,y:(m[1]*x+m[5]*y+m[13])/d};
    const expected=project(h,u,v);
    assert.ok(Math.abs(mapped.x-stageWidth*expected.x)<1e-7);
    assert.ok(Math.abs(mapped.y-stageHeight*expected.y)<1e-7);
  }
  assert.ok(Math.abs(m[0]-1)<1e-9);
  assert.ok(Math.abs(m[5]-1)<1e-9);
});

test('two calibrated regions cannot claim the same projected pixels',()=>{
  const left=[[.1,.2],[.45,.2],[.45,.8],[.1,.8]];
  const right=[[.55,.2],[.9,.2],[.9,.8],[.55,.8]];
  const conflicting=[[.35,.25],[.7,.25],[.7,.75],[.35,.75]];
  assert.equal(polygonsOverlap(left,right),false);
  assert.equal(polygonsOverlap(left,conflicting),true);
});
