const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const median = values => {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)];
};

// Hold time for every hand-alignment target; setup text reads it from here.
export const DWELL_MS=4000;

// Records a fingertip only after it has stayed in a small camera-space region.
// A departure from the previous point is required before the next target can start.
export function createDwellTracker({durationMs=DWELL_MS,tolerance=.028,leaveDistance=.07,minSamples=8,maxGapMs=350}={}) {
  let current=null,previous=null,waitingForMove=false;
  return {
    update(point,now) {
      if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y)||!Number.isFinite(now))return {phase:'missing',progress:0};
      if(waitingForMove){
        if(distance(point,previous)<leaveDistance)return {phase:'move',progress:0};
        waitingForMove=false;
      }
      if(!current||now-current.lastAt>maxGapMs||distance(point,current.anchor)>tolerance){
        current={anchor:{...point},startedAt:now,lastAt:now,points:[{...point}]};
        return {phase:'holding',progress:0};
      }
      current.lastAt=now;
      current.points.push({...point});
      const progress=Math.min(1,Math.max(0,(now-current.startedAt)/durationMs));
      if(progress<1||current.points.length<minSamples)return {phase:'holding',progress};
      const sample=[median(current.points.map(p=>p.x)),median(current.points.map(p=>p.y))];
      previous={x:sample[0],y:sample[1]};waitingForMove=true;current=null;
      return {phase:'complete',progress:1,sample};
    },
    cancel(){current=null;},
  };
}
