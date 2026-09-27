// ArUco DICT_4X4_50 markers 0-11: the inner 4x4 bits, row major, 1 = white.
// tests/test_marker_calibration.py checks this table against OpenCV.
export const ARUCO_4X4_50=[
  '1011010100110010','0000111110011010','0011001100101101','1001100101000110',
  '0101010010011110','0111100111001101','1001111000101110','1100010011110010',
  '1111111011011010','1100111101010110','1111100110010001','0001000110100111',
];

// Marker squares in surface-local 0..1 coordinates, corners clockwise from top left as OpenCV
// reports them. width and height are the surface's size as projected, so markers look square there.
export function markerLayout(width,height,{columns=4,rows=3,fill=.6}={}){
  if(columns*rows>ARUCO_4X4_50.length)throw new RangeError('Not enough marker patterns');
  const cellWidth=width/columns,cellHeight=height/rows,side=fill*Math.min(cellWidth,cellHeight);
  const markers=[];
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const cx=(column+.5)*cellWidth,cy=(row+.5)*cellHeight;
    const x0=(cx-side/2)/width,x1=(cx+side/2)/width,y0=(cy-side/2)/height,y1=(cy+side/2)/height;
    markers.push({id:row*columns+column,corners:[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]});
  }
  return markers;
}

// Draws black markers with a one-cell black border on a white plane.
export function drawMarkers(context,markers,width,height){
  context.fillStyle='#fff';context.fillRect(0,0,width,height);
  for(const {id,corners} of markers){
    const [x0,y0]=corners[0],[x1,y1]=corners[2];
    // Integer cell edges avoid faint seams between neighbouring white cells.
    const xs=Array.from({length:7},(_,i)=>Math.round((x0+(x1-x0)*i/6)*width));
    const ys=Array.from({length:7},(_,i)=>Math.round((y0+(y1-y0)*i/6)*height));
    context.fillStyle='#000';context.fillRect(xs[0],ys[0],xs[6]-xs[0],ys[6]-ys[0]);
    context.fillStyle='#fff';
    for(let r=0;r<4;r++)for(let c=0;c<4;c++)
      if(ARUCO_4X4_50[id][r*4+c]==='1')context.fillRect(xs[c+1],ys[r+1],xs[c+2]-xs[c+1],ys[r+2]-ys[r+1]);
  }
}
