export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const rectBetween = (a, b) => ({x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y)});
export function intersect(a,b) { return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y; }
export function validRect(r, others, id = null) {
  return r.x >= 0 && r.y >= 0 && r.x+r.width <= 1.000001 && r.y+r.height <= 1.000001 &&
    r.width >= .12 && r.height >= .12 && !others.some(w => w.id !== id && intersect(r,w));
}
// Solve the projective transform from unit-square coordinates to a four-corner quadrilateral.
export function homography(corners) {
  const rows = [];
  for (const [i, [x,y]] of corners.entries()) {
    const [u,v] = [[0,0],[1,0],[1,1],[0,1]][i];
    rows.push([u,v,1,0,0,0,-u*x,-v*x,x]);
    rows.push([0,0,0,u,v,1,-u*y,-v*y,y]);
  }
  for (let col=0; col<8; col++) {
    let pivot=col;
    for(let row=col+1;row<8;row++) if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col])) pivot=row;
    if(Math.abs(rows[pivot][col])<1e-10) throw new Error('Surface corners are invalid');
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    const scale=rows[col][col]; for(let j=col;j<9;j++) rows[col][j]/=scale;
    for(let row=0;row<8;row++) if(row!==col) { const factor=rows[row][col]; for(let j=col;j<9;j++) rows[row][j]-=factor*rows[col][j]; }
  }
  return [...rows.map(row=>row[8]),1];
}
export function project(h,u,v) {
  const d=h[6]*u+h[7]*v+h[8];
  return {x:(h[0]*u+h[1]*v+h[2])/d, y:(h[3]*u+h[4]*v+h[5])/d};
}
export function unproject(h,x,y) {
  const a=h[0]-x*h[6], b=h[1]-x*h[7], c=x*h[8]-h[2];
  const d=h[3]-y*h[6], e=h[4]-y*h[7], f=y*h[8]-h[5];
  const det=a*e-b*d;
  if(Math.abs(det)<1e-10) return null;
  return {x:(c*e-b*f)/det,y:(a*f-c*d)/det};
}
export function surfacePixelSize(corners,stageWidth,stageHeight) {
  const edge=(a,b)=>Math.hypot(
    (corners[a][0]-corners[b][0])*stageWidth,
    (corners[a][1]-corners[b][1])*stageHeight,
  );
  return {
    width:(edge(0,1)+edge(3,2))/2,
    height:(edge(0,3)+edge(1,2))/2,
  };
}
export function cssMatrix(h,localWidth,localHeight,stageWidth=localWidth,stageHeight=localHeight) {
  // Map local surface pixels into stage pixels without shrinking the entire UI with the quad.
  return [h[0]*stageWidth/localWidth,h[3]*stageHeight/localWidth,0,h[6]/localWidth,
    h[1]*stageWidth/localHeight,h[4]*stageHeight/localHeight,0,h[7]/localHeight,
    0,0,1,0,h[2]*stageWidth,h[5]*stageHeight,0,1];
}
export function quadValid(c) {
  try {
    const area = c.reduce((sum,p,i)=>sum+p[0]*c[(i+1)%4][1]-p[1]*c[(i+1)%4][0],0)/2;
    if(area < .015 || c.some(([x,y])=>x<0||y<0||x>1||y>1)) return false;
    for(let i=0;i<4;i++) {
      const a=c[i],b=c[(i+1)%4],d=c[(i+2)%4];
      if((b[0]-a[0])*(d[1]-b[1])-(b[1]-a[1])*(d[0]-b[0]) <= 0) return false;
    }
    homography(c); return true;
  } catch { return false; }
}

export function polygonsOverlap(a,b) {
  // Convex quadrilaterals overlap only if none of their edge normals separates them.
  for(const poly of [a,b])for(let i=0;i<4;i++){
    const v=poly[i],next=poly[(i+1)%4],axis=[v[1]-next[1],next[0]-v[0]];
    const range=points=>points.map(p=>p[0]*axis[0]+p[1]*axis[1]);
    const x=range(a),y=range(b);
    if(Math.max(...x)<=Math.min(...y)+.002 || Math.max(...y)<=Math.min(...x)+.002)return false;
  }
  return true;
}

// Compatibility for existing geometry consumers.
export const rectangleBetween = rectBetween;
export function moveWithinCanvas(rect,dx,dy) { return {...rect,x:clamp(rect.x+dx,0,1-rect.width),y:clamp(rect.y+dy,0,1-rect.height)}; }
export function resizeWithinCanvas(rect,dx,dy,minWidth=.12,minHeight=.1) { return {...rect,width:clamp(rect.width+dx,minWidth,1-rect.x),height:clamp(rect.height+dy,minHeight,1-rect.y)}; }
export function contains(rect,p) { return p.x>=rect.x && p.x<=rect.x+rect.width && p.y>=rect.y && p.y<=rect.y+rect.height; }
