import {clamp, rectBetween, validRect, homography, project, unproject, cssMatrix, quadValid, polygonsOverlap} from './geometry.js';
import {createDwellTracker,DWELL_MS} from './dwell.js';
import {markerLayout,drawMarkers} from './markers.js';

const $ = id => document.getElementById(id);
const stage=$('stage'), surfacesLayer=$('surfaces'), setup=$('setup'), calibration=$('calibration');
const dialog=$('dialog'), actions=$('actions'), outline=$('outline'), cursor=$('cursor'), labels=$('surface-labels');
let surfaces=[], draft=[[.11,.22],[.89,.22],[.89,.83],[.11,.83]], windows=[], nextId=1;
let phase='calibration', mode='idle', action=null, interaction=null, operation=null, selectedId=null;
let activeId=null, renderer=null, sourceId=null, destinationId=null, cameraStep=null, pendingImage=null;
// Surface numbers are never reused after a close. Hand alignment covers surfaces from alignStart on.
let nextSurface=1, alignStart=0;
const HOLD_S=DWELL_MS/1000;
// Surface-local positions of the fingertip target C and the verification target OK.
const FINGER_POINT=[.5,.5],CHECK_POINT=[.5,.22];
// The uncorrected pointer must be this close to C, in surface-local units, before a hold counts.
const FINGER_RADIUS=.15;
// How close, in projector units, the corrected pointer must be to OK for a hold to accept.
const CHECK_RADIUS=.05;
// Time for the projected markers to reach the camera before the tracker starts looking.
const MARKER_SETTLE_MS=600;
const MARKER_TIMEOUT_MS=8000;
// Hand points this far outside a surface, in surface-local units, still map onto it.
const EDGE_MARGIN=.04;
let markerToken=0;
const status=message=>{$('status').textContent=message;};
const stageSize=()=>({width:stage.clientWidth,height:stage.clientHeight});
const fromClient=(x,y)=>({x:clamp((x-stage.getBoundingClientRect().left)/stage.clientWidth,0,1),y:clamp((y-stage.getBoundingClientRect().top)/stage.clientHeight,0,1)});
const at=p=>document.elementFromPoint(stage.getBoundingClientRect().left+p.x*stage.clientWidth,stage.getBoundingClientRect().top+p.y*stage.clientHeight);
const windowById=id=>windows.find(w=>w.id===id);
const surfaceById=id=>surfaces.find(s=>s.id===id);
const local=(s,p)=>unproject(s.h,p.x,p.y);
const inside=p=>p && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1;
const surfaceAt=p=>surfaces.find(s=>inside(local(s,p)));
const otherWindows=id=>windows.filter(w=>w.surface_id===id);
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function rectStyle(el,r){Object.assign(el.style,{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`});}
function prompt(title,description,choices){
  dialog.replaceChildren();
  const h=document.createElement('h2');h.textContent=title;
  const p=document.createElement('p');p.textContent=description;
  const row=document.createElement('div');row.className='dialog-options';
  for(const [label,fn] of choices){const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>{dialog.hidden=true;fn();});row.append(button);}
  dialog.append(h,p,row);dialog.hidden=false;
  row.firstElementChild?.focus();
}
function closePrompt(){dialog.hidden=true;}
// Raw rings show uncalibrated camera positions; calibrated rings are colored by surface number.
function showCursor(p,surfaceNumber=null,raw=false){
  cursor.hidden=false;cursor.style.left=`${p.x*100}%`;cursor.style.top=`${p.y*100}%`;
  cursor.classList.toggle('raw',raw);
  cursor.dataset.surface=surfaceNumber?String((surfaceNumber-1)%4+1):'none';
}
function setSetupMessage(text){$('setup-message').textContent=text;}
function setupPreview(){
  calibration.replaceChildren();
  if(phase==='calibration'){
    calibration.hidden=false;
    const poly=document.createElement('div');poly.className='quad-preview';
    poly.style.clipPath=`polygon(${draft.map(([x,y])=>`${x*100}% ${y*100}%`).join(',')})`;
    calibration.append(poly);
    draft.forEach(([x,y],i)=>{
      const handle=document.createElement('button');handle.type='button';handle.className='corner';handle.dataset.corner=String(i);
      handle.style.left=`${x*100}%`;handle.style.top=`${y*100}%`;
      handle.textContent=String(i+1);handle.title=`Corner ${i+1}: drag onto the physical surface`;
      calibration.append(handle);
    });
  }else if(phase==='markers'){
    calibration.hidden=false;
    const s=surfaces[cameraStep.surface],{width,height}=stageSize();
    const plane=document.createElement('canvas');plane.className='marker-plane';plane.width=width;plane.height=height;
    plane.style.width=`${width}px`;plane.style.height=`${height}px`;
    plane.style.transform=`matrix3d(${cssMatrix(s.h,width,height).join(',')})`;
    drawMarkers(plane.getContext('2d'),cameraStep.layout,width,height);
    calibration.append(plane);
  }else if(phase==='finger'||phase==='camera-check'){
    calibration.hidden=false;
    const s=surfaces[cameraStep.surface],check=phase==='camera-check';
    const p=project(s.h,...(check?CHECK_POINT:FINGER_POINT));
    const ring=document.createElement('div');ring.className='dwell-ring';ring.id='dwell-ring';
    ring.style.left=`${p.x*100}%`;ring.style.top=`${p.y*100}%`;
    calibration.append(ring);
    const marker=document.createElement('div');marker.className='camera-target';marker.style.left=`${p.x*100}%`;marker.style.top=`${p.y*100}%`;marker.textContent=check?'OK':'C';
    calibration.append(marker);
  }else calibration.hidden=true;
}
// Corner dragging for a new surface, at startup or from New Surface. Existing windows stay.
function showCalibration(){
  phase='calibration';setup.hidden=false;actions.hidden=true;labels.hidden=true;
  for(const id of ['actions-button','manage-button','close-button'])$(id).hidden=true;
  $('surface-number').textContent=String(nextSurface);
  setup.querySelector('h1').firstChild.textContent='Define surface ';
  setup.querySelector('p:not(.eyebrow)').textContent='Drag each corner onto the usable boundary of this physical surface. Keep all four corners on one flat plane.';
  $('confirm-surface').hidden=false;$('add-surface').hidden=true;
  $('finish-setup').hidden=!surfaces.length;
  $('finish-setup').textContent=surfaces.length>alignStart?'Done adding surfaces':'Cancel new surface';
  $('accept-alignment').hidden=true;$('retry-alignment').hidden=true;
  setSetupMessage('Move the four points with the mouse, then confirm.');status(`Calibrate surface ${nextSurface}`);
  setupPreview();render();
}
function confirmSurface(){
  if(!quadValid(draft)){setSetupMessage('Corners must form a large, convex quadrilateral in order 1, 2, 3, 4.');return;}
  if(surfaces.some(s=>polygonsOverlap(s.corners,draft))){setSetupMessage('This area overlaps an existing surface in the projector image. Move the points apart.');return;}
  const corners=draft.map(p=>[...p]);
  surfaces.push({id:`surface-${nextSurface}`,number:nextSurface,corners,h:homography(corners),camera:null});
  nextSurface++;
  phase='choice';setupPreview();render();
  setup.querySelector('h1').firstChild.textContent='Surface ';
  $('surface-number').textContent=String(nextSurface-1);
  setup.querySelector('p:not(.eyebrow)').textContent='Boundary saved for this session. Add another physical area inside the projector beam, or finish setup.';
  $('confirm-surface').hidden=true;$('add-surface').hidden=false;$('finish-setup').hidden=false;$('finish-setup').textContent='Finish setup';
  setSetupMessage('Projector geometry is mapped. Camera input alignment comes next.');
}
function alignmentText(title,description){
  setup.hidden=false;actions.hidden=true;
  setup.querySelector('h1').firstChild.textContent=title;
  $('surface-number').textContent=String(surfaces[cameraStep.surface].number);
  setup.querySelector('p:not(.eyebrow)').textContent=description;
}
function alignmentButtons({skip=false,accept=false,retry=false}){
  $('confirm-surface').hidden=true;$('add-surface').hidden=true;
  $('finish-setup').hidden=!skip;$('finish-setup').textContent='Skip hand alignment';
  $('accept-alignment').hidden=!accept;$('retry-alignment').hidden=!retry;
}
function startCameraAlignment(){cameraStep={surface:alignStart};runMarkers();}
// Projects a marker grid on the current surface and asks the tracker to find it in the camera image.
async function runMarkers(){
  const s=surfaces[cameraStep.surface],{width,height}=stageSize(),token=++markerToken;
  clearTimeout(cameraStep.timer);
  s.camera=null;s.fingerOffset=null;s.cameraError=null;
  // Size the grid by the surface's projected edge lengths so markers land square on the surface.
  const edge=(a,b)=>Math.hypot((s.corners[a][0]-s.corners[b][0])*width,(s.corners[a][1]-s.corners[b][1])*height);
  const layout=markerLayout((edge(0,1)+edge(3,2))/2,(edge(0,3)+edge(1,2))/2);
  Object.assign(cameraStep,{layout,tracker:null,checkTracker:null,pinching:false});
  phase='markers';cursor.hidden=true;stage.classList.add('marker-capture');
  alignmentText('Camera alignment · surface ','Keep hands and objects off the surface while the camera reads the projected markers.');
  alignmentButtons({skip:true});setSetupMessage('Reading markers.');status(`Reading markers on surface ${s.number}`);
  setupPreview();
  await nextFrame();await new Promise(resolve=>setTimeout(resolve,MARKER_SETTLE_MS));
  if(phase!=='markers'||token!==markerToken)return;
  if(!window.SurfaceOSHand){markerFailed('This page loaded an outdated script. Reload with Ctrl+Shift+R, then set up again.');return;}
  const sent=window.SurfaceOSHand.send({version:1,type:'calibration_request',surface_id:s.id,markers:cameraStep.layout});
  if(!sent){markerFailed('The hand tracker is not connected. Start python src/main.py and retry, or skip to use the mouse.');return;}
  cameraStep.timer=setTimeout(()=>{
    if(phase==='markers'&&token===markerToken)markerFailed('The hand tracker did not answer. Check that it is running, then retry.');
  },MARKER_TIMEOUT_MS);
}
function markerFailed(reason){
  clearTimeout(cameraStep.timer);markerToken++;
  phase='marker-failed';stage.classList.remove('marker-capture');
  alignmentText('Camera alignment failed · surface ',reason);
  alignmentButtons({skip:true,retry:true});
  setSetupMessage('Fix the problem, then retry this surface.');status('Camera alignment failed');setupPreview();
}
function handleCalibrationResult(result){
  const s=surfaces[cameraStep?.surface];
  if(phase!=='markers'||!s||result.surface_id!==s.id)return;
  clearTimeout(cameraStep.timer);markerToken++;stage.classList.remove('marker-capture');
  if(!result.ok){markerFailed(result.reason||'The camera could not read the markers.');return;}
  if(!Array.isArray(result.camera)||result.camera.length!==9||!result.camera.every(Number.isFinite)){
    markerFailed('The tracker sent an invalid calibration. Retry this surface.');return;
  }
  s.camera=[...result.camera];s.cameraError=Number.isFinite(result.error_px)?result.error_px:null;
  startFinger();
}
function startFinger(){
  const s=surfaces[cameraStep.surface];
  phase='finger';cameraStep.tracker=createDwellTracker();cameraStep.pinching=false;
  alignmentText('Fingertip check · surface ',`Touch the center C with your index fingertip and hold still for ${HOLD_S} seconds. This corrects for where the tracker places your fingertip.`);
  alignmentButtons({retry:true});
  setSetupMessage(`Camera alignment done${s.cameraError!=null?` (${s.cameraError} px error)`:''}. Now hold on C.`);
  status(`Hold on C for ${HOLD_S} seconds`);setupPreview();
}
// Surface-local point for a camera-normalized point, with the fingertip correction unless raw.
function cameraToLocal(s,point,corrected=true){
  const offset=(corrected&&s.fingerOffset)||{x:0,y:0};
  return unproject(s.camera,point.x-offset.x,point.y-offset.y);
}
function updateFingerDwell(raw){
  const s=surfaces[cameraStep.surface],q=cameraToLocal(s,raw,false),ring=$('dwell-ring');
  if(!q)return;
  showCursor(project(s.h,q.x,q.y),s.number);
  if(Math.hypot(q.x-FINGER_POINT[0],q.y-FINGER_POINT[1])>FINGER_RADIUS){
    cameraStep.tracker.cancel();if(ring)ring.style.setProperty('--progress','0%');
    setSetupMessage(`Touch C with your fingertip and hold still for ${HOLD_S} seconds.`);return;
  }
  const result=cameraStep.tracker.update(raw,performance.now());
  if(ring)ring.style.setProperty('--progress',`${result.progress*100}%`);
  if(result.phase==='holding')setSetupMessage(`Holding on C · ${Math.max(0,Math.ceil(HOLD_S*(1-result.progress)))} seconds left.`);
  if(result.phase!=='complete')return;
  // The markers fix the surface plane; this offset moves the fingertip landmark onto the touch point.
  const expected=project(s.camera,...FINGER_POINT);
  s.fingerOffset={x:result.sample[0]-expected.x,y:result.sample[1]-expected.y};
  startCheck();
}
function startCheck(){
  phase='camera-check';cameraStep.checkTracker=createDwellTracker();cameraStep.pinching=false;
  alignmentText('Check alignment · surface ',`The colored ring should sit under your fingertip anywhere on the surface. Hold on OK for ${HOLD_S} seconds to accept, or give a thumbs down to retry.`);
  alignmentButtons({accept:true,retry:true});
  setSetupMessage(`Hold on OK for ${HOLD_S} seconds to accept. Thumbs down retries. The laptop controls also work.`);
  status('Check the ring, then hold on OK');setupPreview();
}
function updateCheckDwell(p){
  const s=surfaces[cameraStep.surface],target=project(s.h,...CHECK_POINT),ring=$('dwell-ring');
  if(Math.hypot(p.x-target.x,p.y-target.y)>CHECK_RADIUS){
    cameraStep.checkTracker.cancel();if(ring)ring.style.setProperty('--progress','0%');
    setSetupMessage(`Move the ring onto OK and hold for ${HOLD_S} seconds to accept, or give a thumbs down to retry.`);return;
  }
  const result=cameraStep.checkTracker.update(p,performance.now());
  if(ring)ring.style.setProperty('--progress',`${result.progress*100}%`);
  if(result.phase==='complete'){acceptCameraAlignment();return;}
  if(result.phase==='holding')setSetupMessage(`Holding on OK · ${Math.max(0,Math.ceil(HOLD_S*(1-result.progress)))} seconds left to accept.`);
}
function retryCameraAlignment(){if(cameraStep)runMarkers();}
function acceptCameraAlignment(){
  if(phase!=='camera-check')return;
  cameraStep.surface++;cursor.hidden=true;
  if(cameraStep.surface===surfaces.length){enterWorkspace();status('Hand alignment complete');return;}
  runMarkers();
}
function finishSetup(){
  if((phase==='choice'||phase==='calibration')&&surfaces.length>alignStart){
    prompt('Align hand input?',`The camera reads projected markers on each new surface, then you hold your fingertip on C and OK for ${HOLD_S} seconds each. Or continue with a mouse.`,[
      ['Align hands',startCameraAlignment],['Continue with mouse',enterWorkspace]]);
  }else enterWorkspace();
}
function enterWorkspace(){
  if(cameraStep){clearTimeout(cameraStep.timer);markerToken++;}
  stage.classList.remove('marker-capture');cursor.hidden=true;
  phase='workspace';mode='idle';setup.hidden=true;calibration.hidden=true;actions.hidden=false;closePrompt();
  for(const id of ['actions-button','manage-button','close-button'])$(id).hidden=false;
  alignStart=surfaces.length;render();status('Choose Make Window, Screenshot, or New Surface');
}
// New Surface repeats the startup steps for more surfaces; existing surfaces and windows stay.
function startNewSurface(){
  if(phase!=='workspace')return;
  cancel();alignStart=surfaces.length;addSurface();
}
function closeSurface(id){
  const s=surfaceById(id);if(!s)return;
  windows=windows.filter(w=>w.surface_id!==id);surfaces=surfaces.filter(item=>item!==s);
  if(activeId&&!windowById(activeId))activeId=windows.at(-1)?.id||null;
  cancel();status(`Surface ${s.number} closed`);
  if(!surfaces.length){
    alignStart=0;draft=[[.11,.22],[.89,.22],[.89,.83],[.11,.83]];showCalibration();
    setSetupMessage('No surfaces are left. Define one to continue.');
  }
}
function addSurface(){
  draft=[[.36,.35],[.64,.35],[.64,.65],[.36,.65]];
  showCalibration();setSetupMessage('Drag all four points to an unused part of the same projector beam.');
}
// Projector point for a hand on a calibrated surface. Points just outside the edge snap onto it.
function getMappedHandPoint(raw){
  let best=null,score=Infinity;
  for(const s of surfaces){
    if(!s.camera) continue;
    const q=cameraToLocal(s,raw);
    if(q && q.x>=-EDGE_MARGIN && q.x<=1+EDGE_MARGIN && q.y>=-EDGE_MARGIN && q.y<=1+EDGE_MARGIN){
      const p=project(s.h,clamp(q.x,0,1),clamp(q.y,0,1));
      const distance=Math.abs(q.x-clamp(q.x,0,1))+Math.abs(q.y-clamp(q.y,0,1));
      if(distance<score){score=distance;best={x:clamp(p.x,0,1),y:clamp(p.y,0,1)};}
    }
  }
  return best;
}
// Where a hand off every surface would appear, extending the first calibrated surface's plane.
function offSurfacePoint(raw){
  const s=surfaces.find(item=>item.camera),q=s&&cameraToLocal(s,raw);
  if(!q)return null;
  const p=project(s.h,q.x,q.y);
  return Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:clamp(p.x,0,1),y:clamp(p.y,0,1)}:null;
}
function pointForEvent(e){
  if(e.source!=='hand')return e;
  const mapped=getMappedHandPoint(e);
  return mapped ? {...e,...mapped} : null;
}
function rectForGesture(e){
  const a=pointForEvent({...e,x:e.x,y:e.y});
  const b=pointForEvent({...e,x:e.x+e.width,y:e.y+e.height});
  return a&&b?rectBetween(a,b):null;
}
// Windows running a widget app keep their frame across renders, because rebuilding it would
// reload embedded players (YouTube) and reset app content. Shell-drawn content is rebuilt as before.
function render(){
  const {width,height}=stageSize();
  const oldPlanes=new Map([...surfacesLayer.children].map(p=>[p.dataset.surfaceId,p]));
  const oldFrames=new Map([...surfacesLayer.querySelectorAll('.surface-window')].map(f=>[f.dataset.windowId,f]));
  for(const s of surfaces){
    let plane=oldPlanes.get(s.id);oldPlanes.delete(s.id);
    if(!plane){
      plane=document.createElement('div');plane.className='surface-plane';plane.dataset.surfaceId=s.id;
      const badge=document.createElement('span');badge.className='surface-badge';badge.dataset.surface=String((s.number-1)%4+1);badge.textContent=`SURFACE ${s.number}`;plane.append(badge);
      surfacesLayer.append(plane);
    }
    plane.style.width=`${width}px`;plane.style.height=`${height}px`;
    plane.style.transform=`matrix3d(${cssMatrix(s.h,width,height).join(',')})`;
    for(const w of windows.filter(w=>w.surface_id===s.id)){
      const isApp=!!renderer?.apps?.some(a=>a.type===w.content);
      let frame=oldFrames.get(w.id);oldFrames.delete(w.id);
      const reuse=isApp&&frame?.parentElement===plane&&frame.dataset.content===w.content;
      if(!reuse){
        frame?.remove();
        frame=document.createElement('section');frame.dataset.windowId=w.id;frame.dataset.content=w.content;
        const bar=document.createElement('div');bar.className='window-header';
        const host=document.createElement('div');host.className='widget-host';renderContent(w,host);
        frame.append(bar,host);plane.append(frame);
      }
      frame.className=`surface-window${w.id===activeId?' active':''}`;
      frame.style.zIndex=String(windows.indexOf(w)+1);rectStyle(frame,w);
      frame.querySelector('.window-header').textContent=`${w.content==='picker'?'Select a program':w.content==='ai'?'Ask AI':w.content==='screenshot'?'Screenshot':renderer?.apps?.find(a=>a.type===w.content)?.title||w.content} · ${w.id}`;
      frame.querySelectorAll('.resize-corner').forEach(handle=>handle.remove());
      if(mode==='resize-ready'&&selectedId===w.id) for(const key of ['nw','ne','se','sw']){
        const handle=document.createElement('span');handle.className=`resize-corner ${key}`;handle.dataset.resize=key;frame.append(handle);
      }
    }
  }
  for(const frame of oldFrames.values())frame.remove();
  for(const plane of oldPlanes.values())plane.remove();
  renderer?.sync?.(windows.map(({id,content})=>({id,content})));
  if(mode!=='surface-pick')labels.hidden=true;
}
function renderContent(w,host){
  if(w.content==='picker'){
    const picker=document.createElement('div');picker.className='picker';
    const list=[{type:'notes',title:'Notes'},...(renderer?.apps||[])];
    w.pickerIndex=clamp(w.pickerIndex||0,0,list.length-1);
    const heading=document.createElement('p');heading.textContent='SELECT A PROGRAM';
    // The neighbouring entries are buttons, so a click or a pinch steps the list without needing the scroll gesture.
    const step=(delta,label)=>{const b=document.createElement('button');b.type='button';b.className='picker-step';b.textContent=`${delta<0?'▲':'▼'} ${label}`;b.addEventListener('click',()=>cyclePicker(w.id,delta));return b;};
    const before=step(-1,list[(w.pickerIndex-1+list.length)%list.length].title),current=document.createElement('strong'),after=step(1,list[(w.pickerIndex+1)%list.length].title);
    current.textContent=`> ${list[w.pickerIndex].title} <`;
    const hint=document.createElement('button');hint.type='button';hint.className='picker-confirm';hint.textContent=`Open ${list[w.pickerIndex].title}`;hint.addEventListener('click',()=>selectProgram(w.id));
    picker.append(heading,before,current,after,hint);
    picker.addEventListener('wheel',e=>{e.preventDefault();cyclePicker(w.id,e.deltaY>0?1:-1);},{passive:false});
    host.append(picker);return;
  }
  if(w.content==='notes'){
    const note=document.createElement('textarea');note.className='note-area';note.placeholder='Write here';note.value=w.note||'';
    note.addEventListener('input',()=>{w.note=note.value;});host.append(note);return;
  }
  if(w.content==='screenshot'){
    const image=document.createElement('img');image.className='screenshot-image';image.alt='Captured image';image.src=w.image;host.append(image);return;
  }
  if(w.content==='ai'){
    const panel=document.createElement('div');panel.className='ai-panel';
    const title=document.createElement('strong');title.textContent='Ask AI';
    const message=document.createElement('p');message.textContent=w.message||'Enter a question or capture a physical area. A model connection is needed for an answer.';
    const input=document.createElement('textarea');input.placeholder='Write a question';input.value=w.question||'';input.addEventListener('input',()=>{w.question=input.value;});
    const row=document.createElement('div');row.className='ai-controls';
    const mic=document.createElement('button');mic.textContent='Microphone';mic.addEventListener('click',()=>startVoice(w.id));
    const camera=document.createElement('button');camera.textContent='Camera';camera.addEventListener('click',()=>startAICamera(w.id));
    const send=document.createElement('button');send.textContent='Send';send.addEventListener('click',()=>{w.message='No AI service is connected. Your question is kept in this window.';message.textContent=w.message;});
    row.append(mic,camera,send);panel.append(title,message);
    if(w.image){const preview=document.createElement('img');preview.src=w.image;preview.alt='Attached physical area';preview.className='ai-preview';panel.append(preview);}
    panel.append(input,row);host.append(panel);return;
  }
  if(renderer?.mountApp&&renderer.apps?.some(app=>app.type===w.content)){
    renderer.mountApp({id:w.id,content:w.content},host,()=>{});return;
  }
  const fallback=document.createElement('p');fallback.textContent='This program is unavailable.';host.append(fallback);
}
function cyclePicker(id,delta){const w=windowById(id);if(!w||w.content!=='picker')return;
  const count=1+(renderer?.apps?.length||0);w.pickerIndex=(w.pickerIndex+delta+count)%count;render();}
function selectProgram(id){const w=windowById(id);if(!w||w.content!=='picker')return;
  const list=[{type:'notes'},...(renderer?.apps||[])];w.content=list[w.pickerIndex||0].type;activeId=w.id;render();status(`${w.content} opened`);}
function openActions(){if(phase!=='workspace')return;cancel();actions.hidden=false;status('Choose Make Window, Screenshot, or New Surface');}
function chooseAction(type){
  if(phase!=='workspace')return;
  if(type==='surface'){startNewSurface();return;}
  if(type==='screenshot'&&windows.length){
    prompt('Screenshot source','What should be captured?',[
      ['Capture window',()=>{operation='capture-source';mode='target';actions.hidden=true;status('Click the window to capture');}],
      ['Capture physical area',()=>arm('physical')],['Cancel',openActions]]);return;
  }
  arm(type==='screenshot'?'physical':type);
}
function arm(type){action=type;mode='armed';interaction=null;actions.hidden=true;outline.hidden=true;
  const how='Pinch and drag with one hand, or pinch with both hands and spread them';
  status(type==='physical'?`${how}, to mark the area to capture`:`${how}, to draw ${type==='new'?'the window':type==='ai'?'the Ask AI window':'the screenshot window'} on one surface`);
}
function cancel(){if(phase!=='workspace')return;mode='idle';action=null;interaction=null;operation=null;selectedId=null;destinationId=null;outline.hidden=true;labels.hidden=true;closePrompt();render();}
function showOutline(r){outline.hidden=false;rectStyle(outline,r);}
function candidate(r,allowOverlap=false){
  const corners=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];
  const s=surfaceAt(corners[0]);if(!s||corners.some(p=>!inside(local(s,p))))return null;
  const mapped=corners.map(p=>local(s,p));
  const bounds={x:Math.min(...mapped.map(p=>p.x)),y:Math.min(...mapped.map(p=>p.y)),width:Math.max(...mapped.map(p=>p.x))-Math.min(...mapped.map(p=>p.x)),height:Math.max(...mapped.map(p=>p.y))-Math.min(...mapped.map(p=>p.y))};
  if(!validRect(bounds,allowOverlap?[]:otherWindows(s.id)))return null;
  return {s,bounds};
}
function completeDrawing(r){outline.hidden=true;const chosen=candidate(r,action==='physical'||action==='ai-camera');
  if(!chosen){mode='armed';status('Place a larger rectangle entirely within one surface, clear of other windows. Try again.');return;}
  if(action==='capture-window'){mode='idle';action=null;captureWindow(chosen.s,chosen.bounds);return;}
  if(action==='ai-camera'){mode='idle';action=null;capturePhysical(chosen.s,chosen.bounds,sourceId);return;}
  if(action==='physical'){mode='idle';capturePhysical(chosen.s,chosen.bounds);return;}
  if(action==='place-image'){
    addScreenshot(chosen.s,chosen.bounds,pendingImage);pendingImage=null;return;
  }
  const w={id:`window-${nextId++}`,surface_id:chosen.s.id,...chosen.bounds,content:action==='new'?'picker':'ai',pickerIndex:0,note:''};
  windows.push(w);activeId=w.id;mode='idle';action=null;render();status(w.content==='picker'?'Scroll the program list, then pinch or click to confirm':'Ask AI window opened');
}
function confirm(title,description,yes){prompt(title,description,[['Yes',yes],['No',()=>{cancel();status('Canceled');}]]);}
// Each gesture (or footer button) asks Yes/No once, then opens its menu; the menu choice picks a target.
function askMainMenu(){confirm('Open main menu?','Show Make Window, Screenshot, and New Surface.',openActions);}
function askManage(){confirm('Manage windows?','Choose Move, Resize, or Change surface, then pick the window.',manageMenu);}
function askClose(){confirm('Close something?','Choose a window or a whole surface, then pick it.',closeMenu);}
const OPERATION_TEXT={move:'move',resize:'resize',transfer:'move to another surface',close:'close'};
function management(kind){
  if(phase!=='workspace')return;
  if(!windows.length){cancel();status('There are no windows yet.');return;}
  if(kind==='transfer'&&surfaces.length<2){cancel();status('There is only one surface. Add one with New Surface first.');return;}
  operation=kind;mode='target';actions.hidden=true;status(`Pinch or click the window to ${OPERATION_TEXT[kind]}`);
}
function manageMenu(){prompt('Manage windows','Choose an operation, then pick the window.',[
  ['Move',()=>management('move')],['Resize',()=>management('resize')],['Change surface',()=>management('transfer')],['Cancel',cancel]]);}
function closeMenu(){prompt('Close','Close a window, or a surface with all of its windows?',[
  ['Window',()=>management('close')],
  ['Surface',()=>{operation='close-surface';mode='surface-target';actions.hidden=true;status('Pinch or click the surface to close');}],
  ['Cancel',cancel]]);}
function chooseSurfaceToClose(s){
  const count=otherWindows(s.id).length;mode='idle';
  confirm(`Close Surface ${s.number}?`,`This removes the surface${count?` and its ${count} window${count===1?'':'s'}`:''}.`,()=>closeSurface(s.id));
}
function chooseTarget(id){
  const w=windowById(id);if(!w)return;
  activeId=id;selectedId=id;
  if(operation==='capture-source'){sourceId=id;mode='idle';arm('capture-window');status('Draw a free destination window for the screenshot');return;}
  if(operation==='close'){windows=windows.filter(item=>item.id!==id);activeId=windows.at(-1)?.id||null;cancel();render();status('Window closed');return;}
  if(operation==='resize'){mode='resize-ready';render();status('Drag any corner handle to resize. Escape cancels.');return;}
  if(operation==='move'){mode='move-ready';render();status('Drag the selected window to a free position');return;}
  if(operation==='transfer')showDestinationLabels();
}
function showDestinationLabels(){mode='surface-pick';labels.hidden=false;labels.replaceChildren();
  for(const s of surfaces){if(s.id===windowById(selectedId)?.surface_id)continue;
    const pos=project(s.h,.5,.5);const button=document.createElement('button');button.textContent=`Surface ${s.number}`;
    button.style.left=`${pos.x*100}%`;button.style.top=`${pos.y*100}%`;
    button.addEventListener('click',()=>{destinationId=s.id;labels.hidden=true;mode='transfer-ready';status(`Click a free spot on Surface ${s.number} to place the window`);});labels.append(button);}
  status('Choose a numbered destination surface');}
function placeTransfer(p){const s=surfaceAt(p),w=windowById(selectedId);if(!s||s.id!==destinationId||!w)return;
  const atLocal=local(s,p);const proposed={x:atLocal.x-w.width/2,y:atLocal.y-w.height/2,width:w.width,height:w.height};
  if(!validRect(proposed,otherWindows(s.id))){status('Not enough free space here. Choose another spot.');return;}
  Object.assign(w,proposed);w.surface_id=s.id;activeId=w.id;cancel();status(`Moved to Surface ${s.number}`);
}
function proposedResize(base,corner,dx,dy){let x=base.x,y=base.y,right=base.x+base.width,bottom=base.y+base.height;
  if(corner.includes('w'))x+=dx;else right+=dx;
  if(corner.includes('n'))y+=dy;else bottom+=dy;
  return {x,y,width:right-x,height:bottom-y};}
function deliverContent(w,e){const s=surfaceById(w.surface_id),p=local(s,e);if(!p)return;
  const yTop=w.y+42/stage.clientHeight;
  const host=document.querySelector(`[data-window-id="${w.id}"] .widget-host`);if(!host)return;
  host.dispatchEvent(new CustomEvent('surfaceos:window-pointer',{bubbles:true,detail:{version:1,type:e.type,source:e.source,window_id:w.id,x:(p.x-w.x)/w.width,y:(p.y-yTop)/(w.height-42/stage.clientHeight),dy:e.dy}}));
}
function handleInput(raw,target=null){
  if(raw?.version!==1||typeof raw.type!=='string')return false;
  if(raw.type==='hold_progress'){cursor.style.setProperty('--hold',String(clamp(Number(raw.progress)||0,0,1)));return true;}
  if(raw.type==='calibration_result'){handleCalibrationResult(raw);return true;}
  if(phase==='markers'||phase==='marker-failed')return true;
  if(phase==='finger'||phase==='camera-check'){
    if(raw.source!=='hand')return true;
    if(raw.type==='thumbs_down'){retryCameraAlignment();return true;}
    const hold=phase==='finger'?cameraStep.tracker:cameraStep.checkTracker;
    if(raw.type==='pointer_cancel'||raw.type==='pointer_down'){
      if(raw.type==='pointer_cancel')cursor.hidden=true;
      hold.cancel();const ring=$('dwell-ring');if(ring)ring.style.setProperty('--progress','0%');
      cameraStep.pinching=raw.type==='pointer_down';return true;
    }
    if(raw.type==='pointer_up'){cameraStep.pinching=false;return true;}
    if(raw.type==='pointer_move'&&Number.isFinite(raw.x)&&Number.isFinite(raw.y)){
      const s=surfaces[cameraStep.surface];
      if(phase==='finger'){if(!cameraStep.pinching)updateFingerDwell(raw);return true;}
      const q=cameraToLocal(s,raw);
      if(q){const p=project(s.h,q.x,q.y);showCursor(p,s.number);if(!cameraStep.pinching)updateCheckDwell(p);}
    }
    return true;
  }
  if(phase!=='workspace')return false;
  if(raw.type==='pointer_cancel'||raw.type==='two_hand_pinch_cancel'){
    if(mode==='content'&&interaction){const w=windowById(interaction.id);if(w)deliverContent(w,{...interaction.last,type:'pointer_cancel'});}
    if(mode==='drawing'||mode==='moving'||mode==='resizing'){mode=mode==='drawing'?'armed':interaction?.returnMode||'idle';interaction=null;outline.hidden=true;render();}
    cursor.hidden=true;return true;
  }
  // A gesture menu never interrupts drawing, moving, or resizing.
  const busy=['armed','drawing','moving','resizing'].includes(mode);
  if(raw.type==='two_hand_hold'){if(busy)return false;askMainMenu();return true;}
  if(raw.type==='peace_sign'){if(busy)return false;askManage();return true;}
  if(raw.type==='thumbs_down'){if(busy)return false;askClose();return true;}
  if(raw.type==='scroll'){
    const point=pointForEvent(raw);if(!point)return false;
    const frame=at(point)?.closest('.surface-window'),w=windowById(frame?.dataset.windowId);
    if(w?.content==='picker'){cyclePicker(w.id,(raw.dy||0)>0?1:-1);return true;}
    if(w){
      const host=frame.querySelector('.widget-host');let node=at(point);
      while(node&&node!==host){
        if(node.scrollHeight>node.clientHeight+2){node.scrollTop+=(raw.dy||0)*stage.clientHeight;break;}
        node=node.parentElement;
      }
      deliverContent(w,{...point,type:'scroll',dy:raw.dy});
    }
    return !!w;
  }
  if(raw.type.startsWith('two_hand_pinch_')){
    if(mode!=='armed'&&mode!=='drawing')return false;
    if(!Number.isFinite(raw.width)||!Number.isFinite(raw.height))return false;
    const r=rectForGesture(raw);if(!r)return false;
    if(raw.type==='two_hand_pinch_start'){mode='drawing';interaction={start:r};showOutline(r);return true;}
    if(raw.type==='two_hand_pinch_move'&&mode==='drawing'){showOutline(r);return true;}
    if(raw.type==='two_hand_pinch_end'&&mode==='drawing'){completeDrawing(r);interaction=null;return true;}
    return false;
  }
  if(!['pointer_move','pointer_down','pointer_up'].includes(raw.type))return false;
  if(!Number.isFinite(raw.x)||!Number.isFinite(raw.y))return false;
  const e=pointForEvent(raw);
  if(!e){
    const off=raw.source==='hand'&&raw.type==='pointer_move'&&offSurfacePoint(raw);
    if(off)showCursor(off);
    return false;
  }
  target??=at(e);
  if(raw.source==='hand')showCursor(e,surfaceAt(e)?.number);
  if(e.type==='pointer_down'){
    // Widget-renderer buttons act on pointer events, not native clicks, so hand presses on them go to the window content below.
    const shellButton=target?.closest('button');
    if(raw.source==='hand'&&shellButton&&!shellButton.closest('.surfaceos-widgets')){interaction={button:shellButton};return true;}
    if(mode==='transfer-ready'){placeTransfer(e);return true;}
    if(mode==='target'){
      const id=target?.closest('.surface-window')?.dataset.windowId;if(id){chooseTarget(id);return true;}return false;
    }
    if(mode==='surface-target'){
      if(target?.closest('footer,.panel'))return false;
      const s=surfaceAt(e);if(s){chooseSurfaceToClose(s);return true;}return false;
    }
    if(mode==='armed'){
      if(!surfaceAt(e)||target?.closest('footer,.panel,.surface-window'))return false;
      mode='drawing';interaction={start:e};showOutline({x:e.x,y:e.y,width:0,height:0});return true;
    }
    if(mode==='move-ready'&&target?.closest('.surface-window')?.dataset.windowId===selectedId){
      const w=windowById(selectedId),s=surfaceById(w.surface_id);mode='moving';interaction={id:w.id,start:local(s,e),base:{x:w.x,y:w.y,width:w.width,height:w.height},lastValid:{x:w.x,y:w.y,width:w.width,height:w.height},returnMode:'move-ready'};return true;
    }
    if(mode==='resize-ready'&&target?.closest('[data-resize]')){
      const corner=target.closest('[data-resize]').dataset.resize,w=windowById(selectedId),s=surfaceById(w.surface_id);mode='resizing';interaction={id:w.id,start:local(s,e),corner,base:{x:w.x,y:w.y,width:w.width,height:w.height},lastValid:{x:w.x,y:w.y,width:w.width,height:w.height},returnMode:'resize-ready'};return true;
    }
    const frame=target?.closest('.surface-window'),w=windowById(frame?.dataset.windowId);
    if(w?.content==='picker'){activeId=w.id;if(raw.source==='hand'){selectProgram(w.id);return true;}return false;}
    if(w){activeId=w.id;if(raw.source==='hand'){mode='content';interaction={id:w.id,last:e};deliverContent(w,e);}return false;}
    return false;
  }
  if(e.type==='pointer_move'){
    if(mode==='drawing'&&interaction?.start){showOutline(rectBetween(interaction.start,e));return true;}
    if((mode==='moving'||mode==='resizing')&&interaction?.id){
      const w=windowById(interaction.id),s=surfaceById(w.surface_id),p=local(s,e);if(!p)return true;
      const dx=p.x-interaction.start.x,dy=p.y-interaction.start.y;
      const proposed=mode==='moving'?{...interaction.base,x:interaction.base.x+dx,y:interaction.base.y+dy}:proposedResize(interaction.base,interaction.corner,dx,dy);
      if(validRect(proposed,otherWindows(s.id),w.id)){Object.assign(w,proposed);interaction.lastValid=proposed;render();}
      else status('Boundary or another window blocks that position');return true;
    }
    if(mode==='content'&&interaction?.id&&raw.source==='hand'){
      const w=windowById(interaction.id);interaction.last=e;if(w)deliverContent(w,e);return true;
    }
    return false;
  }
  if(e.type==='pointer_up'){
    if(interaction?.button&&raw.source==='hand'){
      const button=interaction.button;interaction=null;if(button===target?.closest('button'))button.click();return true;
    }
    if(mode==='drawing'&&interaction?.start){const r=rectBetween(interaction.start,e);interaction=null;completeDrawing(r);return true;}
    if((mode==='moving'||mode==='resizing')&&interaction){interaction=null;mode='idle';selectedId=null;render();status('Window updated');return true;}
    if(mode==='content'&&interaction?.id&&raw.source==='hand'){const w=windowById(interaction.id);if(w)deliverContent(w,e);mode='idle';interaction=null;return true;}
  }
  return false;
}

function addScreenshot(s,bounds,image){
  const w={id:`window-${nextId++}`,surface_id:s.id,...bounds,content:'screenshot',image};
  windows.push(w);activeId=w.id;action=null;mode='idle';render();status('Screenshot opened');
}
function placeCapturedImage(s,bounds,image){
  if(validRect(bounds,otherWindows(s.id))){addScreenshot(s,bounds,image);return;}
  pendingImage=image;arm('place-image');status('Capture ready. Draw a free area for its screenshot window.');
}
async function imageOfElement(node){
  const box=node.getBoundingClientRect();
  const width=Math.max(1,Math.round(node.offsetWidth)),height=Math.max(1,Math.round(node.offsetHeight));
  if(!box.width||!box.height)throw new Error('Source window is empty');
  const copy=node.cloneNode(true);
  const original=node.querySelectorAll('*'),clones=copy.querySelectorAll('*');
  function styles(a,b){const style=getComputedStyle(a);for(const name of style)b.style.setProperty(name,style.getPropertyValue(name),style.getPropertyPriority(name));}
  styles(node,copy);for(let i=0;i<original.length;i++)styles(original[i],clones[i]);
  for(let i=0;i<original.length;i++){
    if(original[i] instanceof HTMLTextAreaElement)clones[i].textContent=original[i].value;
    if(original[i] instanceof HTMLCanvasElement){
      const img=document.createElement('img');img.src=original[i].toDataURL();img.width=original[i].width;img.height=original[i].height;clones[i].replaceWith(img);
    }
  }
  copy.style.width=`${width}px`;copy.style.height=`${height}px`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${new XMLSerializer().serializeToString(copy)}</div></foreignObject></svg>`;
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=new Image();img.src=url;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png');
  }finally{URL.revokeObjectURL(url);}
}
async function captureWindow(s,bounds){
  const source=windowById(sourceId),host=document.querySelector(`[data-window-id="${sourceId}"] .widget-host`);
  if(!source||!host){status('The source window is gone. Choose Screenshot again.');return;}
  try{const image=await imageOfElement(host);addScreenshot(s,bounds,image);}
  catch(error){status(`Digital capture could not render this content: ${error.message}`);prompt('Capture unavailable','Try a different window or use a physical area capture.',[['OK',openActions]]);}
}
async function capturePhysical(s,bounds,intoId=null){
  if(!s.camera){status('Align hand/camera points before capturing a specific physical area.');
    prompt('Camera alignment needed','The projector boundary alone cannot tell the camera which pixels belong to this area. Recalibrate with hand alignment, then capture.',[['OK',openActions]]);return;}
  if(!navigator.mediaDevices?.getUserMedia){status('Camera access is unavailable on this browser or origin.');return;}
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}},audio:false});
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
    await video.play();
    surfacesLayer.style.visibility='hidden';actions.style.visibility='hidden';$('stage').classList.add('capture-dark');
    await nextFrame();await new Promise(resolve=>setTimeout(resolve,150));
    const crop=document.createElement('canvas');const source=document.createElement('canvas');
    source.width=video.videoWidth;source.height=video.videoHeight;
    source.getContext('2d').drawImage(video,0,0);
    crop.width=Math.max(1,Math.min(1200,Math.round(stage.clientWidth*bounds.width)));
    crop.height=Math.max(1,Math.min(800,Math.round(stage.clientHeight*bounds.height)));
    const sourcePixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    const context=crop.getContext('2d'),output=context.createImageData(crop.width,crop.height);
    for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
      const u=bounds.x+(x+.5)*bounds.width/crop.width,v=bounds.y+(y+.5)*bounds.height/crop.height;
      const camera=project(s.camera,u,v);
      const sx=Math.round(camera.x*source.width),sy=Math.round(camera.y*source.height);
      if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;
      const from=(sy*source.width+sx)*4,to=(y*crop.width+x)*4;
      for(let channel=0;channel<4;channel++)output.data[to+channel]=sourcePixels[from+channel];
    }
    context.putImageData(output,0,0);
    const image=crop.toDataURL('image/png');
    if(intoId){const w=windowById(intoId);if(w){w.image=image;w.message='Photo attached locally. No AI service is connected yet.';render();status('Physical area attached to Ask AI');}}
    else placeCapturedImage(s,bounds,image);
  }catch(error){status(`Camera capture unavailable: ${error.message}`);prompt('Camera capture unavailable',error.message,[['OK',openActions]]);}
  finally{surfacesLayer.style.visibility='';actions.style.visibility='';stage.classList.remove('capture-dark');stream?.getTracks().forEach(track=>track.stop());}
}
function startAICamera(id){
  confirm('Capture a physical area?','Draw the region on a calibrated surface. The image will be attached to this Ask AI window.',()=>{
    sourceId=id;arm('ai-camera');
  });
}
function startVoice(id){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const w=windowById(id);
  if(!Recognition){if(w){w.message='Voice input is unavailable in this browser. Type your question instead.';render();}return;}
  const recognition=new Recognition();recognition.lang='en-US';recognition.interimResults=false;
  recognition.onresult=e=>{const current=windowById(id);if(current){current.question=e.results[0][0].transcript;current.message='Question transcribed. No AI service is connected yet.';render();}};
  recognition.onerror=e=>{const current=windowById(id);if(current){current.message=`Microphone unavailable: ${e.error}`;render();}};
  try{recognition.start();if(w){w.message='Listening…';render();}}catch(error){if(w){w.message=`Microphone unavailable: ${error.message}`;render();}}
}
$('confirm-surface').addEventListener('click',confirmSurface);
$('accept-alignment').addEventListener('click',acceptCameraAlignment);
$('retry-alignment').addEventListener('click',retryCameraAlignment);
$('add-surface').addEventListener('click',addSurface);
$('finish-setup').addEventListener('click',finishSetup);
actions.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(button)chooseAction(button.dataset.action);});
$('actions-button').addEventListener('click',askMainMenu);
$('manage-button').addEventListener('click',askManage);
$('close-button').addEventListener('click',askClose);
$('fullscreen').addEventListener('click',()=>document.fullscreenElement?document.exitFullscreen():stage.requestFullscreen?.());
calibration.addEventListener('pointerdown',e=>{
  if(phase!=='calibration')return;
  const handle=e.target.closest('[data-corner]');if(!handle)return;
  interaction={corner:Number(handle.dataset.corner),pointerId:e.pointerId};handle.setPointerCapture(e.pointerId);e.preventDefault();
});
calibration.addEventListener('pointermove',e=>{
  if(phase!=='calibration'||interaction?.pointerId!==e.pointerId)return;
  const p=fromClient(e.clientX,e.clientY);draft[interaction.corner]=[clamp(p.x,.015,.985),clamp(p.y,.015,.985)];
  const preview=calibration.querySelector('.quad-preview'),handle=calibration.querySelector(`[data-corner="${interaction.corner}"]`);
  preview.style.clipPath=`polygon(${draft.map(([x,y])=>`${x*100}% ${y*100}%`).join(',')})`;
  handle.style.left=`${draft[interaction.corner][0]*100}%`;handle.style.top=`${draft[interaction.corner][1]*100}%`;
});
calibration.addEventListener('pointerup',e=>{if(interaction?.pointerId===e.pointerId)interaction=null;});
calibration.addEventListener('pointercancel',()=>{interaction=null;});
stage.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  const used=handleInput({version:1,type:'pointer_down',...fromClient(e.clientX,e.clientY),source:'mouse'},e.target);
  if(used&&['drawing','moving','resizing'].includes(mode)){stage.setPointerCapture(e.pointerId);e.preventDefault();}
});
stage.addEventListener('pointermove',e=>handleInput({version:1,type:'pointer_move',...fromClient(e.clientX,e.clientY),source:'mouse'},e.target));
stage.addEventListener('pointerup',e=>{
  handleInput({version:1,type:'pointer_up',...fromClient(e.clientX,e.clientY),source:'mouse'},e.target);
  if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
});
stage.addEventListener('pointercancel',e=>handleInput({version:1,type:'pointer_cancel',source:'mouse'}));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){cancel();return;}
  if(e.target.matches('textarea,input,[contenteditable]')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key.toLowerCase()==='f')$('fullscreen').click();
  if(phase==='workspace'&&e.key.toLowerCase()==='n')chooseAction('new');
  if(phase==='workspace'&&mode==='idle'&&activeId&&renderer?.handleKey?.(activeId,{type:'keydown',key:e.key}))e.preventDefault();
});
document.addEventListener('keyup',e=>{if(phase==='workspace'&&mode==='idle'&&activeId)renderer?.handleKey?.(activeId,{type:'keyup',key:e.key});});
window.addEventListener('resize',render);
window.SurfaceOS=Object.freeze({
  dispatchInput:event=>handleInput(event),
  mountWidgetRenderer(value){if(!value||typeof value.renderLayout!=='function')throw new TypeError('Expected renderer');renderer=value;render();},
  getState:()=>({phase,mode,surfaces:structuredClone(surfaces),windows:structuredClone(windows)}),
  reset:()=>{if(cameraStep)clearTimeout(cameraStep.timer);cameraStep=null;markerToken++;stage.classList.remove('marker-capture');cursor.hidden=true;surfaces=[];windows=[];nextId=1;nextSurface=1;alignStart=0;activeId=null;mode='idle';action=null;interaction=null;pendingImage=null;draft=[[.11,.22],[.89,.22],[.89,.83],[.11,.83]];showCalibration();},
});
showCalibration();
